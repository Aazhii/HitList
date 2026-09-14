/**
 * Catalyst SDK initialisation.
 *
 * The bundled Catalyst documentation never explains how to initialise
 * zcatalyst-sdk-node outside a Catalyst-hosted function — every sample starts
 * from an ambient `app`. That gap is why this server has silently fallen back
 * to JSON-file storage on every local run: the old startup probe called
 * `catalyst.initialize({})`, which throws
 *
 *   CatalystAppError: unable to find the type of initialisation
 *
 * Reading the SDK, there are exactly two ways in, and this module supports
 * both.
 *
 * GATEWAY — `catalyst.initialize(req)`
 *   Reads project credentials from headers that the Catalyst gateway injects:
 *   x-zc-projectid, x-zc-project-key, x-zc-environment, x-zc-project-domain,
 *   x-zc-project-secret-key. Available when the app runs as AppSail or a
 *   Function, and locally under `catalyst serve`. Nothing to configure.
 *
 * STANDALONE — `catalyst.initializeApp({ project_id, project_key,
 *   environment, credential })`
 *   Works from any Node process, including a plain `pnpm dev`, given an OAuth
 *   refresh token. This is what lets us develop and test against a real
 *   Catalyst project without the CLI in the loop.
 *
 * Scope is 'admin' throughout. The default is 'user' scope, which applies the
 * table's row-level permissions for the signed-in App User — and Catalyst
 * grants App User SELECT only by default, so every insert, update and delete
 * would be rejected until the project was reconfigured by hand. This server
 * authenticates the caller itself and scopes every query by OwnerId, so admin
 * scope is correct here, and it is what the AppSail reference template uses.
 */
// Import order matters: region.ts sets X_ZOHO_CATALYST_CONSOLE_URL, and the SDK
// reads that once at module load. Importing it after zcatalyst-sdk-node would
// be too late and every request would go to the US host.
import { REGION } from './region.ts';
import catalyst from 'zcatalyst-sdk-node';
import type express from 'express';
import { accessTokenFromCli, readCatalystRc } from './cliCredentials.ts';

/** Headers the Catalyst gateway injects; their presence selects GATEWAY mode. */
const PROJECT_ID_HEADER = 'x-zc-projectid';
const PROJECT_KEY_HEADER = 'x-zc-project-key';

export type CatalystMode = 'gateway' | 'standalone' | 'cli' | 'none';

export interface StandaloneConfig {
  projectId: string;
  projectKey: string;
  environment: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  projectSecretKey?: string;
}

/** Reads a standalone configuration from the environment, or null if incomplete. */
export function readStandaloneConfig(): StandaloneConfig | null {
  const get = (name: string): string => (process.env[name] ?? '').trim();

  const cfg = {
    projectId:        get('CATALYST_PROJECT_ID'),
    projectKey:       get('CATALYST_PROJECT_KEY'),
    environment:      get('CATALYST_ENVIRONMENT') || 'Development',
    clientId:         get('CATALYST_CLIENT_ID'),
    clientSecret:     get('CATALYST_CLIENT_SECRET'),
    refreshToken:     get('CATALYST_REFRESH_TOKEN'),
    projectSecretKey: get('CATALYST_PROJECT_SECRET_KEY') || undefined,
  };

  const required: (keyof StandaloneConfig)[] =
    ['projectId', 'projectKey', 'clientId', 'clientSecret', 'refreshToken'];
  const missing = required.filter((k) => !cfg[k]);

  if (missing.length === required.length) return null;  // nothing configured

  if (missing.length) {
    // Partially configured is a mistake worth naming, not a silent fallback.
    const names = missing.map((k) => `CATALYST_${k.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase()}`);
    throw new Error(
      `Catalyst standalone config is incomplete. Missing: ${names.join(', ')}. ` +
      `Set them in .env.local, or remove them all to use JSON-file storage. See docs/catalyst/01-credentials.md.`
    );
  }
  return cfg as StandaloneConfig;
}

/** True when this request carries the gateway's project headers. */
export function hasGatewayHeaders(req: express.Request): boolean {
  const h = req?.headers as Record<string, unknown> | undefined;
  return !!h && typeof h[PROJECT_ID_HEADER] === 'string' && typeof h[PROJECT_KEY_HEADER] === 'string';
}

