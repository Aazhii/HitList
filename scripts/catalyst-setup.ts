/**
 * Creates the HitList tables and columns in a Catalyst project.
 *
 *   pnpm catalyst:setup            # create anything missing, then report
 *   pnpm catalyst:setup --dry-run  # report only, change nothing
 *
 * Why a script rather than the runtime provisioner this replaces: the server
 * used to create columns on every boot by reaching into private SDK fields
 * (`table.requester.send`) to POST undocumented endpoints, typing every column
 * as `text` because it had no type information. Schema changes belong in an
 * explicit, reviewable step, not in the request path.
 *
 * Credentials, in order of preference:
 *   1. CATALYST_* in .env.local — see .env.example
 *   2. ~/.catalystrc            — written by `catalyst login`
 *
 * The Data Store admin API is REST; the Node SDK exposes no createTable.
 */
import { SCHEMA, type ColumnSpec } from '../server/catalyst/schema.ts';
import { endpointsFor } from '../server/catalyst/dc.ts';
import { accessTokenFromCli, readCatalystRc } from '../server/catalyst/cliCredentials.ts';

const DRY_RUN = process.argv.includes('--dry-run');

interface Target {
  projectId: string;
  orgId?: string;
  environment: string;
  accessToken: string;
  consoleUrl: string;
  source: string;
}

/** Explicit CATALYST_* credentials: an OAuth client plus a refresh token. */
async function fromEnv(): Promise<Target | null> {
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
async function fromCli(): Promise<Target | null> {
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

async function api(
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

function columnPayload(col: ColumnSpec) {
  return {
    column_name: col.name,
    data_type: col.type,
    ...(col.maxLength ? { max_length: col.maxLength } : {}),
    is_mandatory: col.mandatory ? 'true' : 'false',
    is_unique:    col.unique ? 'true' : 'false',
    search_index_enabled: 'false',
    audit_consent: 'false',
  };
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
async function withRetry<T>(op: () => Promise<T>, what: string, attempts = 4): Promise<T> {
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
async function resolveTableId(target: Target, name: string, attempts = 6): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    const tables = await api(target, 'GET', '/table') as Array<Record<string, unknown>>;
    const match = (tables ?? []).find((t) => String(t['table_name']) === name);
    if (match) return String(match['table_id']);
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  return null;
}

async function main(): Promise<void> {
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

  console.log(`[setup] project ${target.projectId} (${target.environment})`);
  console.log(`[setup] endpoint ${target.consoleUrl}`);
  console.log(`[setup] credentials from ${target.source}`);
  if (DRY_RUN) console.log('[setup] dry run — nothing will be created');
  console.log('');

  const existing = await api(target, 'GET', '/table') as Array<Record<string, unknown>>;
  const byName = new Map<string, string>();
  for (const t of existing ?? []) {
    byName.set(String(t['table_name']), String(t['table_id']));
  }
  console.log(`[setup] ${byName.size} existing table(s): ${[...byName.keys()].join(', ') || '(none)'}\n`);

  let created = 0;
  for (const table of SCHEMA) {
    let tableId: string | undefined = byName.get(table.name);

    if (!tableId) {
      console.log(`[setup] table ${table.name}: MISSING`);
      if (DRY_RUN) { console.log('          would create it and all columns\n'); continue; }
      await api(target, 'POST', '/table', { table_name: table.name, table_scope: 'GLOBAL' });
      created++;

      // Do not trust table_id from the create response — it came back one less
      // than the table's real id, and the column endpoint then 404s with
      // INVALID_ID. Re-list and match on the name, which is authoritative.
      // Creation also settles asynchronously, so allow a few attempts.
      tableId = (await resolveTableId(target, table.name)) ?? undefined;
      if (!tableId) {
        throw new Error(
          `Created ${table.name} but it did not appear in the table list. ` +
          `Check the Catalyst console before re-running.`
        );
      }
      console.log(`          created (id ${tableId})`);
    } else {
      console.log(`[setup] table ${table.name}: ok (id ${tableId})`);
    }

    const cols = await api(target, 'GET', `/table/${tableId}/column`) as Array<Record<string, unknown>>;
    const have = new Set((cols ?? []).map((c) => String(c['column_name'])));
    const missing = table.columns.filter((c) => !have.has(c.name));

    if (!missing.length) { console.log('          all columns present\n'); continue; }

    console.log(`          ${missing.length} missing column(s): ${missing.map((c) => c.name).join(', ')}`);
    if (DRY_RUN) { console.log(''); continue; }

    for (const col of missing) {
      try {
        await withRetry(
          () => api(target, 'POST', `/table/${tableId}/column`, [columnPayload(col)]),
          `create column ${table.name}.${col.name}`,
        );
        console.log(`            + ${col.name} (${col.type})`);
        created++;
      } catch (e) {
        const msg = String(e);
        if (/already exists|duplicate/i.test(msg)) {
          console.log(`            ~ ${col.name} already exists`);
        } else if (/reserved keyword/i.test(msg)) {
          throw new Error(
            `Catalyst rejects the column name "${col.name}" as a reserved keyword.\n` +
            `  Rename it in server/catalyst/schema.ts (and in the server's row ` +
            `converters) — this is why Priority is stored as TaskPriority.`
          );
        } else {
          throw new Error(`Failed to create column ${table.name}.${col.name}: ${msg}`);
        }
      }
    }
    console.log('');
  }

  console.log(DRY_RUN
    ? '[setup] dry run complete.'
    : `[setup] done — ${created} object(s) created.`);
  console.log(
    '\nIf writes still fail with a permission error, grant the App User role\n' +
    'INSERT/UPDATE/DELETE on these tables in the console: Catalyst grants\n' +
    'SELECT only by default, which silently breaks every write.'
  );
}

main().catch((e) => {
  console.error(`\n[setup] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
