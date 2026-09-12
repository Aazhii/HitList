/**
 * Kaizen — Catalyst DataStore persistence server
 * Default port: 3001 (dev). In Catalyst hosted env the platform manages the port.
 *
 * Tables used in Catalyst DataStore (auto-probed on startup):
 *
 *   PRIMARY: testTable  (pre-existing table in the Catalyst project)
 *     TaskId      (text)   — client-supplied UUID
 *     OwnerId     (text)   — Catalyst user_id
 *     Title       (text)   — task text
 *     Status      (text)   — "TODO" | "IN_PROGRESS" | "DONE"
 *     Quadrant    (text)   — "DO" | "SCHEDULE" | "DELEGATE" | "ELIMINATE"
 *     Priority    (text)   — "LOW" | "MEDIUM" | "HIGH" | ""
 *     Note        (text)
 *     DueDate     (text)   — YYYY-MM-DD
 *     DueTime     (text)   — HH:MM
 *     Category    (text)
 *     ListId      (text)
 *     TaskOrder   (text)   — stored as text for compatibility
 *     ReminderEnabled       (text) — "true" | "false"
 *     ReminderMinutesBefore (text) — stored as text
 *     CompletedAt (text)   — epoch ms as text, "0" = not completed
 *     CreatedAt   (text)   — epoch ms as text
 *     UpdatedAt   (text)   — epoch ms as text
 *
 *   FALLBACK: KaizenTasks / KaizenLists / KaizenNotes
 *     (legacy tables — used if testTable is unavailable)
 *
 *   KaizenNotes
 *     NoteId      (text, unique)
 *     OwnerId     (text)          — Catalyst user_id; scopes the note to its author
 *     Title       (text)
 *     BlocksJson  (text)
 *     Emoji       (text)
 *     Pinned      (text)  — "true" | "false"
 *     CreatedAt   (number)
 *     UpdatedAt   (number)
 *
 *   KaizenTasks
 *     TaskId      (text, unique)  — client-supplied UUID
 *     OwnerId     (text)          — Catalyst user_id
 *     Title       (text)
 *     Status      (text)          — "TODO" | "IN_PROGRESS" | "DONE"
 *     Quadrant    (text)          — "DO" | "SCHEDULE" | "DELEGATE" | "ELIMINATE"
 *     Priority    (text)          — "LOW" | "MEDIUM" | "HIGH" | ""
 *     Note        (text)
 *     DueDate     (text)          — YYYY-MM-DD
 *     DueTime     (text)          — HH:MM
 *     Category    (text)
 *     ListId      (text)
 *     TaskOrder   (number)
 *     ReminderEnabled       (text) — "true" | "false"
 *     ReminderMinutesBefore (number)
 *     CompletedAt (number)        — epoch ms, 0 = not completed
 *     CreatedAt   (number)
 *     UpdatedAt   (number)
 *
 *   KaizenLists
 *     ListId      (text, unique)
 *     OwnerId     (text)          — Catalyst user_id
 *     Name        (text)
 *     Color       (text)
 *     ListOrder   (number)
 *     CreatedAt   (number)
 *     UpdatedAt   (number)
 *
 * Falls back to JSON-file storage when Catalyst credentials are unavailable.
 */
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import catalyst from 'zcatalyst-sdk-node';
import type { ICatalystRow } from 'zcatalyst-sdk-node/lib/utils/pojo/common';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 3001;

// ── Catalyst availability ──────────────────────────────────────────────────────
//
// Catalyst is available only when the SDK can actually authenticate, which means
// the platform (or `catalyst serve`) has injected credentials into the env.
// NODE_ENV=production alone is NOT sufficient.
//
// Two kinds of signal, which must be read differently:
//
//   Value-carrying — the variable holds a credential, so a non-empty value means yes:
//     CATALYST_CONFIG                 base64 JSON, injected by the Functions runtime
//     ZOHO_CATALYST_PROJECT_KEY       legacy name
//     CATALYST_PROJECT_KEY            legacy name
//     X_ZOHO_CATALYST_LISTEN_PORT     injected by AppSail (see LISTEN_PORT below)
//
//   Boolean — the variable holds a flag whose value must be parsed:
//     X_ZOHO_CATALYST_IS_LOCAL        "true" under `catalyst serve`
//
// Reading the boolean as a presence check is what the old code did, and
// `!!"false"` is true — so X_ZOHO_CATALYST_IS_LOCAL="false" switched Catalyst ON
// and disabled the JSON-file fallback.