// initializeApp() throws 'duplicate_app' on a second call, so the standalone
// app is built once and reused.
let standaloneApp: ReturnType<typeof catalyst.initializeApp> | null = null;

function getStandaloneApp(cfg: StandaloneConfig) {
  if (standaloneApp) return standaloneApp;
  standaloneApp = catalyst.initializeApp({
    project_id:  cfg.projectId,
    project_key: cfg.projectKey,
    environment: cfg.environment,
    ...(cfg.projectSecretKey ? { project_secret_key: cfg.projectSecretKey } : {}),
    credential: catalyst.credential.refreshToken({
      client_id:     cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
    }),
  });
  return standaloneApp;
}

/**
 * Returns a Catalyst app for this request, preferring the gateway headers and
 * falling back to standalone credentials.
 *
 * Throws if neither is available — callers decide whether that means a 503 or
 * a switch to the JSON-file store.
 */
export function initCatalystApp(
  req: express.Request,
  standalone: StandaloneConfig | null,
  scope: 'admin' | 'user' = 'admin',
): ReturnType<typeof catalyst.initializeApp> {
  if (hasGatewayHeaders(req)) {
    // Scope decides whose identity the SDK acts as, and the two uses differ:
    //
    //   'admin' — for data. The gateway injects admin credentials, so table
    //             permissions never block a write. Catalyst grants App User
    //             SELECT only by default, so user scope would break writes.
    //
    //   'user'  — for identity. Under admin scope the SDK IS the project
    //             admin, which is not an app user, so getCurrentUser() returns
    //             null even for a signed-in visitor and every request 401s.
    //
    // Only the request's own session distinguishes them, so this must be
    // per-call rather than a single cached app.
    return catalyst.initialize(
      req as unknown as { [x: string]: unknown },
      { scope },
    );
  }
  if (standalone) return getStandaloneApp(standalone);
  // Resolved once at startup, because callers are synchronous.
  if (cliApp) return cliApp;

  throw new Error(
    'No Catalyst credentials available: the request carries no Catalyst gateway ' +
    'headers, no standalone configuration is set, and the Catalyst CLI is not ' +
    'logged in to a linked project. Run under `catalyst serve` / AppSail, run ' +
    '`catalyst login` + `catalyst init`, or set CATALYST_PROJECT_ID and friends. ' +
    'See docs/catalyst/01-credentials.md.'
  );
}

/** Which mode a given request would use. For /api/health and startup logging. */
export function describeMode(
  req: express.Request | null,
  standalone: StandaloneConfig | null,
): CatalystMode {
  if (req && hasGatewayHeaders(req)) return 'gateway';
  if (standalone) return 'standalone';
  if (cliApp) return 'cli';
  return 'none';
}

// ── CLI-backed credentials (local development) ────────────────────────────────
//
// A third way in, for `pnpm dev` on a machine where someone has run
// `catalyst login`. The CLI already holds an authorised grant; borrowing it
// means local development against the real project needs no second OAuth
// client and no secrets in .env.local.
//
// The SDK takes any object with getToken(); we hand it one that asks the CLI
// each time, so expiry is the CLI's problem rather than ours.

let cliApp: ReturnType<typeof catalyst.initializeApp> | null = null;
let cliUnavailable = false;
let cliOwner: string | null = null;
let cliAppBuiltAt = 0;
let cliAppSeq = 0;

// Catalyst access tokens last about an hour. The app is built with a static
// token (a duck-typed refreshing credential is accepted by initializeApp and
// then silently ignored — requests go out with no Authorization header), so it
// has to be rebuilt before the token goes stale. Otherwise local development
// quietly drops to JSON-file storage mid-session and the only clue is a 401.
const CLI_APP_MAX_AGE_MS = 40 * 60 * 1000;

export interface CliProject { projectId: string; orgId: string; projectName: string }

/** The project `catalyst init` linked, or null. */
export function cliProject(): CliProject | null {
  return readCatalystRc();
}

