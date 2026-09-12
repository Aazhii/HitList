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
import catalyst from 'zcatalyst-sdk-node';
import type express from 'express';

/** Headers the Catalyst gateway injects; their presence selects GATEWAY mode. */
const PROJECT_ID_HEADER = 'x-zc-projectid';
const PROJECT_KEY_HEADER = 'x-zc-project-key';

export type CatalystMode = 'gateway' | 'standalone' | 'none';

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
      `Set them in .env.local, or remove them all to use JSON-file storage. See docs/catalyst.md.`
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
): ReturnType<typeof catalyst.initializeApp> {
  if (hasGatewayHeaders(req)) {
    return catalyst.initialize(
      req as unknown as { [x: string]: unknown },
      { scope: 'admin' },
    );
  }
  if (standalone) return getStandaloneApp(standalone);

  throw new Error(
    'No Catalyst credentials available: the request carries no Catalyst gateway ' +
    'headers and no standalone configuration is set. Run under `catalyst serve` / ' +
    'AppSail, or set CATALYST_PROJECT_ID and friends. See docs/catalyst.md.'
  );
}

/** Which mode a given request would use. For /api/health and startup logging. */
export function describeMode(
  req: express.Request | null,
  standalone: StandaloneConfig | null,
): CatalystMode {
  if (req && hasGatewayHeaders(req)) return 'gateway';
  if (standalone) return 'standalone';
  return 'none';
}

/** Resets memoised state. Tests only. */
export function __resetCatalystApp(): void {
  standaloneApp = null;
}
