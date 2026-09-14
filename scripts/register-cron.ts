/**
 * Registers the cron that drives notification delivery.
 *
 *   pnpm catalyst:cron              # create or update it, then report
 *   pnpm catalyst:cron --dry-run    # report only, change nothing
 *   pnpm catalyst:cron --delete     # remove it
 *
 * The cron calls POST /api/internal/tick on the deployed AppSail service every
 * five minutes. See docs/catalyst/12-scheduling-and-delivery.md for why the
 * schedule lives outside the process at all: AppSail auto-scales to 1-5
 * instances, so an in-process interval would run on every one of them and fire
 * each reminder up to five times.
 *
 * Everything below was established by watching the live project, not by
 * reading documentation — and in two cases the thing that creates cleanly is
 * not the thing that runs:
 *
 *   1. `cron_name` accepts only alphanumerics and underscores. A hyphen is
 *      rejected with INVALID_INPUT, which reads like a schema problem.
 *
 *   2. A `Periodic` cron has a MINIMUM interval of 60 minutes —
 *      "Minimum Schedule time must be 60 minutes". That rules out the obvious
 *      cron_type for a five-minute sweep.
 *
 *   3. `CronExpression` is ACCEPTED AND NEVER RUNS. A cron created with
 *      `cron_expression: '*' + '/5 * * * *'` comes back with the expression
 *      echoed, `cron_status: true` — and a `cron_detail` of
 *      `{hour: 0, minute: 0, second: 0}`. After 25 minutes it had
 *      `success_count: 0, failure_count: 0`: never invoked once. The scheduler
 *      evidently reads cron_detail, which the expression does not populate.
 *      Creation succeeding proves only that the payload validated.
 *
 *   4. An `AppSail` target FAILS when invoked. A OneTime cron pointed at the
 *      service fired on schedule and recorded `failure_count: 1`; an
 *      identically scheduled `Webhook` cron pointed at the same URL recorded
 *      `success_count: 1` and the request reached the server. So this uses
 *      Webhook with the service's absolute URL.
 *
 *      (No jobpool is involved either way — the project has none, and the
 *      webhook cron ran regardless.)
 *
 * So Catalyst cannot drive a five-minute sweep. The sweep runs on an interval
 * inside the server instead — safe on every instance because each row is
 * claimed before delivery; see server/notifications/scheduler.ts — and this
 * cron is the BACKSTOP for the one case that cannot cover: a container idle
 * long enough to be stopped has no interval running either.
 *
 * Hourly, because that is the floor `Periodic` allows. Its real job is to wake
 * the service; once awake, the interval takes over and delivers within five
 * minutes.
 */
import { api, resolveTarget, type Target } from './lib/catalystAdmin.ts';

const DRY_RUN = process.argv.includes('--dry-run');
const DELETE  = process.argv.includes('--delete');

/** Underscores only — Catalyst rejects a hyphen here. */
const CRON_NAME = 'hitlist_notification_sweep';

/**
 * How often the backstop runs, in hours.
 *
 * One an hour is the floor Catalyst's Periodic cron allows, and is the right
 * setting: this exists to wake a stopped container, not to be the schedule.
 * 24 invocations a day.
 */
const INTERVAL_HOURS = Math.max(1, Number(process.env['SWEEP_CRON_HOURS'] ?? '1'));

/** The path the cron calls. Relative — Catalyst resolves it against the service. */
const TICK_PATH = '/api/internal/tick';

interface AppSailService { id: string; name: string; url?: string; status?: boolean }

/**
 * Finds the deployed service to point the cron at.
 *
 * By name rather than a hardcoded id, so a redeployed or recreated service
 * does not leave the cron calling something that no longer exists.
 */
async function findAppSail(target: Target, name: string): Promise<AppSailService | null> {
  const services = await api(target, 'GET', '/appsail') as AppSailService[];
  return services?.find((s) => s.name === name) ?? null;
}

async function findCron(target: Target, name: string): Promise<{ id: string } | null> {
  const crons = await api(target, 'GET', '/cron') as Array<{ id: string; cron_name: string }>;
  return crons?.find((c) => c.cron_name === name) ?? null;
}