/**
 * The owner id to use when the SDK is authenticated with admin credentials
 * (CLI or standalone) rather than an end-user session.
 *
 * getCurrentUser() needs a Zoho session on the request. Admin credentials do
 * not have one — there is no end user, just a developer or a service. Failing
 * every request with 401 in that mode would make local development against the
 * real project impossible, so rows are scoped to the authenticated identity
 * instead: the CLI account's ZUID, or CATALYST_DEV_OWNER if set.
 *
 * This is single-user by construction and only applies outside gateway mode.
 * Under the gateway a real session is present and required.
 */
export function ownerForAdminMode(): string | null {
  const explicit = (process.env['DEV_OWNER_ID'] ?? process.env['CATALYST_DEV_OWNER'] ?? '').trim();
  if (explicit) return explicit;
  return cliOwner;
}

/**
 * Owner to use when running behind the gateway with no end-user session.
 *
 * This case is specific to AppSail: the gateway injects admin-scope x-zc-*
 * headers onto EVERY request, including anonymous ones, so
 * `catalyst.initialize(req)` always succeeds and cannot be used as an auth
 * check. `getCurrentUser()` returns null instead, because the injected
 * identity is the project admin rather than an app user.
 *
 * That leaves a deployment choice, and it must be explicit rather than a
 * silent default:
 *
 *   Catalyst authentication enabled — users sign in, getCurrentUser() returns
 *     them, and every row is scoped per user. Nothing more to set.
 *
 *   No Catalyst authentication — there is no user to attribute rows to. Set
 *     CATALYST_APP_OWNER to run the deployment as a single shared owner.
 *     Everyone who can reach the URL shares one dataset, which is why it is
 *     opt-in: defaulting to it would silently turn a multi-user app into a
 *     public one.
 *
 * Returns null when unset, and the request gets a 401.
 */
export function ownerForAnonymousGateway(): string | null {
  // Named APP_OWNER_ID, not CATALYST_APP_OWNER: AppSail rejects a deploy whose
  // env_variables use the reserved CATALYST_ prefix with
  //   400 environment_variables must not contain reserved keywords
  // The CATALYST_-prefixed name is still read so a local .env.local keeps
  // working, but it cannot be set on a deployment.
  const explicit = (process.env['APP_OWNER_ID'] ?? process.env['CATALYST_APP_OWNER'] ?? '').trim();
  return explicit || null;
}

/** The data centre and API host in effect. Reported at startup. */
export function region(): { dataCentre: string; consoleUrl: string } {
  return REGION;
}

/**
 * Builds a Catalyst app from the CLI's login, or returns null when the CLI is
 * absent, logged out, or the directory has no linked project.
 */
export async function getCliApp(
  { forceRefresh = false }: { forceRefresh?: boolean } = {},
): Promise<ReturnType<typeof catalyst.initializeApp> | null> {
  if (!forceRefresh && cliApp && Date.now() - cliAppBuiltAt < CLI_APP_MAX_AGE_MS) return cliApp;
  if (cliUnavailable && !forceRefresh) return null;
  // Past the token's usable life, or explicitly retrying after a 401.
  cliApp = null;

  const project = readCatalystRc();
  const creds = await accessTokenFromCli(forceRefresh);
  if (!project || !creds) { cliUnavailable = true; return null; }

  // Admin credentials carry no end-user session, so rows are owned by whoever
  // is logged in to the CLI. See ownerForAdminMode().
  cliOwner = creds.zuid ? `cli:${creds.zuid}` : null;

  try {
    cliApp = catalyst.initializeApp({
      project_id:  project.projectId,
      project_key: project.orgId,
      environment: process.env['CATALYST_ENVIRONMENT'] ?? 'Development',
      credential: catalyst.credential.accessToken(creds.accessToken),
      // initializeApp refuses to reuse an app name, so each rebuild gets its own.
    } as never, `hitlist-cli-${++cliAppSeq}`);
    cliAppBuiltAt = Date.now();
    return cliApp;
  } catch (e) {
    console.warn('[kaizen] Could not build a Catalyst app from the CLI login:', e);
    cliUnavailable = true;
    return null;
  }
}

/** Resets memoised state. Tests only. */
export function __resetCatalystApp(): void {
  standaloneApp = null;
  cliApp = null;
  cliUnavailable = false;
  cliOwner = null;
}
