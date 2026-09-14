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
 * Four things about Catalyst crons, each established by probing the live
 * project rather than from the documentation, and each of which silently
 * shapes what this script can do:
 *
 *   1. `cron_name` accepts only alphanumerics and underscores. A hyphen is
 *      rejected with INVALID_INPUT, which reads like a schema problem.
 *   2. A `Periodic` cron has a MINIMUM interval of 60 minutes —
 *      "Minimum Schedule time must be 60 minutes". That rules out the obvious
 *      cron_type for a five-minute sweep.
 *   3. `CronExpression` has no such floor. A standard five-field expression
 *      with a step in the minute field is accepted and stored verbatim, which
 *      is how we get five-minute granularity. See EXPRESSION below.
 *   4. An AppSail target needs NO jobpool. `target_type: 'AppSail'` with the
 *      service's `target_id` and a RELATIVE `url` is enough; the project has
 *      no jobpools at all and the cron creates cleanly.
 */
import { api, resolveTarget, type Target } from './lib/catalystAdmin.ts';

const DRY_RUN = process.argv.includes('--dry-run');
const DELETE  = process.argv.includes('--delete');

/** Underscores only — Catalyst rejects a hyphen here. */
const CRON_NAME = 'hitlist_notification_sweep';

/**
 * How often the sweep runs.
 *
 * The one number that governs cost. Every tick is one HTTP call plus one
 * indexed query that normally returns nothing, so 5 minutes is 288 invocations
 * a day and a reminder is at worst 5 minutes early. Raising it to 15 cuts that
 * by two thirds and is the first dial to turn if credits matter more than
 * precision.
 */
const EXPRESSION = process.env['SWEEP_CRON_EXPRESSION'] ?? '*/5 * * * *';

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

function cronPayload(appsailId: string, secret: string) {
  return {
    cron_name: CRON_NAME,
    description: 'Drains the HitList notification queue. See server/notifications/sweep.ts.',
    cron_status: true,
    cron_type: 'CronExpression',
    cron_expression: EXPRESSION,
    cron_detail: { timezone: 'Asia/Kolkata' },
    job_meta: {
      job_name: 'notification_sweep',
      target_type: 'AppSail',
      target_id: appsailId,
      request_method: 'POST',
      url: TICK_PATH,
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

  console.log(`[cron] target  ${service.name} (${service.id})`);
  console.log(`[cron] calls   POST ${TICK_PATH}`);
  console.log(`[cron] every   ${EXPRESSION}`);

  const payload = cronPayload(service.id, secret);

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
