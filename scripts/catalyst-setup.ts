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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SCHEMA, type ColumnSpec } from '../server/catalyst/schema.ts';

const DRY_RUN = process.argv.includes('--dry-run');

const ACCOUNTS_URL = process.env['X_ZOHO_CATALYST_ACCOUNTS_URL'] ?? 'https://accounts.zoho.com';
const CONSOLE_URL  = process.env['X_ZOHO_CATALYST_CONSOLE_URL']  ?? 'https://api.catalyst.zoho.com';

interface Creds {
  projectId: string;
  orgId?: string;
  environment: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  source: string;
}

function fromEnv(): Creds | null {
  const get = (n: string) => (process.env[n] ?? '').trim();
  const c = {
    projectId:    get('CATALYST_PROJECT_ID'),
    orgId:        get('CATALYST_ORG_ID') || undefined,
    environment:  get('CATALYST_ENVIRONMENT') || 'Development',
    clientId:     get('CATALYST_CLIENT_ID'),
    clientSecret: get('CATALYST_CLIENT_SECRET'),
    refreshToken: get('CATALYST_REFRESH_TOKEN'),
    source: '.env.local',
  };
  return c.projectId && c.clientId && c.clientSecret && c.refreshToken ? c : null;
}

/** `catalyst login` stores its OAuth grant here. Shapes vary by CLI version. */
function fromCatalystRc(): Creds | null {
  const rcPath = path.join(os.homedir(), '.catalystrc');
  if (!fs.existsSync(rcPath)) return null;

  let rc: Record<string, unknown>;
  try {
    rc = JSON.parse(fs.readFileSync(rcPath, 'utf8')) as Record<string, unknown>;
  } catch {
    console.warn(`[setup] ${rcPath} is not valid JSON — ignoring it.`);
    return null;
  }

  // Walk the file for the first object carrying a refresh token.
  const found = findTokenBearer(rc);
  if (!found) return null;

  const projectId = (process.env['CATALYST_PROJECT_ID'] ?? '').trim() || readProjectIdFromCatalystJson();
  if (!projectId) return null;

  return {
    projectId,
    orgId:        (process.env['CATALYST_ORG_ID'] ?? '').trim() || undefined,
    environment:  (process.env['CATALYST_ENVIRONMENT'] ?? 'Development').trim(),
    clientId:     found.clientId,
    clientSecret: found.clientSecret,
    refreshToken: found.refreshToken,
    source: rcPath,
  };
}

function findTokenBearer(
  node: unknown,
): { clientId: string; clientSecret: string; refreshToken: string } | null {
  if (!node || typeof node !== 'object') return null;
  const o = node as Record<string, unknown>;

  const pick = (...keys: string[]): string => {
    for (const k of keys) if (typeof o[k] === 'string' && o[k]) return o[k] as string;
    return '';
  };
  const refreshToken = pick('refresh_token', 'refreshToken');
  const clientId     = pick('client_id', 'clientId');
  const clientSecret = pick('client_secret', 'clientSecret');
  if (refreshToken && clientId && clientSecret) return { clientId, clientSecret, refreshToken };

  for (const v of Object.values(o)) {
    const nested = findTokenBearer(v);
    if (nested) return nested;
  }
  return null;
}

function readProjectIdFromCatalystJson(): string {
  const p = path.join(process.cwd(), 'catalyst.json');
  if (!fs.existsSync(p)) return '';
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
    const id = (j['project_id'] ?? j['projectId']) as string | number | undefined;
    return id ? String(id) : '';
  } catch { return ''; }
}

async function getAccessToken(c: Creds): Promise<string> {
  const url = new URL('/oauth/v2/token', ACCOUNTS_URL);
  const body = new URLSearchParams({
    refresh_token: c.refreshToken,
    client_id:     c.clientId,
    client_secret: c.clientSecret,
    grant_type:    'refresh_token',
  });
  const res = await fetch(url, { method: 'POST', body });
  const json = await res.json() as { access_token?: string; error?: string };
  if (!json.access_token) {
    throw new Error(
      `Could not exchange the refresh token for an access token: ${json.error ?? res.status}.\n` +
      `  Check CATALYST_CLIENT_ID / CATALYST_CLIENT_SECRET / CATALYST_REFRESH_TOKEN,\n` +
      `  and that the client was issued for ${ACCOUNTS_URL}.`
    );
  }
  return json.access_token;
}

async function api(
  c: Creds, token: string, method: string, apiPath: string, body?: unknown,
): Promise<unknown> {
  const url = `${CONSOLE_URL}/baas/v1/project/${c.projectId}${apiPath}`;
  const headers: Record<string, string> = {
    Authorization: `Zoho-oauthtoken ${token}`,
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
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }

  if (!res.ok) {
    throw new Error(`${method} ${apiPath} -> ${res.status}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`);
  }
  return (parsed as { data?: unknown })?.data ?? parsed;
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

async function main(): Promise<void> {
  const creds = fromEnv() ?? fromCatalystRc();
  if (!creds) {
    console.error(
      'No Catalyst credentials found.\n\n' +
      'Either:\n' +
      '  1. Run `catalyst login`, then `catalyst init --org <orgId> -p <projectId> -ni`\n' +
      '  2. Or set CATALYST_PROJECT_ID, CATALYST_CLIENT_ID, CATALYST_CLIENT_SECRET and\n' +
      '     CATALYST_REFRESH_TOKEN in .env.local — see .env.example.\n'
    );
    process.exit(1);
  }

  console.log(`[setup] project ${creds.projectId} (${creds.environment}) via ${creds.source}`);
  if (DRY_RUN) console.log('[setup] dry run — nothing will be created\n');

  const token = await getAccessToken(creds);

  const existing = await api(creds, token, 'GET', '/table') as Array<Record<string, unknown>>;
  const byName = new Map<string, string>();
  for (const t of existing ?? []) {
    byName.set(String(t['table_name']), String(t['table_id']));
  }
  console.log(`[setup] ${byName.size} existing table(s): ${[...byName.keys()].join(', ') || '(none)'}\n`);

  let created = 0;
  for (const table of SCHEMA) {
    let tableId = byName.get(table.name);

    if (!tableId) {
      console.log(`[setup] table ${table.name}: MISSING`);
      if (DRY_RUN) { console.log('          would create it and all columns\n'); continue; }
      const res = await api(creds, token, 'POST', '/table', {
        table_name: table.name, table_scope: 'GLOBAL',
      }) as Record<string, unknown>;
      tableId = String(res['table_id']);
      created++;
      console.log(`          created (id ${tableId})`);
    } else {
      console.log(`[setup] table ${table.name}: ok (id ${tableId})`);
    }

    const cols = await api(creds, token, 'GET', `/table/${tableId}/column`) as Array<Record<string, unknown>>;
    const have = new Set((cols ?? []).map((c) => String(c['column_name'])));
    const missing = table.columns.filter((c) => !have.has(c.name));

    if (!missing.length) { console.log('          all columns present\n'); continue; }

    console.log(`          ${missing.length} missing column(s): ${missing.map((c) => c.name).join(', ')}`);
    if (DRY_RUN) { console.log(''); continue; }

    for (const col of missing) {
      try {
        await api(creds, token, 'POST', `/table/${tableId}/column`, [columnPayload(col)]);
        console.log(`            + ${col.name} (${col.type})`);
        created++;
      } catch (e) {
        const msg = String(e);
        if (/already exists|duplicate/i.test(msg)) console.log(`            ~ ${col.name} already exists`);
        else throw new Error(`Failed to create column ${table.name}.${col.name}: ${msg}`);
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
