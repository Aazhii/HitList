/**
 * Sets environment variables on the deployed AppSail service.
 *
 *   TICK_SECRET=… pnpm catalyst:env
 *   pnpm catalyst:env --dry-run
 *
 * This writes the deployed AppSail service configuration after a Docker image
 * deployment. The live service otherwise comes back still answering
 *
 *   503 {"error":"not_configured","message":"TICK_SECRET is not set…"}
 *
 * with `GET /appsail` showing only the variables the service was originally
 * created with.
 *
 * There is no CLI command for this either — `catalyst appsail:add` is the only
 * appsail subcommand, and `config:set` writes local CLI config, not service
 * environment. The endpoint that does work is undocumented and answers only to
 * POST:
 *
 *   POST /appsail/{id}/configuration  { environment: { variables: { … } } }
 *
 * GET and PUT on that same path both return `INVALID_REQUEST_METHOD`, which is
 * how it was found.
 *
 * The write REPLACES the whole variable set, so every variable the service
 * needs has to be sent together — which is why this script owns the full list
 * rather than patching one key.
 *
 * ORDER MATTERS. A deploy RESETS the service's environment, discarding anything
 * set since the last one, so this runs AFTER the deploy and not before:
 *
 *   catalyst deploy appsail --name hitlist-api
 *   pnpm catalyst:env
 */
import { api, resolveTarget, type Target } from './lib/catalystAdmin.ts';

const DRY_RUN = process.argv.includes('--dry-run');

const SERVICE_NAME = process.env['APPSAIL_NAME'] ?? 'hitlist-api';

// HitList2 (org 60088007808). Add the Slate app's origin here once it exists,
// or pass APPSAIL_ALLOWED_ORIGINS; an origin that is not listed gets no CORS
// headers and its API calls fail in the browser.
const DEFAULT_ORIGINS = [
  'https://hitlist-oeiefiri.onslate.in',
  'https://hitlist-api-50045941899.development.catalystappsail.in',
].join(',');

/**
 * Every variable the service should carry.
 *
 * The write replaces the set, so anything omitted here is removed from the
 * running service. Empty values are dropped rather than sent: Catalyst does not
 * store them, and sending one would only look like it had been set.
 */
function variables(): Record<string, string> {
  const all: Record<string, string> = {
    ALLOWED_ORIGINS: process.env['APPSAIL_ALLOWED_ORIGINS'] ?? DEFAULT_ORIGINS,
    TICK_SECRET: (process.env['TICK_SECRET'] ?? '').trim(),
    DEFAULT_TIMEZONE: (process.env['DEFAULT_TIMEZONE'] ?? 'Asia/Kolkata').trim(),
    NOTIFY_FROM_EMAIL: (process.env['NOTIFY_FROM_EMAIL'] ?? '').trim(),
    NOTIFY_DISABLED_CHANNELS: (process.env['NOTIFY_DISABLED_CHANNELS'] ?? '').trim(),
    // How often the in-process sweep runs. Unset means five minutes.
    SWEEP_INTERVAL_MS: (process.env['SWEEP_INTERVAL_MS'] ?? '').trim(),
    // Set to 1 to stop the service sweeping, leaving only the hourly cron.
    SWEEP_DISABLED: (process.env['SWEEP_DISABLED'] ?? '').trim(),
  };

  return Object.fromEntries(Object.entries(all).filter(([, v]) => v !== ''));
}

/** Shows a value without printing a secret into a terminal or a CI log. */
function redact(name: string, value: string): string {
  if (!/SECRET|TOKEN|KEY|PASSWORD/i.test(name)) return value;
  return `${value.slice(0, 6)}… (${value.length} chars)`;
}

interface AppSailService { id: string; name: string }

async function findService(target: Target, name: string): Promise<AppSailService | null> {
  const services = await api(target, 'GET', '/appsail') as AppSailService[];
  return services?.find((s) => s.name === name) ?? null;
}

async function main(): Promise<void> {
  const target = await resolveTarget('env');

  const service = await findService(target, SERVICE_NAME);
  if (!service) {
    console.error(
      `\nNo AppSail service named "${SERVICE_NAME}" in this project.\n` +
      'Deploy it first, or set APPSAIL_NAME.\n'
    );
    process.exit(1);
  }

  const vars = variables();

  console.log(`[env] service ${service.name} (${service.id})`);
  for (const [name, value] of Object.entries(vars)) {
    console.log(`[env]   ${name}=${redact(name, value)}`);
  }

  if (!vars['TICK_SECRET']) {
    console.warn(
      '\n[env] TICK_SECRET is not among them, so notification delivery stays\n' +
      '      disabled. The sweep endpoint refuses to run without it rather than\n' +
      '      defaulting to open. Generate one and pass it here AND to the cron:\n\n' +
      '        export TICK_SECRET=$(openssl rand -hex 32)\n' +
      '        pnpm catalyst:env\n' +
      '        pnpm catalyst:cron\n'
    );
  }

  if (DRY_RUN) {
    console.log('\n[env] dry run — nothing was changed.');
    return;
  }

  await api(target, 'POST', `/appsail/${service.id}/configuration`, {
    environment: { variables: vars },
  });

  console.log('\n[env] applied. The service picks these up within a few seconds.');
  console.log('[env] verify with:');
  console.log('  curl -s -X POST <appsail-url>/api/internal/tick');
  console.log('  # 401 "Invalid tick secret" means the secret IS set');
  console.log('  # 503 "not_configured" means it is not');
}

main().catch((e) => {
  console.error(`\n[env] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
