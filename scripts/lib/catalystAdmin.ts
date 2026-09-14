/**
 * The Catalyst admin REST API, and the credentials to reach it.
 *
 * Shared by the setup scripts rather than reimplemented in each, because the
 * two awkward parts — resolving credentials from either .env.local or the CLI's
 * own login, and parsing responses without mangling BigInt ids — are exactly
 * the parts that are easy to get subtly wrong a second time.
 *
 * The Node SDK does not expose these admin operations (no createTable, no
 * project-scoped cron listing before a cron exists), so this is REST.
 */
import { endpointsFor } from '../../server/catalyst/dc.ts';
import { accessTokenFromCli, readCatalystRc } from '../../server/catalyst/cliCredentials.ts';

export interface Target {
  projectId: string;
  orgId?: string;
  environment: string;
  accessToken: string;
  consoleUrl: string;
  source: string;
}

/** Explicit CATALYST_* credentials: an OAuth client plus a refresh token. */
/** Explicit CATALYST_* credentials: an OAuth client plus a refresh token. */
export async function fromEnv(): Promise<Target | null> {
  const get = (n: string) => (process.env[n] ?? '').trim();
  const projectId    = get('CATALYST_PROJECT_ID');
  const clientId     = get('CATALYST_CLIENT_ID');
  const clientSecret = get('CATALYST_CLIENT_SECRET');
  const refreshToken = get('CATALYST_REFRESH_TOKEN');
  if (!projectId || !clientId || !clientSecret || !refreshToken) return null;

  const { console: consoleUrl, accounts } = endpointsFor(get('CATALYST_DC') || undefined);

  const body = new URLSearchParams({
    refresh_token: refreshToken, client_id: clientId,
    client_secret: clientSecret, grant_type: 'refresh_token',
  });
  const res  = await fetch(new URL('/oauth/v2/token', accounts), { method: 'POST', body });
  const json = await res.json() as { access_token?: string; error?: string };
  if (!json.access_token) {
    throw new Error(
      `Could not exchange CATALYST_REFRESH_TOKEN for an access token: ${json.error ?? res.status}.\n` +
      `  Check the client id/secret, and that the client was issued in the same data centre (${accounts}).`
    );
  }

  return {
    projectId,
    orgId: get('CATALYST_ORG_ID') || undefined,
    environment: get('CATALYST_ENVIRONMENT') || 'Development',
    accessToken: json.access_token,
    consoleUrl,
    source: '.env.local',
  };
}

/** The CLI's own login, after `catalyst login` + `catalyst init`. */
export async function fromCli(): Promise<Target | null> {
  const creds = await accessTokenFromCli();
  if (!creds) return null;

  const rc = readCatalystRc();
  const projectId = (process.env['CATALYST_PROJECT_ID'] ?? '').trim() || rc?.projectId;
  if (!projectId) return null;

  const { console: consoleUrl } = endpointsFor(creds.dataCentre);
  return {
    projectId,
    orgId: (process.env['CATALYST_ORG_ID'] ?? '').trim() || rc?.orgId || undefined,
    environment: (process.env['CATALYST_ENVIRONMENT'] ?? 'Development').trim(),
    accessToken: creds.accessToken,
    consoleUrl,
    source: `catalyst CLI login (dc: ${creds.dataCentre})${rc ? ` + .catalystrc${rc.projectName ? ` [${rc.projectName}]` : ''}` : ''}`,
  };
}

export async function api(
  c: Target, method: string, apiPath: string, body?: unknown,
): Promise<unknown> {
  const url = `${c.consoleUrl}/baas/v1/project/${c.projectId}${apiPath}`;
  const headers: Record<string, string> = {
    Authorization: `Zoho-oauthtoken ${c.accessToken}`,
    'Content-Type': 'application/json',
    Environment: c.environment,
  };
  if (c.orgId) headers['CATALYST-ORG'] = c.orgId;

  const res = await fetch(url, {
    method, headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let parsed: unknown;
  try { parsed = text ? parseJsonPreservingBigIds(text) : null; } catch { parsed = text; }

  if (!res.ok) {
    throw new Error(`${method} ${apiPath} -> ${res.status}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`);
  }
  return (parsed as { data?: unknown })?.data ?? parsed;
}

/**
 * Parses a Catalyst response without mangling its identifiers.
 *
 * Catalyst ids are BigInt — table_id 69251000000063001 for this project — and
 * they arrive as bare JSON numbers. That is larger than Number.MAX_SAFE_INTEGER
 * (9007199254740991), so JSON.parse silently rounds it to ...63000. Every
 * subsequent call using that id then fails with
 *   404 {"error_code":"INVALID_ID","message":"No such Table with the given id exists"}
 * which looks like the table does not exist rather than like a rounding error.
 *
 * Quote long integer literals before parsing so they survive as strings, which
 * is how we use them anyway.
 */
function parseJsonPreservingBigIds(text: string): unknown {
  // Only touch values (after a colon or a comma/bracket in an array) that are
  // runs of 16+ digits — far above any count or length the API returns.
  const safe = text.replace(/([:[,]\s*)(\d{16,})(?=\s*[,}\]])/g, '$1"$2"');
  return JSON.parse(safe);
}

/**
 * Retries an operation through transient server-side failures.
 *
 * The Data Store admin API intermittently answers column creation with a 500
 * INTERNAL_SERVER_ERROR and succeeds on a retry, so a single failure should not
 * abandon a half-built schema. Only 5xx and network errors are retried — a 4xx
 * is a real answer (a bad name, a reserved keyword) and retrying it just
 * repeats the mistake.
 */
export async function withRetry<T>(op: () => Promise<T>, what: string, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await op();
    } catch (e) {
      lastError = e;
      const msg = String(e);
      const transient = / 5\d\d:/.test(msg) || /INTERNAL_SERVER_ERROR|ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg);
      if (!transient || i === attempts - 1) throw e;
      const waitMs = 1500 * (i + 1);
      console.log(`            … ${what} failed transiently, retrying in ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastError;
}

/** Looks a table up by name, retrying while creation settles server-side. */
/**
 * Resolves credentials, or explains how to provide them and exits.
 *
 * Exiting here rather than returning null keeps every caller from repeating
 * the same message — and the message is the whole value, because "no
 * credentials" is the single most common way these scripts fail.
 */
export async function resolveTarget(label: string): Promise<Target> {
  const target = (await fromEnv()) ?? (await fromCli());
  if (!target) {
    console.error(
      'No Catalyst credentials found.\n\n' +
      'Either:\n' +
      '  1. Run `catalyst login`, then `catalyst init --org <orgId> -p <projectId> -ni`\n' +
      '  2. Or set CATALYST_PROJECT_ID, CATALYST_CLIENT_ID, CATALYST_CLIENT_SECRET and\n' +
      '     CATALYST_REFRESH_TOKEN in .env.local — see .env.example.\n'
    );
    process.exit(1);
  }

  console.log(`[${label}] project ${target.projectId} (${target.environment})`);
  console.log(`[${label}] endpoint ${target.consoleUrl}`);
  console.log(`[${label}] credentials from ${target.source}`);
  return target;
}
