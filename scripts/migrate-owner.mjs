/**
 * Reassigns rows from one OwnerId to another.
 *
 *   node --import tsx scripts/migrate-owner.mjs --from <owner> --to <owner> [--apply]
 *
 * Needed once, when the app moved from a single shared owner to real
 * per-user Catalyst identities: rows written as "hitlist-shared" would
 * otherwise become invisible to everyone the moment scoping turned on.
 *
 * Dry run by default — pass --apply to write.
 */
import { accessTokenFromCli, readCatalystRc } from '../server/catalyst/cliCredentials.ts';
import { endpointsFor } from '../server/catalyst/dc.ts';
import { SCHEMA } from '../server/catalyst/schema.ts';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const FROM = arg('from');
const TO = arg('to');
const APPLY = process.argv.includes('--apply');

if (!FROM || !TO) {
  console.error('Usage: --from <ownerId> --to <ownerId> [--apply]');
  process.exit(1);
}

const project = readCatalystRc();
const creds = await accessTokenFromCli(true);
if (!project || !creds) {
  console.error('No Catalyst CLI login. Run: catalyst login');
  process.exit(1);
}
const { console: consoleUrl } = endpointsFor(creds.dataCentre);

async function api(method, path, body) {
  const res = await fetch(`${consoleUrl}/baas/v1/project/${project.projectId}${path}`, {
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${creds.accessToken}`,
      'CATALYST-ORG': project.orgId,
      Environment: process.env['CATALYST_ENVIRONMENT'] ?? 'Development',
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

console.log(`${project.projectName}: "${FROM}" -> "${TO}"${APPLY ? '' : '  (dry run)'}\n`);

let total = 0;
for (const table of SCHEMA) {
  const q = await api('POST', '/query', {
    query: `SELECT ROWID FROM ${table.name} WHERE OwnerId = '${FROM.replace(/'/g, "''")}'`,
  });
  const rows = (q?.data ?? []).map((r) => r[table.name]);
  if (!rows.length) { console.log(`  ${table.name}: nothing to move`); continue; }

  console.log(`  ${table.name}: ${rows.length} row(s)`);
  total += rows.length;
  if (!APPLY) continue;

  // PATCH /table/{name}/row takes a BARE ARRAY of rows, each carrying its own
  // ROWID. Not {data: [...]} — that shape is for insert and is rejected here
  // with INVALID_INPUT — and not /row/{id}, which rejects PUT with
  // INVALID_REQUEST_METHOD.
  await api('PATCH', `/table/${table.name}/row`,
    rows.map((r) => ({ ROWID: r.ROWID, OwnerId: TO })));
  console.log(`            moved ${rows.length}`);
}

console.log(
  APPLY
    ? `\nDone — ${total} row(s) reassigned.`
    : `\n${total} row(s) would move. Re-run with --apply to write.`
);