function cronPayload(serviceUrl: string, secret: string) {
  return {
    cron_name: CRON_NAME,
    description:
      'Hourly backstop for the HitList notification sweep. The five-minute ' +
      'schedule runs inside the service; see server/notifications/scheduler.ts.',
    cron_status: true,
    cron_type: 'Periodic',
    cron_detail: {
      hour: INTERVAL_HOURS,
      minute: 0,
      second: 0,
      repetition_type: 'every',
      timezone: 'Asia/Kolkata',
    },
    job_meta: {
      job_name: 'notification_sweep',
      // Webhook rather than AppSail, with the service's ABSOLUTE url. An
      // AppSail-targeted cron fired on schedule and recorded failure_count 1;
      // an identically scheduled Webhook cron to the same URL succeeded.
      target_type: 'Webhook',
      url: `${serviceUrl.replace(/\/+$/, '')}${TICK_PATH}`,
      request_method: 'POST',
      // The endpoint refuses to run without this, so a cron registered with
      // the wrong secret fails closed rather than sweeping unauthenticated.
      headers: { 'X-Tick-Secret': secret },
    },
  };
}

async function main(): Promise<void> {
  const target = await resolveTarget('cron');
  const serviceName = process.env['APPSAIL_NAME'] ?? 'hitlist-api';

  const existing = await findCron(target, CRON_NAME);

  if (DELETE) {
    if (!existing) { console.log(`[cron] ${CRON_NAME} does not exist; nothing to delete`); return; }
    if (DRY_RUN)   { console.log(`[cron] would delete ${CRON_NAME} (${existing.id})`); return; }
    await api(target, 'DELETE', `/cron/${existing.id}`);
    console.log(`[cron] deleted ${CRON_NAME}`);
    return;
  }

  const secret = (process.env['TICK_SECRET'] ?? '').trim();
  if (!secret) {
    console.error(
      '\nTICK_SECRET is not set.\n\n' +
      'The cron presents it as X-Tick-Secret, and the endpoint refuses to run\n' +
      'without a match. Generate one, set it BOTH here and in the AppSail\n' +
      "service's environment variables, then run this again:\n\n" +
      '  TICK_SECRET=$(openssl rand -hex 32) pnpm catalyst:cron\n\n' +
      'It must not be named CATALYST_* — AppSail rejects that prefix on\n' +
      'user-supplied environment variables.\n'
    );
    process.exit(1);
  }

  const service = await findAppSail(target, serviceName);
  if (!service) {
    console.error(
      `\nNo AppSail service named "${serviceName}" in this project.\n` +
      'Deploy it first (`pnpm appsail:deploy`), or set APPSAIL_NAME.\n'
    );
    process.exit(1);
  }

  if (!service.url) {
    console.error(`\nAppSail service "${serviceName}" reports no URL yet; deploy it first.\n`);
    process.exit(1);
  }

  console.log(`[cron] target  ${service.name} (${service.id})`);
  console.log(`[cron] calls   POST ${service.url}${TICK_PATH}`);
  console.log(`[cron] every   ${INTERVAL_HOURS}h (backstop; the service sweeps every 5 min)`);

  const payload = cronPayload(service.url, secret);

  if (existing) {
    if (DRY_RUN) { console.log(`[cron] would update ${CRON_NAME} (${existing.id})`); return; }
    await api(target, 'PUT', `/cron/${existing.id}`, { ...payload, id: existing.id });
    console.log(`[cron] updated ${CRON_NAME} (${existing.id})`);
  } else {
    if (DRY_RUN) { console.log(`[cron] would create ${CRON_NAME}`); return; }
    const created = await api(target, 'POST', '/cron', payload) as { id?: string };
    console.log(`[cron] created ${CRON_NAME} (${created?.id ?? 'id unknown'})`);
  }

  console.log(
    '\nThe service must carry the SAME TICK_SECRET, or every tick answers 401:\n\n' +
    '  pnpm catalyst:env\n\n' +
    'Note that setting it in app-config.json is not enough — Catalyst does not\n' +
    'apply env_variables on redeploy. See scripts/set-appsail-env.ts.\n'
  );
}

main().catch((e) => {
  console.error(`\n[cron] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
