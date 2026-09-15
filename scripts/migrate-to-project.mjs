/**
 * Copies a table backup into another Catalyst project, reassigning every row
 * to its owner's user id in that project.
 *
 *   # Offline: show what would be imported, using made-up target user ids.
 *   node --import tsx scripts/migrate-to-project.mjs --backup backups/<dir> --plan-only
 *
 *   # Against the target (CLI logged in to the account that owns it). Dry run by default.
 *   node --import tsx scripts/migrate-to-project.mjs --backup backups/<dir> \
 *     --org <orgId> --project <projectId> [--env Development] [--include-queue] [--apply]
 *
 * Why owners are reassigned: every row belongs to a Catalyst app user id, and a
 * user invited to a new project gets a new id. Rows are matched to their new
 * owner by email, using KaizenAppUsers.json from the backup.
 *
 * What keeps this safe:
 *   - a row whose id (TaskId, NoteId, …) is already in the target is skipped,
 *     so re-running cannot duplicate anything — and users added later can be
 *     imported by running it again;
 *   - a row whose owner has no account in the target yet is not imported and
 *     is reported — it is still in the backup and can be imported later;
 *   - Catalyst's own columns (ROWID, CREATORID, CREATEDTIME, MODIFIEDTIME) are
 *     dropped, since the target assigns its own;
 *   - row counts are checked after every table, and it stops at the first
 *     table that does not match.
 *
 * The notification queue is skipped unless --include-queue: pending reminders
 * are re-created the first time each person opens the app.
 */
import fs from 'node:fs';
import path from 'node:path';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name) => process.argv.includes(`--${name}`);

const BACKUP = arg('backup');
const ORG = arg('org');
const PROJECT = arg('project');
const ENV = arg('env') ?? 'Development';
const APPLY = flag('apply');
const PLAN_ONLY = flag('plan-only');
const INCLUDE_QUEUE = flag('include-queue');

if (!BACKUP || (!PLAN_ONLY && (!ORG || !PROJECT))) {
  console.error('Usage: --backup <dir> (--plan-only | --org <id> --project <id> [--env Development] [--include-queue] [--apply])');
  process.exit(1);
}

/** Import order: parents before rows that refer to them. */
const TABLES = [
  'KaizenLists', 'KaizenTasks', 'KaizenNotes', 'KaizenAutomationRules', 'KaizenAutomationRuns',
  'KaizenNotifications', 'KaizenViews', 'KaizenPropDefs', 'KaizenTaskProps', 'KaizenNotificationQueue',
];
const SYSTEM_COLUMNS = new Set(['ROWID', 'CREATORID', 'CREATEDTIME', 'MODIFIEDTIME']);
/** Each table's own unique id column — what makes a row "already imported". */
const ID_COLUMN = {
  KaizenLists: 'ListId', KaizenTasks: 'TaskId', KaizenNotes: 'NoteId', KaizenAutomationRules: 'RuleId',
  KaizenAutomationRuns: 'RunId', KaizenNotifications: 'NotificationId', KaizenViews: 'ViewId',
  KaizenPropDefs: 'DefId', KaizenTaskProps: 'PropId', KaizenNotificationQueue: 'QueueId',
};
const CHUNK = 100;

const readJson = (file) => JSON.parse(fs.readFileSync(path.join(BACKUP, file), 'utf8'));
const oldUsers = readJson('KaizenAppUsers.json');
const emailByOldId = new Map(oldUsers.map((u) => [String(u.userId), String(u.email).toLowerCase()]));

// ── Target ────────────────────────────────────────────────────────────────────

