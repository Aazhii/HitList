/**
 * Read-only export of Data Store tables, taken before any schema change.
 *
 *   node --import tsx scripts/backup-tables.mjs [--tables KaizenTasks,KaizenNotes]
 *
 * Writes backups/<timestamp>/<table>.json (every column, every owner) and
 * prints the row count of each table, so the same counts can be compared after
 * the change. Nothing is written to Catalyst.
 *
 * The backups directory is git-ignored: it holds real user data.
 */
import fs from 'node:fs';
import path from 'node:path';
import { accessTokenFromCli, readCatalystRc } from '../server/catalyst/cliCredentials.ts';
import { endpointsFor } from '../server/catalyst/dc.ts';
import { SCHEMA } from '../server/catalyst/schema.ts';
import { parseCatalystJson } from './catalyst-json.mjs';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const TABLES = (arg('tables') ?? 'KaizenTasks,KaizenNotes').split(',').map((t) => t.trim()).filter(Boolean);
const known = new Set(SCHEMA.map((t) => t.name));
for (const t of TABLES) {
  if (!known.has(t)) { console.error(`Unknown table: ${t}`); process.exit(1); }
}

const project = readCatalystRc();
const creds = await accessTokenFromCli(true);
if (!project || !creds) {
  console.error('No Catalyst CLI login. Run: catalyst login');
  process.exit(1);
}
const { console: consoleUrl } = endpointsFor(creds.dataCentre);

async function query(sql) {
  const res = await fetch(`${consoleUrl}/baas/v1/project/${project.projectId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Zoho-oauthtoken ${creds.accessToken}`,
      'CATALYST-ORG': project.orgId,
      Environment: process.env['CATALYST_ENVIRONMENT'] ?? 'Development',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`query -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? parseCatalystJson(text) : null;
}

// ZCQL returns at most 300 rows per query, so page through by offset in ROWID
// order until a short page comes back.
const PAGE = 300;

async function exportTable(table) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const q = await query(`SELECT * FROM ${table} ORDER BY ROWID ASC LIMIT ${offset},${PAGE}`);
    const page = (q?.data ?? []).map((r) => r[table]);
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  // Paging by offset can repeat a row if one is inserted mid-export; keep the
  // first copy of each ROWID so the count is the table's, not the pager's.
  const seen = new Set();
  return rows.filter((r) => {
    const id = String(r.ROWID);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = path.join(process.cwd(), 'backups', stamp);
fs.mkdirSync(dir, { recursive: true });

console.log(`${project.projectName} (${process.env['CATALYST_ENVIRONMENT'] ?? 'Development'}) → ${path.relative(process.cwd(), dir)}\n`);

const counts = {};
for (const table of TABLES) {
  const rows = await exportTable(table);
  fs.writeFileSync(path.join(dir, `${table}.json`), JSON.stringify(rows, null, 2));
  counts[table] = rows.length;
  console.log(`  ${table}: ${rows.length} row(s)`);
}
fs.writeFileSync(path.join(dir, 'counts.json'), JSON.stringify({ takenAt: new Date().toISOString(), counts }, null, 2));
console.log('\nRead-only: nothing in Catalyst was changed.');
