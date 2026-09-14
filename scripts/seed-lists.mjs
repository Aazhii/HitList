/**
 * Creates the app's default lists for a user in Catalyst Data Store.
 *
 *   node --import tsx scripts/seed-lists.mjs --owner <userId> [--apply]
 *
 * Tasks created while the app was still running on localStorage carry the seed
 * list ids (list-daily, list-work, list-health) that only ever existed in the
 * browser. Once the server became the source of truth those tasks pointed at
 * lists Catalyst had never heard of, so the sidebar was empty and every task
 * was filtered out by a list that did not exist.
 *
 * Dry run by default — pass --apply to write.
 */
import { accessTokenFromCli, readCatalystRc } from '../server/catalyst/cliCredentials.ts';
import { endpointsFor } from '../server/catalyst/dc.ts';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const OWNER = arg('owner');
const APPLY = process.argv.includes('--apply');
if (!OWNER) { console.error('Usage: --owner <userId> [--apply]'); process.exit(1); }

// Must match src/lib/storage.ts, which is what existing tasks reference.
const LISTS = [
  { ListId: 'list-daily',  Name: 'Daily Growth',      Color: 'emerald', ListOrder: 0 },
  { ListId: 'list-work',   Name: 'Work Focus',        Color: 'blue',    ListOrder: 1 },
  { ListId: 'list-health', Name: 'Health & Wellness', Color: 'rose',    ListOrder: 2 },
];

const project = readCatalystRc();
const creds = await accessTokenFromCli(true);
if (!project || !creds) { console.error('No Catalyst CLI login. Run: catalyst login'); process.exit(1); }
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

const existing = await api('POST', '/query', {
  query: `SELECT ListId FROM KaizenLists WHERE OwnerId = '${OWNER.replace(/'/g, "''")}'`,
});
const have = new Set((existing?.data ?? []).map((r) => r.KaizenLists.ListId));

const missing = LISTS.filter((l) => !have.has(l.ListId));
console.log(`owner ${OWNER}: ${have.size} list(s) present, ${missing.length} missing${APPLY ? '' : '  (dry run)'}\n`);
if (!missing.length) { console.log('nothing to do.'); process.exit(0); }

for (const l of missing) console.log(`  ${l.ListId.padEnd(12)} ${l.Name}`);
if (!APPLY) { console.log('\nRe-run with --apply to create them.'); process.exit(0); }

const now = Date.now();
// A BARE ARRAY, not {data: [...]}. The published REST docs show the wrapper for
// insert, but this API rejects it with INVALID_INPUT — same as the update path.
await api('POST', '/table/KaizenLists/row',
  missing.map((l) => ({ ...l, OwnerId: OWNER, CreatedAt: now, UpdatedAt: now })));
console.log(`\ncreated ${missing.length} list(s).`);