/** True only for a value that actually spells out truth. */
function envFlag(name: string): boolean {
  const raw = process.env[name];
  if (raw === undefined) return false;
  return ['true', '1', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

/** True when the variable carries a non-empty value. */
function envPresent(name: string): boolean {
  const raw = process.env[name];
  return raw !== undefined && raw.trim() !== '';
}

const CATALYST_ENV_SIGNALS = {
  CATALYST_CONFIG:             envPresent('CATALYST_CONFIG'),
  X_ZOHO_CATALYST_LISTEN_PORT: envPresent('X_ZOHO_CATALYST_LISTEN_PORT'),
  ZOHO_CATALYST_PROJECT_KEY:   envPresent('ZOHO_CATALYST_PROJECT_KEY'),
  CATALYST_PROJECT_KEY:        envPresent('CATALYST_PROJECT_KEY'),
  X_ZOHO_CATALYST_IS_LOCAL:    envFlag('X_ZOHO_CATALYST_IS_LOCAL'),
} as const;

// Only enable Catalyst when we have an explicit credential signal.
// Falling back to JSON-file storage is always safe and correct.
let catalystAvailable = Object.values(CATALYST_ENV_SIGNALS).some(Boolean);

// ── Auth / owner scoping ──────────────────────────────────────────────────────

// In JSON-file mode there is no identity provider, so every row belongs to a
// single local developer. This is dev-only storage; see docs/catalyst.md.
const LOCAL_DEV_OWNER = 'local-dev-user';

/** Thrown when a request carries no usable Catalyst session. */
class UnauthenticatedError extends Error {
  constructor(message = 'Valid Catalyst session required') {
    super(message);
    this.name = 'UnauthenticatedError';
  }
}

/**
 * Returns the Catalyst user_id for the authenticated user.
 *
 * getCurrentUser() needs a valid Zoho session on the request. If there isn't
 * one, that is an authentication failure and the caller gets a 401 — we do not
 * invent an identity for them.
 *
 * The previous implementation caught every failure and returned the constant
 * 'kaizen-app-owner'. Two consequences, both bad:
 *
 *   - Every anonymous caller resolved to the same owner, so all users shared
 *     one dataset and could read and delete each other's rows.
 *   - Because it could never throw, resolveOwner()'s catch was unreachable and
 *     the `if (!ownerId) return;` guard repeated at 14 call sites never fired.
 *     The API was effectively unauthenticated.
 *
 * In JSON-file mode (catalystAvailable=false) there is no session to check and
 * everything belongs to LOCAL_DEV_OWNER.
 */
async function getCurrentUserId(req: express.Request): Promise<string> {
  if (!catalystAvailable) return LOCAL_DEV_OWNER;

  let user: unknown;
  try {
    const app = initCatalyst(req);
    user = await app.userManagement().getCurrentUser();
  } catch (e) {
    throw new UnauthenticatedError(`Catalyst session lookup failed: ${String(e)}`);
  }

  // The SDK returns user_id as a number or a string depending on version.
  const uid = (user as { user_id?: string | number; userId?: string | number } | null)?.user_id
    ?? (user as { user_id?: string | number; userId?: string | number } | null)?.userId;

  if (uid === undefined || uid === null || String(uid).trim() === '') {
    throw new UnauthenticatedError('Catalyst session carries no user_id');
  }
  return String(uid);
}

/**
 * Resolves the owner for this request, or sends a 401 and returns null.
 * Callers must `return` immediately when this returns null.
 */
async function resolveOwner(req: express.Request, res: express.Response): Promise<string | null> {
  try {
    return await getCurrentUserId(req);
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      console.warn(`[kaizen] 401 ${req.method} ${req.path}: ${e.message}`);
      res.status(401).json({ error: 'unauthenticated', message: 'Valid Catalyst session required' });
      return null;
    }
    throw e;
  }
}

// ── Catalyst app init ─────────────────────────────────────────────────────────

function initCatalyst(req: express.Request) {
  return catalyst.initialize(req as unknown as { [x: string]: unknown });
}

// ── Catalyst table probe ──────────────────────────────────────────────────────
//
// On startup (when catalystAvailable=true) we probe the three required tables
// via ZCQL. If any table is missing we log a clear actionable message and
// disable Catalyst for this process (falling back to JSON-file storage).
// This prevents cryptic "table not found" errors from propagating to clients.
//
// NOTE: The Catalyst Node SDK does NOT expose a createTable() API.
//       Tables must be created once in the Catalyst console:
//       App Console → Data Store → New Table
//       Column types: text for strings, number for integers/timestamps.
//

// testTable is the pre-existing Catalyst DataStore table in this project.
// We use it as the primary tasks store. KaizenTasks/KaizenLists/KaizenNotes
// are legacy table names kept as fallback probes.
const TEST_TABLE = 'testTable';

// Columns we need in testTable for full todo CRUD.
// These are created at startup if missing (Catalyst SDK supports column creation
// via the datastore table API).
const TEST_TABLE_COLUMNS = [
  'TaskId', 'OwnerId', 'Title', 'Status', 'Quadrant', 'Priority',
  'Note', 'DueDate', 'DueTime', 'Category', 'ListId', 'TaskOrder',
  'ReminderEnabled', 'ReminderMinutesBefore', 'CompletedAt', 'CreatedAt', 'UpdatedAt',
] as const;

// REQUIRED_TABLES is used by /api/setup to report table health.
// testTable is the primary tasks store; KaizenTasks/KaizenLists/KaizenNotes are legacy.
const REQUIRED_TABLES = [
  { name: 'testTable',    probe: 'SELECT ROWID FROM testTable LIMIT 1' },
  { name: 'KaizenLists',  probe: 'SELECT ListId FROM KaizenLists LIMIT 1' },
  { name: 'KaizenNotes',  probe: 'SELECT NoteId FROM KaizenNotes LIMIT 1' },
] as const;

/**
 * Provisions missing columns in a Catalyst DataStore table using the SDK's
 * internal AuthorizedHttpClient. This avoids needing a separate REST client
 * while still being able to POST to the column endpoint.
 *
 * The SDK builds paths as: /{product}/{version}/project/{projectId}{path}
 * so we use path `/table/{tableId}/column` which maps to the column creation API.
 */
async function provisionTableColumns(
  req: express.Request,
  tableName: string,
  requiredColumns: readonly string[]
): Promise<boolean> {
  const catalystApp = initCatalyst(req);
  const ds = catalystApp.datastore();

  // Get all tables to find the numeric table ID for our target table
  let tableId: string | null = null;
  try {
    const tables = await ds.getAllTables();
    for (const t of tables) {
      const details = t.toJSON() as { table_name?: string; table_id?: string };
      if (details.table_name === tableName) {
        tableId = details.table_id ?? null;
        break;
      }
    }
  } catch (e) {
    console.warn(`[kaizen] Could not list tables for provisioning: ${e}`);
    return false;
  }

  if (!tableId) {
    console.warn(`[kaizen] Table '${tableName}' not found in getAllTables() — cannot provision columns`);
    return false;
  }

  // Get existing columns
  let existingColumnNames: Set<string> = new Set();
  try {
    const tbl = ds.table(tableId);
    const cols = await tbl.getAllColumns() as Array<{ column_name: string }>;
    existingColumnNames = new Set(cols.map((c) => c.column_name));
    console.log(`[kaizen] Existing columns in ${tableName}: ${[...existingColumnNames].join(', ')}`);
  } catch (e) {
    console.warn(`[kaizen] Could not get columns for ${tableName}: ${e}`);
    return false;
  }

  // Find missing columns
  const missing = requiredColumns.filter((col) => !existingColumnNames.has(col));
  if (missing.length === 0) {
    console.log(`[kaizen] ✓ All required columns present in ${tableName}`);
    return true;
  }

  console.log(`[kaizen] Creating ${missing.length} missing columns in ${tableName}: ${missing.join(', ')}`);

  // Use the SDK's internal requester to POST column creation requests
  // The requester is accessible via the Table instance's requester property
  const tbl = ds.table(tableId) as unknown as { requester: { send: (req: Record<string, unknown>) => Promise<unknown> } };

  let allCreated = true;
  for (const colName of missing) {
    try {
      await tbl.requester.send({
        method: 'POST',
        path: `/table/${tableId}/column`,
        data: [{ column_name: colName, data_type: 'text', is_mandatory: 'false', audit_consent: 'false' }],
        type: 'json',
        catalyst: true,
        track: true,
        user: 'admin',
      });
      console.log(`[kaizen]   ✓ Created column: ${colName}`);
    } catch (e: unknown) {
      const msg = String(e);
      // Column may already exist (race condition or partial prior run)
      if (/already exists|duplicate/i.test(msg)) {
        console.log(`[kaizen]   ~ Column already exists: ${colName}`);
      } else {
        console.warn(`[kaizen]   ✗ Failed to create column ${colName}: ${msg}`);
        allCreated = false;
      }
    }
  }

  return allCreated;
}

/**
 * Creates a table in Catalyst DataStore if it doesn't exist.
 * Uses the SDK's internal requester to POST to the table creation endpoint.
 * Returns the table ID if created/found, null on failure.
 */
async function ensureTableExists(
  req: express.Request,
  tableName: string
): Promise<string | null> {
  const catalystApp = initCatalyst(req);
  const ds = catalystApp.datastore();

  // Check if table already exists
  try {
    const tables = await ds.getAllTables();
    for (const t of tables) {
      const details = t.toJSON() as { table_name?: string; table_id?: string };
      if (details.table_name === tableName) {
        console.log(`[kaizen] ✓ Table '${tableName}' already exists (id: ${details.table_id})`);
        return details.table_id ?? null;
      }
    }
  } catch (e) {
    console.warn(`[kaizen] Could not list tables: ${e}`);
    return null;
  }

  // Table doesn't exist — create it using the SDK's internal requester
  console.log(`[kaizen] Creating table '${tableName}'...`);
  try {
    // Access the datastore's requester via the internal structure
    const dsInternal = ds as unknown as { requester: { send: (req: Record<string, unknown>) => Promise<{ data: { data: { table_id?: string } } }> } };
    const resp = await dsInternal.requester.send({
      method: 'POST',
      path: '/table',
      data: { table_name: tableName, table_scope: 'GLOBAL' },
      type: 'json',
      catalyst: true,
      track: true,
      user: 'admin',
    });
    const created = (resp as { data: { data: { table_id?: string } } }).data?.data;
    const newId = created?.table_id;
    console.log(`[kaizen] ✓ Created table '${tableName}' (id: ${newId})`);
    return newId ?? null;
  } catch (e) {
    console.warn(`[kaizen] Failed to create table '${tableName}': ${e}`);
    return null;
  }
}

/**
 * Probes Catalyst DataStore tables and auto-provisions missing columns.
 *
 * Priority order:
 *  1. testTable — the pre-existing table in the Catalyst project (used for tasks)
 *  2. KaizenTasks / KaizenLists / KaizenNotes — legacy tables (optional)
 *
 * Returns true if testTable (or KaizenTasks) is accessible with all required columns.
 * Logs actionable guidance when tables are missing.
 */
async function probeCatalystTables(req: express.Request): Promise<boolean> {
  const app = initCatalyst(req);

  // First probe testTable — the pre-existing table in this Catalyst project
  try {
    await app.zcql().executeZCQLQuery(`SELECT ROWID FROM ${TEST_TABLE} LIMIT 1`);
    console.log(`[kaizen] ✓ testTable found — provisioning required columns`);
    useTestTable = true;

    // Auto-provision missing columns in testTable
    const provisioned = await provisionTableColumns(req, TEST_TABLE, TEST_TABLE_COLUMNS);
    if (!provisioned) {
      console.warn(`[kaizen] Column provisioning incomplete for testTable — some operations may fail`);
      // Still use testTable; columns may have been partially created
    }
    return true;
  } catch (e: unknown) {
    const msg = String(e);
    if (/not found|does not exist|invalid table|no such table/i.test(msg)) {
      console.warn(`[kaizen] testTable not found — trying KaizenTasks fallback`);
    } else {
      console.warn(`[kaizen] testTable probe warning: ${msg}`);
    }
  }

  // Fallback: probe KaizenTasks — and auto-create if missing
  console.log(`[kaizen] Attempting to ensure KaizenTasks/KaizenLists/KaizenNotes tables exist...`);

  const KAIZEN_TASKS_COLS = [
    'TaskId', 'OwnerId', 'Title', 'Status', 'Quadrant', 'Priority',
    'Note', 'DueDate', 'DueTime', 'Category', 'ListId', 'TaskOrder',
    'ReminderEnabled', 'ReminderMinutesBefore', 'CompletedAt', 'CreatedAt', 'UpdatedAt',
  ] as const;
  const KAIZEN_LISTS_COLS = ['ListId', 'OwnerId', 'Name', 'Color', 'ListOrder', 'CreatedAt', 'UpdatedAt'] as const;
  const KAIZEN_NOTES_COLS = ['NoteId', 'Title', 'BlocksJson', 'Emoji', 'Pinned', 'CreatedAt', 'UpdatedAt'] as const;

  const tableSpecs = [
    { name: 'KaizenTasks', cols: KAIZEN_TASKS_COLS },
    { name: 'KaizenLists', cols: KAIZEN_LISTS_COLS },
    { name: 'KaizenNotes', cols: KAIZEN_NOTES_COLS },
  ];

  let allOk = true;
  for (const { name, cols } of tableSpecs) {
    // Probe first
    let tableExists = false;
    try {
      await app.zcql().executeZCQLQuery(`SELECT ROWID FROM ${name} LIMIT 1`);
      tableExists = true;
    } catch (e: unknown) {
      const msg = String(e);
      if (/not found|does not exist|invalid table|no such table/i.test(msg)) {
        console.warn(`[kaizen] Table '${name}' not found — attempting to create`);
      } else {
        console.warn(`[kaizen] Table probe warning for ${name}: ${msg}`);
        tableExists = true; // Assume exists but has other issue
      }
    }

    if (!tableExists) {
      const tableId = await ensureTableExists(req, name);
      if (!tableId) {
        console.error(`[kaizen] ✗ Could not create table '${name}'`);
        allOk = false;
        continue;
      }
    }

    // Provision columns
    const ok = await provisionTableColumns(req, name, cols);
    if (!ok) {
      console.warn(`[kaizen] Column provisioning incomplete for ${name}`);
      allOk = false;
    }
  }

  if (!allOk) {
    console.error(
      `[kaizen] ⚠️  Some Catalyst DataStore tables/columns could not be provisioned.\n` +
      `[kaizen]    The app uses 'testTable' as the primary tasks store.\n` +
      `[kaizen]    Required columns for testTable:\n` +
      `[kaizen]      ${TEST_TABLE_COLUMNS.join(', ')}\n` +
      `[kaizen]    Create columns in Catalyst console → App Console → Data Store → testTable\n` +
      `[kaizen]    Falling back to JSON-file storage until tables are accessible.`
    );
    return false;
  }

  return true;
}

// Whether to use testTable (pre-existing) vs KaizenTasks (legacy)
let useTestTable = false;

// ── JSON-file fallback ────────────────────────────────────────────────────────

const DB_PATH       = path.join(__dirname, 'notes-db.json');
const TASKS_DB_PATH = path.join(__dirname, 'tasks-db.json');
const LISTS_DB_PATH = path.join(__dirname, 'lists-db.json');

interface NotesDb  { notes: DbNote[] }
interface TasksDb  { tasks: DbTask[] }
interface ListsDb  { lists: DbList[] }

function readJson<T>(filePath: string, empty: T): T {
  try {
    if (!fs.existsSync(filePath)) return empty;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch { return empty; }
}

function writeJson<T>(filePath: string, data: T): void {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

// ── Notes types & converters ──────────────────────────────────────────────────

interface DbNote {
  id: string;
  ownerId: string;       // Catalyst user_id (or LOCAL_DEV_OWNER in fallback)
  title: string;
  blocksJson: string | null;
  emoji: string | null;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

const NOTES_TABLE = 'KaizenNotes';

// Full column list including OwnerId, which scopes every note to its author.
const NOTES_COLS = 'NoteId,OwnerId,Title,BlocksJson,Emoji,Pinned,CreatedAt,UpdatedAt';

function rowToNote(row: ICatalystRow): DbNote {
  return {
    id:         String(row['NoteId'] ?? ''),
    ownerId:    String(row['OwnerId'] ?? LOCAL_DEV_OWNER),
    title:      String(row['Title'] ?? 'Untitled'),
    blocksJson: row['BlocksJson'] != null ? String(row['BlocksJson']) : null,
    emoji:      row['Emoji'] != null ? String(row['Emoji']) : null,
    pinned:     String(row['Pinned']) === 'true',
    createdAt:  Number(row['CreatedAt']) || Date.now(),
    updatedAt:  Number(row['UpdatedAt']) || Date.now(),
  };
}

function noteToRow(note: DbNote): Record<string, string | number | null> {
  return {
    NoteId:     note.id,
    OwnerId:    note.ownerId,
    Title:      note.title,
    BlocksJson: note.blocksJson ?? '',
    Emoji:      note.emoji ?? '📝',
    Pinned:     note.pinned ? 'true' : 'false',
    CreatedAt:  note.createdAt,
    UpdatedAt:  note.updatedAt,
  };
}

// ── Tasks types & converters ──────────────────────────────────────────────────

interface DbTask {
  id: string;
  ownerId: string;       // Catalyst user_id (or LOCAL_DEV_OWNER in fallback)
  title: string;
  status: string;
  quadrant: string;
  priority: string;
  note: string;
  dueDate: string;
  dueTime: string;
  category: string;
  listId: string;
  taskOrder: number;
  reminderEnabled: boolean;
  reminderMinutesBefore: number;
  completedAt: number;   // 0 = not completed
  createdAt: number;
  updatedAt: number;
}

// Resolved at startup: 'testTable' if available, else 'KaizenTasks'
function getTasksTable(): string { return useTestTable ? TEST_TABLE : 'KaizenTasks'; }

// Full column list including OwnerId for owner-scoped queries
const TASKS_COLS = 'TaskId,OwnerId,Title,Status,Quadrant,Priority,Note,DueDate,DueTime,Category,ListId,TaskOrder,ReminderEnabled,ReminderMinutesBefore,CompletedAt,CreatedAt,UpdatedAt';

function rowToTask(row: ICatalystRow): DbTask {
  return {
    id:                    String(row['TaskId'] ?? ''),
    ownerId:               String(row['OwnerId'] ?? LOCAL_DEV_OWNER),
    title:                 String(row['Title'] ?? ''),
    status:                String(row['Status'] ?? 'TODO'),
    quadrant:              String(row['Quadrant'] ?? 'SCHEDULE'),
    priority:              String(row['Priority'] ?? ''),
    note:                  String(row['Note'] ?? ''),
    dueDate:               String(row['DueDate'] ?? ''),
    dueTime:               String(row['DueTime'] ?? ''),
    category:              String(row['Category'] ?? ''),
    listId:                String(row['ListId'] ?? ''),
    taskOrder:             Number(row['TaskOrder']) || 0,
    reminderEnabled:       String(row['ReminderEnabled']) === 'true',
    reminderMinutesBefore: Number(row['ReminderMinutesBefore']) || 0,
    completedAt:           Number(row['CompletedAt']) || 0,
    createdAt:             Number(row['CreatedAt']) || Date.now(),
    updatedAt:             Number(row['UpdatedAt']) || Date.now(),
  };
}

function taskToRow(t: DbTask): Record<string, string | number | null> {
  // testTable defines ALL columns as text — stringify every numeric field so
  // the Catalyst DataStore REST API accepts the payload without type errors.
  // KaizenTasks uses number columns for TaskOrder/timestamps, but stringifying
  // is safe there too because the SDK coerces on read and rowToTask uses Number().
  return {
    TaskId:                t.id,
    OwnerId:               t.ownerId,
    Title:                 t.title,
    Status:                t.status,
    Quadrant:              t.quadrant,
    Priority:              t.priority,
    Note:                  t.note,
    DueDate:               t.dueDate,
    DueTime:               t.dueTime,
    Category:              t.category,
    ListId:                t.listId,
    TaskOrder:             String(t.taskOrder),
    ReminderEnabled:       t.reminderEnabled ? 'true' : 'false',
    ReminderMinutesBefore: String(t.reminderMinutesBefore),
    CompletedAt:           String(t.completedAt),
    CreatedAt:             String(t.createdAt),
    UpdatedAt:             String(t.updatedAt),
  };
}

function dbTaskToApi(t: DbTask) {
  return {
    id:                    t.id,
    title:                 t.title,
    status:                t.status as 'TODO' | 'IN_PROGRESS' | 'DONE',
    quadrant:              t.quadrant as 'DO' | 'SCHEDULE' | 'DELEGATE' | 'ELIMINATE',
    priority:              t.priority || null,
    note:                  t.note || null,
    dueDate:               t.dueDate || null,
    dueTime:               t.dueTime || null,
    category:              t.category || null,
    listId:                t.listId || null,
    taskOrder:             t.taskOrder,
    reminderEnabled:       t.reminderEnabled,
    reminderMinutesBefore: t.reminderMinutesBefore || null,
    completedAt:           t.completedAt ? new Date(t.completedAt).toISOString() : null,
    createdAt:             new Date(t.createdAt).toISOString(),
    updatedAt:             new Date(t.updatedAt).toISOString(),
  };
}

// ── Lists types & converters ──────────────────────────────────────────────────

interface DbList {
  id: string;
  ownerId: string;       // Catalyst user_id (or LOCAL_DEV_OWNER in fallback)
  name: string;
  color: string;
  listOrder: number;
  createdAt: number;
  updatedAt: number;
}

const LISTS_TABLE = 'KaizenLists';

// Full column list including OwnerId
const LISTS_COLS = 'ListId,OwnerId,Name,Color,ListOrder,CreatedAt,UpdatedAt';

function rowToList(row: ICatalystRow): DbList {
  return {
    id:        String(row['ListId'] ?? ''),
    ownerId:   String(row['OwnerId'] ?? LOCAL_DEV_OWNER),
    name:      String(row['Name'] ?? 'Untitled'),
    color:     String(row['Color'] ?? 'emerald'),
    listOrder: Number(row['ListOrder']) || 0,
    createdAt: Number(row['CreatedAt']) || Date.now(),
    updatedAt: Number(row['UpdatedAt']) || Date.now(),
  };
}

function listToRow(l: DbList): Record<string, string | number | null> {
  // Stringify numeric fields — KaizenLists uses number columns but testTable
  // (used for lists fallback) uses text. Stringifying is safe for both because
  // rowToList always parses with Number().
  return {
    ListId:    l.id,
    OwnerId:   l.ownerId,
    Name:      l.name,
    Color:     l.color,
    ListOrder: String(l.listOrder),
    CreatedAt: String(l.createdAt),
    UpdatedAt: String(l.updatedAt),
  };
}

function dbListToApi(l: DbList) {
  return {
    id:        l.id,
    name:      l.name,
    color:     l.color,
    listOrder: l.listOrder,
    createdAt: new Date(l.createdAt).toISOString(),
    updatedAt: new Date(l.updatedAt).toISOString(),
  };
}

// ── ZCQL literal escaping ─────────────────────────────────────────────────────
//
// ZCQL is SQL-like, and SQL escapes a single quote inside a string literal by
// DOUBLING it ('' ), not by backslashing it. The previous code used
// `value.replace(/'/g, "\\'")`, which is wrong in two ways:
//
//   - Against an engine that treats backslash as literal, the quote still
//     terminates the string and the rest of the value is parsed as SQL.
//   - Against an engine that does honour backslash escapes, a value ending in
//     a backslash escapes the escape and breaks out anyway.
//
// The values reaching these queries are fully caller-controlled: :id path
// segments on every route, and the client-supplied `id` in POST /api/notes.
//
// zcqlString() returns a complete, quoted literal — callers must not add their
// own quotes, so a missing pair of quotes is a type error rather than an
// injection. assertSafeId() is the belt to that braces: our identifiers are
// UUIDs and Catalyst user_ids, so anything outside that shape is rejected at
// the edge before it ever reaches a query.

/** Renders a value as a quoted ZCQL string literal, escaping it correctly. */
function zcqlString(value: string): string {
  // Strip NUL and other control characters, which no identifier or title needs
  // and which some engines treat as statement terminators.
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '');
  return `'${cleaned.replace(/'/g, "''")}'`;
}

/** Identifiers we generate: UUIDs, Catalyst ROWIDs/user_ids, and slugs. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Validates a caller-supplied identifier, sending 400 and returning false when
 * it is not one of ours. Callers must `return` immediately on false.
 */
function assertSafeId(id: string, res: express.Response, field = 'id'): boolean {
  if (SAFE_ID.test(id)) return true;
  res.status(400).json({ error: 'invalid_id', message: `${field} must match ${String(SAFE_ID)}` });
  return false;
}

// ── Generic Catalyst CRUD helpers ─────────────────────────────────────────────

async function catalystGetOwnerRows<T>(
  req: express.Request,
  table: string,
  ownerCol: string,
  ownerId: string,
  converter: (row: ICatalystRow) => T
): Promise<T[]> {
  const app = initCatalyst(req);
  const cols = table === getTasksTable() ? TASKS_COLS : LISTS_COLS;
  try {
    const results = await app.zcql().executeZCQLQuery(
      `SELECT ${cols} FROM ${table} WHERE ${ownerCol} = ${zcqlString(ownerId)}`
    );
    return results.map((r) => converter(r[table] as ICatalystRow));
  } catch (e: unknown) {
    const msg = String(e);
    // If the OwnerId column doesn't exist yet (e.g. testTable freshly created
    // before column provisioning completes), fall back to a full table scan
    // and filter in-process. This prevents a hard 500 on first-run.
    if (/column.*not found|invalid column|no such column/i.test(msg)) {
      console.warn(`[kaizen] OwnerId column missing in ${table} — falling back to full scan`);
      const allResults = await app.zcql().executeZCQLQuery(`SELECT ${cols} FROM ${table}`);
      return allResults
        .map((r) => converter(r[table] as ICatalystRow))
        .filter((item) => {
          // Filter by ownerId if the converted item has an ownerId field
          const asRecord = item as Record<string, unknown>;
          return !asRecord['ownerId'] || asRecord['ownerId'] === ownerId;
        });
    }
    throw e;
  }
}

async function catalystGetRowId(
  req: express.Request,
  table: string,
  idCol: string,
  idVal: string
): Promise<string | null> {
  const app = initCatalyst(req);
  const results = await app.zcql().executeZCQLQuery(
    `SELECT ROWID, ${idCol} FROM ${table} WHERE ${idCol} = ${zcqlString(idVal)}`
  );
  if (!results.length) return null;
  const row = results[0][table] as ICatalystRow;
  return String(row['ROWID'] ?? '');
}

async function catalystInsertRow(
  req: express.Request,
  table: string,
  rowData: Record<string, string | number | null>
): Promise<ICatalystRow> {
  const app = initCatalyst(req);
  const tbl = app.datastore().table(table);
  return tbl.insertRow(rowData) as Promise<ICatalystRow>;
}

async function catalystUpdateRow(
  req: express.Request,
  table: string,
  rowId: string,
  rowData: Record<string, string | number | null>
): Promise<ICatalystRow> {
  const app = initCatalyst(req);
  const tbl = app.datastore().table(table);
  return tbl.updateRow({ ...rowData, ROWID: rowId }) as Promise<ICatalystRow>;
}

async function catalystDeleteRow(
  req: express.Request,
  table: string,
  rowId: string
): Promise<void> {
  const app = initCatalyst(req);
  const tbl = app.datastore().table(table);
  await tbl.deleteRow(rowId);
}

// ── Error responses ───────────────────────────────────────────────────────────
//
// Every route used to answer `503 datastore_unavailable` with `message:
// String(e)`. Two problems:
//
//   - A TypeError in our own code, a validation rejection from Catalyst and a
//     genuine outage were indistinguishable. Clients treat 503 as "retry
//     later", so a permanent bug looked like a transient blip.
//   - String(e) on an SDK error carries the raw ZCQL statement, table and
//     column names and internal ids straight to the caller.
//
// classifyError maps the cause to a status; the detail is logged server-side
// and only echoed to the client outside production.

const IS_PRODUCTION = process.env['NODE_ENV'] === 'production';

interface ErrorShape { status: number; error: string; message: string }

function classifyError(e: unknown): ErrorShape {
  if (e instanceof UnauthenticatedError) {
    return { status: 401, error: 'unauthenticated', message: 'Valid Catalyst session required' };
  }

  // Bugs in our own code — never a datastore outage.
  if (e instanceof TypeError || e instanceof ReferenceError || e instanceof SyntaxError) {
    return { status: 500, error: 'internal_error', message: 'Internal server error' };
  }

  // The SDK reports HTTP failures through statusCode / errorInfo.
  const status = (e as { statusCode?: number; status?: number })?.statusCode
    ?? (e as { statusCode?: number; status?: number })?.status;

  if (typeof status === 'number') {
    if (status === 401 || status === 403) {
      return { status: 401, error: 'unauthenticated', message: 'Valid Catalyst session required' };
    }
    if (status === 404) {
      return { status: 404, error: 'not_found', message: 'Not found' };
    }
    if (status >= 400 && status < 500) {
      // Catalyst rejected the request — a bad column, type or constraint.
      return { status: 400, error: 'datastore_rejected', message: 'The datastore rejected this request' };
    }
  }

  return { status: 503, error: 'datastore_unavailable', message: 'Storage backend unavailable' };
}

/** Logs the real cause and sends a classified, non-leaking JSON error. */
function sendError(res: express.Response, route: string, e: unknown): void {
  const shape = classifyError(e);
  console.error(`[kaizen] ${route} -> ${shape.status} ${shape.error}:`, e);
  if (res.headersSent) return;
  res.status(shape.status).json({
    error: shape.error,
    message: shape.message,
    // Detail is a debugging aid for local work, never for production clients.
    ...(IS_PRODUCTION ? {} : { detail: String(e) }),
  });
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();

// Always respond with JSON content-type for /api routes
app.use('/api', (_req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

// ── CORS ──────────────────────────────────────────────────────────────────────
//
// origin:'*' was wrong in both directions. It let any web page on the internet
// read and mutate a deployment's data; and because the wildcard is incompatible
// with credentialed requests, the browser would never have sent the Catalyst
// session cookie, so cross-origin owner scoping could not have worked anyway.
//
// In production the server serves dist/ from the same origin, so no CORS is
// needed at all. The allowlist exists for local dev (Vite proxies, so this is
// belt-and-braces) and for split-origin deployments, which must set
// ALLOWED_ORIGINS explicitly.
const DEV_ORIGINS = [
  'http://localhost:9000',
  'http://127.0.0.1:9000',
  'http://localhost:4173',
];

const ALLOWED_ORIGINS = (process.env['ALLOWED_ORIGINS'] ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const corsOrigins = ALLOWED_ORIGINS.length
  ? ALLOWED_ORIGINS
  : (process.env['NODE_ENV'] === 'production' ? [] : DEV_ORIGINS);

app.use(cors({
  origin(origin, callback) {
    // No Origin header: same-origin, curl, or a server-to-server call.
    if (!origin) return callback(null, true);
    if (corsOrigins.includes(origin)) return callback(null, true);
    // Reject by withholding the header rather than erroring, so the browser
    // reports a clean CORS failure instead of a 500.
    return callback(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '4mb' }));

// ── Health ────────────────────────────────────────────────────────────────────

app.head('/api/health', (_req, res) => { res.sendStatus(200); });
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now(), backend: catalystAvailable ? 'catalyst' : 'json-file' });
});

// ── Setup / table status ──────────────────────────────────────────────────────
//
// GET /api/setup — returns table probe results (useful for debugging in hosted env)
// This endpoint does NOT require auth so it can be called before session is established.
//
app.get('/api/setup', async (req, res) => {
  if (!catalystAvailable) {
    res.json({
      mode: 'json-file',
      message: 'Catalyst credentials not detected. Using JSON-file fallback.',
      tables: null,
    });
    return;
  }

  const tableStatus: Record<string, 'ok' | 'missing' | 'error'> = {};
  const app2 = initCatalyst(req);

  for (const { name, probe } of REQUIRED_TABLES) {
    try {
      await app2.zcql().executeZCQLQuery(probe);
      tableStatus[name] = 'ok';
    } catch (e: unknown) {
      const msg = String(e);
      tableStatus[name] = /not found|does not exist|invalid table|no such table/i.test(msg)
        ? 'missing'
        : 'error';
    }
  }

  const allOk = Object.values(tableStatus).every((s) => s === 'ok');
  res.json({
    mode: 'catalyst',
    tablesReady: allOk,
    tables: tableStatus,
    message: allOk
      ? 'All Catalyst DataStore tables are ready.'
      : 'Some tables are missing. Create them in the Catalyst console → App Console → Data Store → New Table.',
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TASKS ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/tasks[?listId=&status=&priority=&quadrant=&search=&dueBefore=&dueAfter=&sortBy=&sortDir=]
app.get('/api/tasks', async (req, res) => {
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;

  try {
    let tasks: DbTask[];
    if (catalystAvailable) {
      // Use owner-scoped ZCQL query to avoid fetching all rows
      tasks = await catalystGetOwnerRows(req, getTasksTable(), 'OwnerId', ownerId, rowToTask);
    } else {
      tasks = readJson<TasksDb>(TASKS_DB_PATH, { tasks: [] }).tasks;
      tasks = tasks.filter((t) => t.ownerId === LOCAL_DEV_OWNER);
    }

    const q = req.query as Record<string, string>;

    // Filter: listId
    if (q.listId) tasks = tasks.filter((t) => t.listId === q.listId);

    // Filter: status (comma-separated allowed)
    if (q.status) {
      const statuses = q.status.split(',').map((s) => s.trim().toUpperCase());
      tasks = tasks.filter((t) => statuses.includes(t.status.toUpperCase()));
    }

    // Filter: priority
    if (q.priority) {
      const priorities = q.priority.split(',').map((p) => p.trim().toUpperCase());
      tasks = tasks.filter((t) => priorities.includes((t.priority ?? '').toUpperCase()));
    }

    // Filter: quadrant
    if (q.quadrant) {
      const quadrants = q.quadrant.split(',').map((qv) => qv.trim().toUpperCase());
      tasks = tasks.filter((t) => quadrants.includes(t.quadrant.toUpperCase()));
    }

    // Filter: full-text search (title + note)
    if (q.search) {
      const needle = q.search.toLowerCase();
      tasks = tasks.filter(
        (t) =>
          t.title.toLowerCase().includes(needle) ||
          (t.note ?? '').toLowerCase().includes(needle) ||
          (t.category ?? '').toLowerCase().includes(needle)
      );
    }

    // Filter: due date range (ISO date strings YYYY-MM-DD)
    if (q.dueAfter) {
      tasks = tasks.filter((t) => t.dueDate && t.dueDate >= q.dueAfter);
    }
    if (q.dueBefore) {
      tasks = tasks.filter((t) => t.dueDate && t.dueDate <= q.dueBefore);
    }

    // Sort
    const sortBy  = q.sortBy  ?? 'order';
    const sortDir = q.sortDir === 'desc' ? -1 : 1;

    tasks.sort((a, b) => {
      let cmp: number;
      switch (sortBy) {
        case 'title':
          cmp = a.title.localeCompare(b.title);
          break;
        case 'due-date':
          cmp = (a.dueDate || 'zzzz').localeCompare(b.dueDate || 'zzzz');
          break;
        case 'priority': {
          const pOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2, '': 3 };
          cmp = (pOrder[a.priority?.toUpperCase() ?? ''] ?? 3) - (pOrder[b.priority?.toUpperCase() ?? ''] ?? 3);
          break;
        }
        case 'status': {
          const sOrder: Record<string, number> = { IN_PROGRESS: 0, TODO: 1, DONE: 2 };
          cmp = (sOrder[a.status] ?? 1) - (sOrder[b.status] ?? 1);
          break;
        }
        case 'created':
          cmp = a.createdAt - b.createdAt;
          break;
        default: // 'order'
          cmp = a.taskOrder - b.taskOrder || a.createdAt - b.createdAt;
      }
      return cmp * sortDir;
    });

    res.json(tasks.map(dbTaskToApi));
  } catch (e) {
    sendError(res, '[GET /api/tasks]', e);
  }
});

// GET /api/tasks/today-history[?listId=]
app.get('/api/tasks/today-history', async (req, res) => {
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;

  try {
    let tasks: DbTask[];
    if (catalystAvailable) {
      tasks = await catalystGetOwnerRows(req, getTasksTable(), 'OwnerId', ownerId, rowToTask);
    } else {
      tasks = readJson<TasksDb>(TASKS_DB_PATH, { tasks: [] }).tasks;
      tasks = tasks.filter((t) => t.ownerId === LOCAL_DEV_OWNER);
    }

    const today = new Date();
    const isToday = (ts: number) => {
      const d = new Date(ts);
      return d.getFullYear() === today.getFullYear() &&
             d.getMonth()    === today.getMonth() &&
             d.getDate()     === today.getDate();
    };

    const { listId } = req.query as Record<string, string>;
    tasks = tasks.filter((t) => t.status === 'DONE' && t.completedAt && isToday(t.completedAt));
    if (listId) tasks = tasks.filter((t) => t.listId === listId);
    tasks.sort((a, b) => b.completedAt - a.completedAt);
    res.json(tasks.map(dbTaskToApi));
  } catch (e) {
    sendError(res, '[GET /api/tasks/today-history]', e);
  }
});

// GET /api/tasks/:id
app.get('/api/tasks/:id', async (req, res) => {
  if (!assertSafeId(req.params.id, res)) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;

  try {
    let task: DbTask | undefined;
    if (catalystAvailable) {
      const all = await catalystGetOwnerRows(req, getTasksTable(), 'OwnerId', ownerId, rowToTask);
      task = all.find((t) => t.id === req.params.id);
    } else {
      task = readJson<TasksDb>(TASKS_DB_PATH, { tasks: [] }).tasks
        .find((t) => t.id === req.params.id && t.ownerId === LOCAL_DEV_OWNER);
    }
    if (!task) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(dbTaskToApi(task));
  } catch (e) {
    sendError(res, '[GET /api/tasks/:id]', e);
  }
});

// POST /api/tasks
app.post('/api/tasks', async (req, res) => {
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;

  const body = req.body as Partial<DbTask> & { title?: string };
  if (!body.title) { res.status(400).json({ error: 'title is required' }); return; }

  const now = Date.now();
  const task: DbTask = {
    id:                    crypto.randomUUID(),
    ownerId,
    title:                 body.title,
    status:                body.status ?? 'TODO',
    quadrant:              body.quadrant ?? 'SCHEDULE',
    priority:              body.priority ?? '',
    note:                  body.note ?? '',
    dueDate:               body.dueDate ?? '',
    dueTime:               body.dueTime ?? '',
    category:              body.category ?? '',
    listId:                body.listId ?? '',
    taskOrder:             body.taskOrder ?? 0,
    reminderEnabled:       body.reminderEnabled ?? false,
    reminderMinutesBefore: body.reminderMinutesBefore ?? 0,
    completedAt:           body.completedAt ?? 0,
    createdAt:             now,
    updatedAt:             now,
  };

  try {
    if (catalystAvailable) {
      await catalystInsertRow(req, getTasksTable(), taskToRow(task));
      res.status(201).json(dbTaskToApi(task));
    } else {
      const db = readJson<TasksDb>(TASKS_DB_PATH, { tasks: [] });
      db.tasks.push(task);
      writeJson(TASKS_DB_PATH, db);
      res.status(201).json(dbTaskToApi(task));
    }
  } catch (e) {
    sendError(res, '[POST /api/tasks]', e);
  }
});

// PUT /api/tasks/:id — full update
app.put('/api/tasks/:id', async (req, res) => {
  if (!assertSafeId(req.params.id, res)) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;

  const body = req.body as Partial<DbTask>;
  const now = Date.now();

  try {
    if (catalystAvailable) {
      const rowId = await catalystGetRowId(req, getTasksTable(), 'TaskId', req.params.id);
      if (!rowId) { res.status(404).json({ error: 'Not found' }); return; }

      const all = await catalystGetOwnerRows(req, getTasksTable(), 'OwnerId', ownerId, rowToTask);
      const existing = all.find((t) => t.id === req.params.id);
      if (!existing) { res.status(404).json({ error: 'Not found' }); return; }

      const updated: DbTask = { ...existing, ...body, id: req.params.id, ownerId, updatedAt: now };
      await catalystUpdateRow(req, getTasksTable(), rowId, taskToRow(updated));
      res.json(dbTaskToApi(updated));
    } else {
      const db = readJson<TasksDb>(TASKS_DB_PATH, { tasks: [] });
      const idx = db.tasks.findIndex((t) => t.id === req.params.id && t.ownerId === LOCAL_DEV_OWNER);
      if (idx < 0) { res.status(404).json({ error: 'Not found' }); return; }
      const updated: DbTask = { ...db.tasks[idx], ...body, id: req.params.id, ownerId: LOCAL_DEV_OWNER, updatedAt: now };
      db.tasks[idx] = updated;
      writeJson(TASKS_DB_PATH, db);
      res.json(dbTaskToApi(updated));
    }
  } catch (e) {
    sendError(res, '[PUT /api/tasks/:id]', e);
  }
});

// PATCH /api/tasks/:id/status
app.patch('/api/tasks/:id/status', async (req, res) => {
  if (!assertSafeId(req.params.id, res)) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;

  const { status } = req.body as { status: string };
  if (!status) { res.status(400).json({ error: 'status is required' }); return; }
  const now = Date.now();

  try {
    if (catalystAvailable) {
      const rowId = await catalystGetRowId(req, getTasksTable(), 'TaskId', req.params.id);
      if (!rowId) { res.status(404).json({ error: 'Not found' }); return; }
      const all = await catalystGetOwnerRows(req, getTasksTable(), 'OwnerId', ownerId, rowToTask);
      const existing = all.find((t) => t.id === req.params.id);
      if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
      const updated: DbTask = { ...existing, status, updatedAt: now };
      await catalystUpdateRow(req, getTasksTable(), rowId, taskToRow(updated));
      res.json(dbTaskToApi(updated));
    } else {
      const db = readJson<TasksDb>(TASKS_DB_PATH, { tasks: [] });
      const idx = db.tasks.findIndex((t) => t.id === req.params.id && t.ownerId === LOCAL_DEV_OWNER);
      if (idx < 0) { res.status(404).json({ error: 'Not found' }); return; }
      db.tasks[idx] = { ...db.tasks[idx], status, updatedAt: now };
      writeJson(TASKS_DB_PATH, db);
      res.json(dbTaskToApi(db.tasks[idx]));
    }
  } catch (e) {
    sendError(res, '[PATCH /api/tasks/:id/status]', e);
  }
});

// PATCH /api/tasks/:id/complete
app.patch('/api/tasks/:id/complete', async (req, res) => {
  if (!assertSafeId(req.params.id, res)) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;

  const now = Date.now();

  try {
    if (catalystAvailable) {
      const rowId = await catalystGetRowId(req, getTasksTable(), 'TaskId', req.params.id);
      if (!rowId) { res.status(404).json({ error: 'Not found' }); return; }
      const all = await catalystGetOwnerRows(req, getTasksTable(), 'OwnerId', ownerId, rowToTask);
      const existing = all.find((t) => t.id === req.params.id);
      if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
      const updated: DbTask = { ...existing, status: 'DONE', completedAt: now, updatedAt: now };
      await catalystUpdateRow(req, getTasksTable(), rowId, taskToRow(updated));
      res.json(dbTaskToApi(updated));
    } else {
      const db = readJson<TasksDb>(TASKS_DB_PATH, { tasks: [] });
      const idx = db.tasks.findIndex((t) => t.id === req.params.id && t.ownerId === LOCAL_DEV_OWNER);
      if (idx < 0) { res.status(404).json({ error: 'Not found' }); return; }
      db.tasks[idx] = { ...db.tasks[idx], status: 'DONE', completedAt: now, updatedAt: now };
      writeJson(TASKS_DB_PATH, db);
      res.json(dbTaskToApi(db.tasks[idx]));
    }
  } catch (e) {
    sendError(res, '[PATCH /api/tasks/:id/complete]', e);
  }
});

// PATCH /api/tasks/:id/quadrant
app.patch('/api/tasks/:id/quadrant', async (req, res) => {
  if (!assertSafeId(req.params.id, res)) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;

  const { quadrant } = req.body as { quadrant: string };
  if (!quadrant) { res.status(400).json({ error: 'quadrant is required' }); return; }
  const now = Date.now();

  try {
    if (catalystAvailable) {
      const rowId = await catalystGetRowId(req, getTasksTable(), 'TaskId', req.params.id);
      if (!rowId) { res.status(404).json({ error: 'Not found' }); return; }
      const all = await catalystGetOwnerRows(req, getTasksTable(), 'OwnerId', ownerId, rowToTask);
      const existing = all.find((t) => t.id === req.params.id);
      if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
      const updated: DbTask = { ...existing, quadrant, updatedAt: now };
      await catalystUpdateRow(req, getTasksTable(), rowId, taskToRow(updated));
      res.json(dbTaskToApi(updated));
    } else {
      const db = readJson<TasksDb>(TASKS_DB_PATH, { tasks: [] });
      const idx = db.tasks.findIndex((t) => t.id === req.params.id && t.ownerId === LOCAL_DEV_OWNER);
      if (idx < 0) { res.status(404).json({ error: 'Not found' }); return; }
      db.tasks[idx] = { ...db.tasks[idx], quadrant, updatedAt: now };
      writeJson(TASKS_DB_PATH, db);
      res.json(dbTaskToApi(db.tasks[idx]));
    }
  } catch (e) {
    sendError(res, '[PATCH /api/tasks/:id/quadrant]', e);
  }
});

// DELETE /api/tasks/:id
app.delete('/api/tasks/:id', async (req, res) => {
  if (!assertSafeId(req.params.id, res)) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;

  try {
    if (catalystAvailable) {
      // Verify ownership before delete
      const all = await catalystGetOwnerRows(req, getTasksTable(), 'OwnerId', ownerId, rowToTask);
      const task = all.find((t) => t.id === req.params.id);
      if (task) {
        const rowId = await catalystGetRowId(req, getTasksTable(), 'TaskId', req.params.id);
        if (rowId) await catalystDeleteRow(req, getTasksTable(), rowId);
      }
      res.sendStatus(204);
    } else {
      const db = readJson<TasksDb>(TASKS_DB_PATH, { tasks: [] });
      db.tasks = db.tasks.filter((t) => !(t.id === req.params.id && t.ownerId === LOCAL_DEV_OWNER));
      writeJson(TASKS_DB_PATH, db);
      res.sendStatus(204);
    }
  } catch (e) {
    sendError(res, '[DELETE /api/tasks/:id]', e);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// LISTS ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/lists
app.get('/api/lists', async (req, res) => {
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;

  try {
    let lists: DbList[];
    if (catalystAvailable) {
      lists = await catalystGetOwnerRows(req, LISTS_TABLE, 'OwnerId', ownerId, rowToList);
    } else {
      lists = readJson<ListsDb>(LISTS_DB_PATH, { lists: [] }).lists;
      lists = lists.filter((l) => l.ownerId === LOCAL_DEV_OWNER);
    }
    lists.sort((a, b) => a.listOrder - b.listOrder || a.createdAt - b.createdAt);
    res.json(lists.map(dbListToApi));
  } catch (e) {
    sendError(res, '[GET /api/lists]', e);
  }
});

// GET /api/lists/:id
app.get('/api/lists/:id', async (req, res) => {
  if (!assertSafeId(req.params.id, res)) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;

  try {
    let list: DbList | undefined;
    if (catalystAvailable) {
      const all = await catalystGetOwnerRows(req, LISTS_TABLE, 'OwnerId', ownerId, rowToList);
      list = all.find((l) => l.id === req.params.id);
    } else {
      list = readJson<ListsDb>(LISTS_DB_PATH, { lists: [] }).lists
        .find((l) => l.id === req.params.id && l.ownerId === LOCAL_DEV_OWNER);
    }
    if (!list) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(dbListToApi(list));
  } catch (e) {
    sendError(res, '[GET /api/lists/:id]', e);
  }
});

// POST /api/lists
app.post('/api/lists', async (req, res) => {
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;

  const body = req.body as Partial<DbList>;
  if (!body.name) { res.status(400).json({ error: 'name is required' }); return; }

  const now = Date.now();
  const list: DbList = {
    id:        crypto.randomUUID(),
    ownerId,
    name:      body.name,
    color:     body.color ?? 'emerald',
    listOrder: body.listOrder ?? 0,
    createdAt: now,
    updatedAt: now,
  };

  try {
    if (catalystAvailable) {
      await catalystInsertRow(req, LISTS_TABLE, listToRow(list));
      res.status(201).json(dbListToApi(list));
    } else {
      const db = readJson<ListsDb>(LISTS_DB_PATH, { lists: [] });
      db.lists.push(list);
      writeJson(LISTS_DB_PATH, db);
      res.status(201).json(dbListToApi(list));
    }
  } catch (e) {
    sendError(res, '[POST /api/lists]', e);
  }
});

// PUT /api/lists/:id
app.put('/api/lists/:id', async (req, res) => {
  if (!assertSafeId(req.params.id, res)) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;

  const body = req.body as Partial<DbList>;
  const now = Date.now();

  try {
    if (catalystAvailable) {
      const rowId = await catalystGetRowId(req, LISTS_TABLE, 'ListId', req.params.id);
      if (!rowId) { res.status(404).json({ error: 'Not found' }); return; }
      const all = await catalystGetOwnerRows(req, LISTS_TABLE, 'OwnerId', ownerId, rowToList);
      const existing = all.find((l) => l.id === req.params.id);
      if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
      const updated: DbList = { ...existing, ...body, id: req.params.id, ownerId, updatedAt: now };
      await catalystUpdateRow(req, LISTS_TABLE, rowId, listToRow(updated));
      res.json(dbListToApi(updated));
    } else {
      const db = readJson<ListsDb>(LISTS_DB_PATH, { lists: [] });
      const idx = db.lists.findIndex((l) => l.id === req.params.id && l.ownerId === LOCAL_DEV_OWNER);
      if (idx < 0) { res.status(404).json({ error: 'Not found' }); return; }
      const updated: DbList = { ...db.lists[idx], ...body, id: req.params.id, ownerId: LOCAL_DEV_OWNER, updatedAt: now };
      db.lists[idx] = updated;
      writeJson(LISTS_DB_PATH, db);
      res.json(dbListToApi(updated));
    }
  } catch (e) {
    sendError(res, '[PUT /api/lists/:id]', e);
  }
});

// DELETE /api/lists/:id
app.delete('/api/lists/:id', async (req, res) => {
  if (!assertSafeId(req.params.id, res)) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;

  try {
    if (catalystAvailable) {
      // Verify ownership before delete
      const allLists = await catalystGetOwnerRows(req, LISTS_TABLE, 'OwnerId', ownerId, rowToList);
      const list = allLists.find((l) => l.id === req.params.id);
      if (list) {
        const rowId = await catalystGetRowId(req, LISTS_TABLE, 'ListId', req.params.id);
        if (rowId) await catalystDeleteRow(req, LISTS_TABLE, rowId);
        // Also delete tasks belonging to this list (owner-scoped)
        const tasks = await catalystGetOwnerRows(req, getTasksTable(), 'OwnerId', ownerId, rowToTask);
        const toDelete = tasks.filter((t) => t.listId === req.params.id);
        await Promise.all(toDelete.map(async (t) => {
          const rid = await catalystGetRowId(req, getTasksTable(), 'TaskId', t.id);
          if (rid) await catalystDeleteRow(req, getTasksTable(), rid);
        }));
      }
      res.sendStatus(204);
    } else {
      const db = readJson<ListsDb>(LISTS_DB_PATH, { lists: [] });
      db.lists = db.lists.filter((l) => !(l.id === req.params.id && l.ownerId === LOCAL_DEV_OWNER));
      writeJson(LISTS_DB_PATH, db);
      // Also remove tasks for this list (owner-scoped)
      const tdb = readJson<TasksDb>(TASKS_DB_PATH, { tasks: [] });
      tdb.tasks = tdb.tasks.filter((t) => !(t.listId === req.params.id && t.ownerId === LOCAL_DEV_OWNER));
      writeJson(TASKS_DB_PATH, tdb);
      res.sendStatus(204);
    }
  } catch (e) {
    sendError(res, '[DELETE /api/lists/:id]', e);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// STATS ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/stats/momentum[?listId=]
app.get('/api/stats/momentum', async (req, res) => {
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;

  try {
    let tasks: DbTask[];
    if (catalystAvailable) {
      tasks = await catalystGetOwnerRows(req, getTasksTable(), 'OwnerId', ownerId, rowToTask);
    } else {
      tasks = readJson<TasksDb>(TASKS_DB_PATH, { tasks: [] }).tasks;
      tasks = tasks.filter((t) => t.ownerId === LOCAL_DEV_OWNER);
    }

    const { listId } = req.query as Record<string, string>;
    if (listId) tasks = tasks.filter((t) => t.listId === listId);

    const doneTasks = tasks.filter((t) => t.status === 'DONE');
    const today = new Date();
    const isToday = (ts: number) => {
      const d = new Date(ts);
      return d.getFullYear() === today.getFullYear() &&
             d.getMonth()    === today.getMonth() &&
             d.getDate()     === today.getDate();
    };

    const todayCompleted = doneTasks.filter((t) => t.completedAt && isToday(t.completedAt)).length;
    const totalCompleted = doneTasks.length;

    // Streak: count consecutive days (including today) that had at least one completion
    const daySet = new Set<string>();
    for (const t of doneTasks) {
      if (t.completedAt) {
        const d = new Date(t.completedAt);
        daySet.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
      }
    }
    let streak = 0;
    const cursor = new Date();
    for (let i = 0; i < 365; i++) {
      const key = `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`;
      if (daySet.has(key)) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      } else if (i === 0) {
        // Today has no completions yet — check yesterday to keep streak alive
        cursor.setDate(cursor.getDate() - 1);
      } else {
        break;
      }
    }

    res.json({
      streak,
      totalCompleted,
      todayCompleted,
      listId: listId ?? '',
      asOf: new Date().toISOString(),
    });
  } catch (e) {
    sendError(res, '[GET /api/stats/momentum]', e);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// NOTES ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Finds one note belonging to `ownerId`, returning its ROWID alongside it.
 *
 * Scoping by OwnerId in the predicate (rather than fetching and filtering) is
 * what makes another user's note a 404 rather than a readable row.
 */
async function catalystFindNote(
  req: express.Request,
  ownerId: string,
  noteId: string
): Promise<{ rowId: string; note: DbNote } | null> {
  const app = initCatalyst(req);
  const results = await app.zcql().executeZCQLQuery(
    `SELECT ROWID,${NOTES_COLS} FROM ${NOTES_TABLE} ` +
    `WHERE NoteId = ${zcqlString(noteId)} AND OwnerId = ${zcqlString(ownerId)}`
  );
  if (!results.length) return null;
  const row = results[0][NOTES_TABLE] as ICatalystRow;
  return { rowId: String(row['ROWID'] ?? ''), note: rowToNote(row) };
}

/**
 * Owner of a stored note. Notes written before OwnerId existed have no owner
 * field; in JSON-file mode there was only ever one user, so they belong to
 * LOCAL_DEV_OWNER rather than disappearing.
 */
function noteOwner(note: DbNote): string {
  return note.ownerId || LOCAL_DEV_OWNER;
}

/** Reads the owner's notes from the JSON-file store. */
function readOwnedNotes(ownerId: string): DbNote[] {
  return readJson<NotesDb>(DB_PATH, { notes: [] }).notes.filter((n) => noteOwner(n) === ownerId);
}

// GET /api/notes — pinned first, then by updatedAt desc
app.get('/api/notes', async (req, res) => {
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;

  try {
    let notes: DbNote[];
    if (catalystAvailable) {
      const results = await initCatalyst(req).zcql().executeZCQLQuery(
        `SELECT ${NOTES_COLS} FROM ${NOTES_TABLE} WHERE OwnerId = ${zcqlString(ownerId)}`
      );
      notes = results.map((r) => rowToNote(r[NOTES_TABLE] as ICatalystRow));
    } else {
      notes = readOwnedNotes(ownerId);
    }
    const sorted = [...notes].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.updatedAt - a.updatedAt;
    });
    res.json(sorted);
  } catch (e) {
    sendError(res, '[GET /api/notes]', e);
  }
});

// GET /api/notes/:id
app.get('/api/notes/:id', async (req, res) => {
  if (!assertSafeId(req.params.id, res)) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;

  try {
    let note: DbNote | null = null;
    if (catalystAvailable) {
      note = (await catalystFindNote(req, ownerId, req.params.id))?.note ?? null;
    } else {
      note = readOwnedNotes(ownerId).find((n) => n.id === req.params.id) ?? null;
    }
    if (!note) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(note);
  } catch (e) {
    sendError(res, '[GET /api/notes/:id]', e);
  }
});

// POST /api/notes — create (upsert by NoteId, scoped to the owner)
app.post('/api/notes', async (req, res) => {
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;

  const body = req.body as Partial<DbNote>;
  if (!body.id || !body.title) { res.status(400).json({ error: 'id and title are required' }); return; }
  // The note id is client-supplied here, so it gets the same check as a path param.
  if (!assertSafeId(body.id, res)) return;

  const note: DbNote = {
    id:         body.id,
    ownerId,
    title:      body.title,
    blocksJson: body.blocksJson ?? null,
    emoji:      body.emoji ?? '📝',
    pinned:     body.pinned ?? false,
    createdAt:  body.createdAt ?? Date.now(),
    updatedAt:  body.updatedAt ?? Date.now(),
  };

  try {
    if (catalystAvailable) {
      const found = await catalystFindNote(req, ownerId, note.id);
      if (found) {
        if (note.updatedAt >= found.note.updatedAt) {
          await catalystUpdateRow(req, NOTES_TABLE, found.rowId, noteToRow(note));
          res.json(note);
        } else {
          res.json(found.note);
        }
      } else {
        await catalystInsertRow(req, NOTES_TABLE, noteToRow(note));
        res.status(201).json(note);
      }
    } else {
      const db = readJson<NotesDb>(DB_PATH, { notes: [] });
      const idx = db.notes.findIndex((n) => n.id === note.id && noteOwner(n) === ownerId);
      if (idx >= 0) {
        if (note.updatedAt >= db.notes[idx].updatedAt) {
          db.notes[idx] = note;
          writeJson(DB_PATH, db);
          res.json(note);
        } else {
          res.json(db.notes[idx]);
        }
      } else {
        db.notes.push(note);
        writeJson(DB_PATH, db);
        res.status(201).json(note);
      }
    }
  } catch (e) {
    sendError(res, '[POST /api/notes]', e);
  }
});

// PUT /api/notes/:id
app.put('/api/notes/:id', async (req, res) => {
  if (!assertSafeId(req.params.id, res)) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;

  const body = req.body as Partial<DbNote>;

  try {
    if (catalystAvailable) {
      const found = await catalystFindNote(req, ownerId, req.params.id);
      if (!found) { res.status(404).json({ error: 'Not found' }); return; }
      const incoming: DbNote = {
        ...found.note,
        ...body,
        id: req.params.id,
        ownerId,
        updatedAt: body.updatedAt ?? Date.now(),
      };
      if (incoming.updatedAt >= found.note.updatedAt) {
        await catalystUpdateRow(req, NOTES_TABLE, found.rowId, noteToRow(incoming));
        res.json(incoming);
      } else {
        res.json(found.note);
      }
    } else {
      const db = readJson<NotesDb>(DB_PATH, { notes: [] });
      const idx = db.notes.findIndex((n) => n.id === req.params.id && noteOwner(n) === ownerId);
      if (idx < 0) { res.status(404).json({ error: 'Not found' }); return; }
      const incoming: DbNote = {
        ...db.notes[idx],
        ...body,
        id: req.params.id,
        ownerId,
        updatedAt: body.updatedAt ?? Date.now(),
      };
      if (incoming.updatedAt >= db.notes[idx].updatedAt) {
        db.notes[idx] = incoming;
        writeJson(DB_PATH, db);
        res.json(incoming);
      } else {
        res.json(db.notes[idx]);
      }
    }
  } catch (e) {
    sendError(res, '[PUT /api/notes/:id]', e);
  }
});

// DELETE /api/notes/:id
app.delete('/api/notes/:id', async (req, res) => {
  if (!assertSafeId(req.params.id, res)) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;

  try {
    if (catalystAvailable) {
      const found = await catalystFindNote(req, ownerId, req.params.id);
      if (found) await catalystDeleteRow(req, NOTES_TABLE, found.rowId);
      res.sendStatus(204);
    } else {
      const db = readJson<NotesDb>(DB_PATH, { notes: [] });
      db.notes = db.notes.filter((n) => !(n.id === req.params.id && noteOwner(n) === ownerId));
      writeJson(DB_PATH, db);
      res.sendStatus(204);
    }
  } catch (e) {
    sendError(res, '[DELETE /api/notes/:id]', e);
  }
});

// ── Global error handler — always returns JSON ────────────────────────────────
//
// Catches any unhandled errors thrown inside route handlers (including
// express.json() parse errors and unexpected throws). Ensures the client
// always receives a JSON body instead of Express's default HTML error page.
//
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = (err as { status?: number; statusCode?: number }).status
    ?? (err as { status?: number; statusCode?: number }).statusCode
    ?? 500;
  const message = err instanceof Error ? err.message : String(err);
  console.error('[kaizen] Unhandled error:', err);
  if (!res.headersSent) {
    res.status(status).json({ error: 'internal_error', message });
  }
});

// ── Static SPA serving ────────────────────────────────────────────────────────

const DIST_DIR = path.join(__dirname, '..', 'dist');

if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  // SPA fallback — must come AFTER /api routes
  app.get('/{*path}', (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────
//
// Port resolution:
//   - In Catalyst hosted env: PORT is injected by the platform (do NOT override it)
//   - In local dev (pnpm dev): defaults to 3001 (Vite proxies /api → :3001)
//   - In local preview (pnpm preview:server): defaults to 3001
//
// The `start` script (used by Catalyst Functions) must NOT force PORT=9000
// because port 9000 is the Catalyst gateway — the function server runs on
// whatever port the platform assigns via the PORT env var.
//

const LISTEN_PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : DEFAULT_PORT;

const server = app.listen(LISTEN_PORT, '0.0.0.0', async () => {
  console.log(`[kaizen] Server running on http://0.0.0.0:${LISTEN_PORT}`);
  const activeSignals = Object.entries(CATALYST_ENV_SIGNALS)
    .filter(([, on]) => on)
    .map(([name]) => name);
  console.log(
    activeSignals.length
      ? `[kaizen] Catalyst credentials detected via: ${activeSignals.join(', ')}`
      : '[kaizen] No Catalyst credentials in env — using JSON-file storage'
  );

  if (catalystAvailable) {
    // Probe tables on startup using a synthetic request context.
    // The SDK's initialize() accepts a plain object when running as a
    // Catalyst Function (credentials come from the platform env, not the request).
    try {
      const syntheticReq = {} as express.Request;
      const tablesOk = await probeCatalystTables(syntheticReq);
      if (!tablesOk) {
        // Disable Catalyst for this process — fall back to JSON-file storage
        catalystAvailable = false;
        console.warn('[kaizen] Catalyst DataStore disabled for this session. Using JSON-file fallback.');
      } else {
        console.log('[kaizen] Catalyst DataStore tables verified ✓');
      }
    } catch (e) {
      console.warn('[kaizen] Catalyst table probe failed (will use JSON-file fallback):', e);
      catalystAvailable = false;
    }
  }

  console.log(`[kaizen] Backend: ${catalystAvailable ? 'Catalyst DataStore' : 'JSON file fallback'}`);
  if (fs.existsSync(DIST_DIR)) {
    console.log(`[kaizen] Serving SPA from ${DIST_DIR}`);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[kaizen] SIGTERM received, shutting down gracefully');
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  console.log('[kaizen] SIGINT received, shutting down gracefully');
  server.close(() => process.exit(0));
});