let api;
if (!PLAN_ONLY) {
  const { accessTokenFromCli } = await import('../server/catalyst/cliCredentials.ts');
  const { endpointsFor } = await import('../server/catalyst/dc.ts');
  const creds = await accessTokenFromCli(true);
  if (!creds) { console.error('No Catalyst CLI login. Run: catalyst login'); process.exit(1); }
  const { console: consoleUrl } = endpointsFor(creds.dataCentre);
  api = async (method, p, body) => {
    const res = await fetch(`${consoleUrl}/baas/v1/project/${PROJECT}${p}`, {
      method,
      headers: {
        Authorization: `Zoho-oauthtoken ${creds.accessToken}`,
        'CATALYST-ORG': ORG, Environment: ENV, 'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${p} -> ${res.status}: ${text.slice(0, 300)}`);
    // Quote 16+ digit numbers before parsing, so ids are not rounded.
    return text ? JSON.parse(text.replace(/:(\d{16,})/g, ':"$1"')) : null;
  };
}

/** Every id already in a target table, read a page at a time. */
const existingIds = async (table) => {
  const col = ID_COLUMN[table];
  const ids = new Set();
  for (let offset = 0; ; offset += 300) {
    const r = await api('POST', '/query', { query: `SELECT ${col} FROM ${table} LIMIT ${offset},300` });
    const page = (r.data ?? []).map((row) => String(Object.values(row)[0][col]));
    page.forEach((id) => ids.add(id));
    if (page.length < 300) break;
  }
  return ids;
};

const count = async (table) => {
  const r = await api('POST', '/query', { query: `SELECT COUNT(ROWID) FROM ${table}` });
  // A row comes back as { TableName: { "COUNT(ROWID)": n } } — two levels deep.
  const n = Number(Object.values(Object.values(r.data[0])[0])[0]);
  if (!Number.isFinite(n)) throw new Error(`Could not read the row count of ${table}: ${JSON.stringify(r.data[0])}`);
  return n;
};

// New owner id per email.
const newIdByEmail = new Map();
if (PLAN_ONLY) {
  for (const email of emailByOldId.values()) newIdByEmail.set(email, `NEW-ID-FOR-${email}`);
} else {
  const users = (await api('GET', '/project-user')).data ?? [];
  for (const u of users) newIdByEmail.set(String(u.email_id).toLowerCase(), String(u.user_id));
  const existing = new Set((await api('GET', '/table')).data.map((t) => t.table_name));
  const missing = TABLES.filter((t) => !existing.has(t));
  if (missing.length) {
    console.error(`Target project is missing table(s): ${missing.join(', ')}. Run pnpm catalyst:setup against it first.`);
    process.exit(1);
  }
}

console.log(`${PLAN_ONLY ? 'PLAN ONLY (no network)' : `${APPLY ? 'APPLY' : 'DRY RUN'} → org ${ORG}, project ${PROJECT} (${ENV})`}`);
console.log(`backup: ${BACKUP}\n`);

// ── Owners ────────────────────────────────────────────────────────────────────

const ownersWithData = new Map();
for (const table of TABLES) {
  for (const row of readJson(`${table}.json`)) {
    const email = emailByOldId.get(String(row.OwnerId)) ?? null;
    ownersWithData.set(String(row.OwnerId), email);
  }
}
console.log('owners:');
for (const [oldId, email] of ownersWithData) {
  const target = email ? newIdByEmail.get(email) : undefined;
  console.log(`  ${oldId} ${email ?? '(no app user in backup)'} -> ${target ?? 'NOT IN TARGET — rows will be skipped'}`);
}
console.log('');

// ── Tables ────────────────────────────────────────────────────────────────────

const summary = [];
for (const table of TABLES) {
  if (table === 'KaizenNotificationQueue' && !INCLUDE_QUEUE) {
    summary.push(`${table}: skipped (queue; pass --include-queue to import)`);
    continue;
  }

  const rows = readJson(`${table}.json`);
  const ready = [];
  const skipped = {};
  for (const row of rows) {
    const email = emailByOldId.get(String(row.OwnerId));
    const newOwner = email ? newIdByEmail.get(email) : undefined;
    if (!newOwner) { skipped[row.OwnerId] = (skipped[row.OwnerId] ?? 0) + 1; continue; }
    const out = {};
    for (const [k, v] of Object.entries(row)) if (!SYSTEM_COLUMNS.has(k) && v !== null) out[k] = v;
    out.OwnerId = newOwner;
    ready.push(out);
  }

  const skippedText = Object.keys(skipped).length ? `, skipped ${JSON.stringify(skipped)}` : '';
  if (rows.length === 0) { summary.push(`${table}: empty`); continue; }

  if (PLAN_ONLY) {
    summary.push(`${table}: would import ${ready.length}/${rows.length}${skippedText}`);
    continue;
  }

  const before = await count(table);
  const present = await existingIds(table);
  const fresh = ready.filter((row) => !present.has(String(row[ID_COLUMN[table]])));
  const alreadyText = ready.length - fresh.length ? `, already there ${ready.length - fresh.length}` : '';
  if (!APPLY) {
    summary.push(`${table}: would import ${fresh.length}/${rows.length}${alreadyText}${skippedText}`);
    continue;
  }

  for (let i = 0; i < fresh.length; i += CHUNK) {
    await api('POST', `/table/${table}/row`, fresh.slice(i, i + CHUNK));
  }
  const after = await count(table);
  if (after !== before + fresh.length) {
    console.error(`STOP: ${table} holds ${after} row(s); expected ${before} + ${fresh.length}. Nothing further was imported.`);
    process.exit(1);
  }
  summary.push(`${table}: imported ${fresh.length}/${rows.length}${alreadyText}${skippedText} ✓`);
  console.log(summary.at(-1));
}

console.log(`\n${summary.join('\n')}`);
if (!APPLY && !PLAN_ONLY) console.log('\nDry run: nothing written. Re-run with --apply.');
