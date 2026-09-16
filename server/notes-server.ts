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
 *     TaskPriority (text)  — "LOW" | "MEDIUM" | "HIGH" | "" (Priority is reserved)
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
 *     TaskPriority (text)         — "LOW" | "MEDIUM" | "HIGH" | "" (Priority is reserved)
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
// Imported explicitly rather than using the global `crypto`, which only exists
// from Node 19 — on an older runtime the bare global is undefined and every
// create request would throw.
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baasProxy } from './catalyst/baasProxy.ts';
import { runSweep, describeSweep } from './notifications/sweep.ts';
import { startScheduler, schedulerEnabled, intervalFromEnv, type Scheduler } from './notifications/scheduler.ts';
import { createTrialFeatureCache, sweepOptionsFor, ALL_ENABLED, type TrialFeatures } from './trialFeatures.ts';
import { listInbox, markRead, markAllRead, removeEntry } from './notifications/inbox.ts';
import {
  listRules, getRule, insertRule, updateRule, deleteRule,
  TRIGGER_TYPES, RULE_STATUSES, URGENCIES, OFFSET_UNITS, setStepsColumnAvailable,
  type AutomationRule, type RuleRow,
} from './automations/rules.ts';
import { initialTrigger } from './automations/planner.ts';
import { syncTaskRules, cancelTaskRules, backfillTaskRules } from './automations/taskTriggers.ts';
import {
  MAX_STEPS, MAX_STEP_MINUTES, legacyOffsetMinutes, normaliseSteps, stepsForRule,
} from './automations/steps.ts';
import { listRuns, listRunsForRule, recordRun } from './automations/runs.ts';
import { channelsFor, renderRule } from './automations/planner.ts';
import { enqueue, cancelPendingForRule } from './notifications/queue.ts';
import { dayKeyInZone, streakDays } from './stats/days.ts';
import { simpleRequestMiddleware } from './simpleRequests.ts';
import {
  MAX_VIEWS, deleteView, getView, insertView, listViews, parseViewBody, updateView, viewToApi,
  type SavedView,
  setViewDisplayAvailable,
} from './views.ts';
import {
  MAX_DATABASES, databaseToApi, deleteDatabase, deleteRow, deleteRowsOfDatabase, getDatabase, getRow,
  insertDatabase, insertRow, listDatabases, listRows, parseDatabaseBody, parseRowBody, rowToApi,
  updateDatabase, updateRow, type DatabaseRow, type KaizenDatabase,
} from './databases.ts';
import {
  MAX_FIELDS, decodeValue, defToApi, deleteDefRow, deletePropsForDef, deletePropsForTask, encodeValue,
  getDef, insertDef, listDefs, listProps, parseFieldBody, setProp, updateDef, type FieldDef,
  setFieldsDatabaseAvailable,
} from './fields.ts';
import {
  syncTaskReminder,
  cancelTaskReminders,
  backfillReminders,
  resolveTimeZone,
  type ReminderContext,
} from './notifications/reminders.ts';
import type { CatalystApp as NotificationApp } from './notifications/types.ts';
import {
  readStandaloneConfig, initCatalystApp, describeMode, getCliApp, cliProject, region,
  ownerForAdminMode, ownerForAnonymousGateway, hasGatewayHeaders,
  captureGatewayCredentials, backgroundCatalystApp, hasBackgroundCredentials,
  type StandaloneConfig, type CatalystMode,
} from './catalyst/init.ts';
import type { ICatalystRow } from 'zcatalyst-sdk-node/lib/utils/pojo/common';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Catalyst's convention for AppSail: the platform injects
// X_ZOHO_CATALYST_LISTEN_PORT, and 9000 is the documented fallback. Defaulting
// to a local-dev port instead means that if the platform does not inject the
// variable, the process listens somewhere the gateway never probes and the
// deployment fails with "Execution failed. Please check the startup command or
// port." Local dev pins PORT=3001 in the package scripts, matching the Vite
// proxy.
const DEFAULT_PORT = 9000;

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
// Standalone credentials count too, and are added below once they are read.
let catalystAvailable = Object.values(CATALYST_ENV_SIGNALS).some(Boolean);

// ── Auth / owner scoping ──────────────────────────────────────────────────────

// In JSON-file mode there is no identity provider, so every row belongs to a
// single local developer. This is dev-only storage; see docs/catalyst/.
const LOCAL_DEV_OWNER = 'local-dev-user';

/** Thrown when a request carries no usable Catalyst session. */
class UnauthenticatedError extends Error {
  constructor(message = 'Valid Catalyst session required') {
    super(message);
    this.name = 'UnauthenticatedError';
  }
}

/** Who the caller is, as far as this request is concerned. */
interface Identity {
  userId: string;
  /**
   * The user's email address, or '' when there is none to be had.
   *
   * Empty is the normal case for the admin and shared-owner fallbacks, which
   * resolve an owner id without a real app user behind it. Notification
   * channels that need an address skip rather than fail when it is missing.
   */
  email: string;
}

/**
 * Per-request identity cache.
 *
 * getCurrentUser() is a network call to Catalyst. A single request can ask for
 * the owner and then, on the write path, for the delivery address; without
 * this that would be two round trips for one answer. Keyed on the request
 * object, so it lives exactly as long as the request does.
 */
const identityCache = new WeakMap<express.Request, Identity>();

async function getCurrentIdentity(req: express.Request): Promise<Identity> {
  const cached = identityCache.get(req);
  if (cached) return cached;

  const identity = await resolveIdentity(req);
  identityCache.set(req, identity);
  return identity;
}

/**
 * Works out who is calling, from the Catalyst session on the request.
 *
 * getCurrentUser() needs a valid Zoho session. If there isn't one, that is an
 * authentication failure and the caller gets a 401 — we do not invent an
 * identity for them.
 *
 * The original implementation caught every failure and returned the constant
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
 *
 * Call getCurrentIdentity() rather than this: it memoises the round trip.
 */
async function resolveIdentity(req: express.Request): Promise<Identity> {
  if (!catalystAvailable) return { userId: LOCAL_DEV_OWNER, email: '' };

  // Admin credentials (CLI or standalone) carry no end-user session, so
  // getCurrentUser() would always throw and every request would 401 — making
  // local development against the real project impossible. Scope rows to the
  // authenticated identity instead. Under the gateway a real session exists,
  // and the strict path below still applies.
  if (!hasGatewayHeaders(req)) {
    const adminOwner = ownerForAdminMode();
    if (adminOwner) return { userId: adminOwner, email: '' };
  }

  let user: unknown;
  try {
    const app = initCatalystAsUser(req);
    user = await app.userManagement().getCurrentUser();
  } catch (e) {
    throw new UnauthenticatedError(`Catalyst session lookup failed: ${String(e)}`);
  }

  // The SDK returns user_id as a number or a string depending on version.
  const uid = (user as { user_id?: string | number; userId?: string | number } | null)?.user_id
    ?? (user as { user_id?: string | number; userId?: string | number } | null)?.userId;

  if (uid === undefined || uid === null || String(uid).trim() === '') {
    // No signed-in app user. Behind the AppSail gateway this is the ordinary
    // anonymous case — the gateway injects admin headers on every request, so
    // initialize() succeeding proves nothing and getCurrentUser() is the real
    // check.
    //
    // The app now signs users in with Catalyst, so this is a 401. The shared
    // single-owner fallback remains only for a deployment that deliberately
    // runs without end-user authentication, and it must be opted into with
    // APP_OWNER_ID; defaulting to it would put every user back in one dataset.
    const shared = ownerForAnonymousGateway();
    if (shared) return { userId: shared, email: '' };
    throw new UnauthenticatedError('No signed-in Catalyst user on this request');
  }

  // The SDK has spelt this several ways across versions; take whichever is
  // present rather than pinning to one and silently losing the address.
  const record = user as Record<string, unknown> | null;
  const email = String(
    record?.['email_id'] ?? record?.['emailId'] ?? record?.['email'] ?? '',
  ).trim();

  return { userId: String(uid), email };
}

/** Returns the Catalyst user_id for the authenticated user. */
async function getCurrentUserId(req: express.Request): Promise<string> {
  return (await getCurrentIdentity(req)).userId;
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

// Standalone credentials, read once. A partial configuration throws here so
// the mistake is reported at startup rather than as a per-request 503.
let standaloneConfig: StandaloneConfig | null = null;
try {
  standaloneConfig = readStandaloneConfig();
} catch (e) {
  console.error(`[kaizen] ${String(e instanceof Error ? e.message : e)}`);
}

// A complete standalone configuration is a credential signal in its own right:
// it is what makes Catalyst reachable from a plain `pnpm dev`.
if (standaloneConfig) catalystAvailable = true;

/** Which initialisation path the last request used; reported by /api/health. */
let lastCatalystMode: CatalystMode = standaloneConfig ? 'standalone' : 'none';

/** Admin-scoped app, for reading and writing rows. */
function initCatalyst(req: express.Request) {
  lastCatalystMode = describeMode(req, standaloneConfig);
  return initCatalystApp(req, standaloneConfig, 'admin');
}

/**
 * User-scoped app, for resolving who is calling.
 *
 * Must not be the admin-scoped one: under the AppSail gateway admin scope makes
 * the SDK the project admin, which is not an app user, so getCurrentUser()
 * returns null for a signed-in visitor and every request answers 401.
 */
function initCatalystAsUser(req: express.Request) {
  return initCatalystApp(req, standaloneConfig, 'user');
}

// ── Catalyst table probe ──────────────────────────────────────────────────────
//
// Verifies the tables exist before we commit to the Catalyst backend, so a
// misconfigured project degrades to JSON files with one clear message instead
// of 503-ing every request.
//
// This replaces two things:
//
//   - `testTable`, a pre-existing table used as the primary tasks store with
//     KaizenTasks as a "legacy" fallback. A successful testTable probe returned
//     early without ever checking KaizenLists or KaizenNotes, so lists and
//     notes 503'd while tasks appeared to work. The schema is now one set of
//     three tables; see server/catalyst/schema.ts.
//
//   - A runtime column provisioner that reached into private SDK fields
//     (`table.requester.send`) to POST undocumented endpoints on every boot,
//     typing every column as `text`. Schema changes belong in
//     `pnpm catalyst:setup`, which knows the real column types.

import {
  SCHEMA, TABLE_NAMES, TASKS_TABLE, LISTS_TABLE, NOTES_TABLE, RULES_TABLE, VIEWS_TABLE, PROP_DEFS_TABLE,
} from './catalyst/schema.ts';

/**
 * Checks that every table in the schema is queryable.
 * Returns the names of any that are not.
 */
async function probeCatalystTables(req: express.Request): Promise<boolean> {
  let app = initCatalyst(req);
  const missing: string[] = [];

  // A token decrypted from the CLI's config may already have expired. Spend one
  // retry on a forced refresh before concluding Catalyst is unreachable —
  // otherwise a stale token silently downgrades the whole session to JSON-file
  // storage, which looks identical to having no credentials at all.
  try {
    await app.zcql().executeZCQLQuery(`SELECT ROWID FROM ${SCHEMA[0].name} LIMIT 1`);
  } catch (e) {
    const status = (e as { statusCode?: number })?.statusCode;
    if (status === 401 || status === 400) {
      console.warn('[kaizen] Catalyst rejected the cached token — refreshing and retrying once');
      const refreshed = await getCliApp({ forceRefresh: true });
      if (refreshed) app = refreshed;
    }
  }

  for (const table of SCHEMA) {
    try {
      await app.zcql().executeZCQLQuery(`SELECT ROWID FROM ${table.name} LIMIT 1`);
    } catch (e) {
      const msg = describeError(e);
      if (/not found|does not exist|invalid table|no such table/i.test(msg)) {
        missing.push(table.name);
      } else {
        // Something other than absence — a credential or connectivity problem.
        // String(e) on an SDK error yields "[object Object]", which hides the
        // one detail that matters (an expired token reads as 401).
        console.error(`[kaizen] Probing ${table.name} failed: ${describeError(e)}`);
        return false;
      }
    }
  }

  if (missing.length) {
    console.error(
      `[kaizen] Missing Catalyst table(s): ${missing.join(', ')}\n` +
      `[kaizen]   Run \`pnpm catalyst:setup\` to create them, or\n` +
      `[kaizen]   \`pnpm catalyst:setup --dry-run\` to see what is missing.\n` +
      `[kaizen]   Falling back to JSON-file storage.`
    );
    return false;
  }

  console.log(`[kaizen] Catalyst tables verified: ${TABLE_NAMES.join(', ')}`);
  return true;
}


// ── JSON-file fallback ────────────────────────────────────────────────────────

const DB_PATH       = path.join(__dirname, 'notes-db.json');
const TASKS_DB_PATH = path.join(__dirname, 'tasks-db.json');
const LISTS_DB_PATH = path.join(__dirname, 'lists-db.json');

interface NotesDb  { notes: DbNote[] }
interface TasksDb  { tasks: DbTask[] }
interface ListsDb  { lists: DbList[] }

/**
 * Reads a JSON store, validating its shape.
 *
 * The previous version caught every failure and returned the empty value. A
 * corrupt or truncated file therefore read as "no records", and the very next
 * write overwrote it with a single row — silent, total, unrecoverable data
 * loss. A valid-but-wrong-shape file (say `{}`) was worse: it returned an
 * object whose `.tasks` was undefined, and the caller's `.filter` threw a
 * TypeError that surfaced as a 503.
 *
 * Now an unreadable or malformed file is moved aside as
 * <name>.corrupt.<timestamp> and loudly logged, so the bad data is preserved
 * for inspection and the next write starts from a known-empty store instead of
 * destroying evidence.
 */
function readJson<T>(filePath: string, empty: T, isValid: (v: unknown) => v is T): T {
  let raw: string;
  try {
    if (!fs.existsSync(filePath)) return empty;
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    console.error(`[kaizen] Could not read ${filePath}:`, e);
    return empty;
  }

  // An empty file is a legitimate "nothing stored yet".
  if (raw.trim() === '') return empty;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    quarantine(filePath, `invalid JSON: ${String(e)}`);
    return empty;
  }

  if (!isValid(parsed)) {
    quarantine(filePath, 'JSON did not match the expected store shape');
    return empty;
  }
  return parsed;
}

/** Moves a damaged store aside rather than letting the next write erase it. */
function quarantine(filePath: string, reason: string): void {
  const backup = `${filePath}.corrupt.${Date.now()}`;
  try {
    fs.renameSync(filePath, backup);
    console.error(
      `[kaizen] ${path.basename(filePath)} is unusable (${reason}).\n` +
      `[kaizen]   Moved to ${backup}. Starting from an empty store.`
    );
  } catch (e) {
    console.error(`[kaizen] ${filePath} is unusable (${reason}) and could not be moved aside:`, e);
  }
}

// Shape guards. These check the container, not every record: a malformed row
// is survivable, a malformed container is not.
function isRecordArrayUnder<K extends string>(key: K) {
  return (v: unknown): v is Record<K, unknown[]> =>
    typeof v === 'object' && v !== null && Array.isArray((v as Record<string, unknown>)[key]);
}

const isNotesDb = isRecordArrayUnder('notes') as (v: unknown) => v is NotesDb;
const isTasksDb = isRecordArrayUnder('tasks') as (v: unknown) => v is TasksDb;
const isListsDb = isRecordArrayUnder('lists') as (v: unknown) => v is ListsDb;

/** Typed readers, so no call site has to repeat the empty value and guard. */
const readNotesDb = (): NotesDb => readJson<NotesDb>(DB_PATH,       { notes: [] }, isNotesDb);
const readTasksDb = (): TasksDb => readJson<TasksDb>(TASKS_DB_PATH, { tasks: [] }, isTasksDb);
const readListsDb = (): ListsDb => readJson<ListsDb>(LISTS_DB_PATH, { lists: [] }, isListsDb);

/**
 * Writes a JSON store atomically and durably.
 *
 * Three problems with the previous version:
 *
 *   - The temp file was a fixed `<name>.tmp`. Two processes sharing the store
 *     (trivially reachable — `pnpm dev` and `pnpm preview:server` both point
 *     at server/) would interleave their writeFileSync calls into the same
 *     path, so one could rename a file the other was still writing and publish
 *     a half-written store. rename(2) is atomic; a shared temp file is not.
 *   - No fsync. After rename the directory entry points at data that may still
 *     be in the page cache, so a crash or power loss leaves a zero-length or
 *     garbage file — which the reader then quarantines as corrupt.
 *   - No mkdir. If server/ does not exist (a deploy bundle that ships only the
 *     compiled file, or a read-only mount) the first write throws ENOENT and
 *     every subsequent one fails the same way.
 *
 * Note this does not make the store safe for concurrent *processes* in
 * general: each handler's read-modify-write is serial only because it contains
 * no await, so within one process it cannot interleave. Two servers on the
 * same files will still lose each other's updates. The JSON store is a
 * single-process development fallback; Catalyst is the real backend.
 */
function writeJson<T>(filePath: string, data: T): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  // Unique per write, so a second process cannot share our temp file.
  const tmp = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;

  let fd: number | undefined;
  try {
    fd = fs.openSync(tmp, 'w');
    fs.writeFileSync(fd, JSON.stringify(data, null, 2), 'utf8');
    fs.fsyncSync(fd);          // the data itself
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }

  try {
    fs.renameSync(tmp, filePath);
  } catch (e) {
    // Do not leave the temp file behind if the rename failed.
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    throw e;
  }

  // fsync the directory so the rename itself survives a crash.
  try {
    const dirFd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  } catch {
    // Not supported on every platform/filesystem; the rename is still atomic.
  }
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
  /** Note the task was added from via the @ menu; '' when not from a note. */
  sourceNoteId: string;
  sourceBlockId: string;
}

// Resolved at startup: 'testTable' if available, else 'KaizenTasks'
function getTasksTable(): string { return TASKS_TABLE; }

// Full column list including OwnerId for owner-scoped queries
const TASKS_COLS = 'TaskId,OwnerId,Title,Status,Quadrant,TaskPriority,Note,DueDate,DueTime,Category,ListId,TaskOrder,ReminderEnabled,ReminderMinutesBefore,CompletedAt,CreatedAt,UpdatedAt';

/**
 * Columns added after launch, and whether the table actually has them yet.
 *
 * They arrive with `pnpm catalyst:setup`. Selecting a column that does not
 * exist fails the WHOLE query, so naming one before it is created would break
 * every read of that table for every user — a deploy landing ahead of the
 * schema step must not be able to do that. So each is probed once and the
 * feature it carries simply stays off until it is there.
 *
 * A failure that is not "no such column" is deliberately not cached: it is a
 * network or credential blip, and the next request checks again.
 */
const optionalColumns = new Map<string, boolean>();

async function hasOptionalColumn(
  req: express.Request, table: string, column: string, whatItCosts: string,
): Promise<boolean> {
  const key = `${table}.${column}`;
  const known = optionalColumns.get(key);
  if (known !== undefined) return known;
  if (!catalystAvailable) return false;

  try {
    await initCatalyst(req).zcql().executeZCQLQuery(`SELECT ${column} FROM ${table} LIMIT 1`);
    optionalColumns.set(key, true);
    return true;
  } catch (e) {
    if (/column|invalid|not found|no such|does not exist/i.test(describeError(e))) {
      optionalColumns.set(key, false);
      console.warn(
        `[kaizen] ${key} is missing — ${whatItCosts} until \`pnpm catalyst:setup\` adds it. ` +
        'Existing reads and writes are unaffected.'
      );
    }
    return false;
  }
}

/** Whether KaizenTasks has the note-link columns. */
let taskLinkColumns = false;

async function ensureTaskLinkColumns(req: express.Request): Promise<boolean> {
  taskLinkColumns = await hasOptionalColumn(
    req, TASKS_TABLE, 'SourceNoteId', 'note links will not be stored',
  );
  return taskLinkColumns;
}

/** Whether KaizenAutomationRules has the escalation-steps column. */
async function ensureRuleStepsColumn(req: express.Request): Promise<boolean> {
  const available = await hasOptionalColumn(
    req, RULES_TABLE, 'OffsetSteps', 'a rule will fire at one offset rather than several',
  );
  setStepsColumnAvailable(available);
  return available;
}

/**
 * Whether KaizenPropDefs has DatabaseId. Without it every field is a task
 * field, which is what every field written before databases was.
 */
async function ensureFieldsDatabaseColumn(req: express.Request): Promise<boolean> {
  const available = await hasOptionalColumn(
    req, PROP_DEFS_TABLE, 'DatabaseId', 'every field will be read as a task field',
  );
  setFieldsDatabaseAvailable(available);
  return available;
}

/**
 * Whether KaizenViews has DisplayJson. Without it a view saves as it always
 * did and a table's column choices stay in the browser.
 */
async function ensureViewDisplayColumn(req: express.Request): Promise<boolean> {
  const available = await hasOptionalColumn(
    req, VIEWS_TABLE, 'DisplayJson', 'table column choices will not be saved with a view',
  );
  setViewDisplayAvailable(available);
  return available;
}

/** The task columns to SELECT, given what the table has. */
function tasksCols(): string {
  return taskLinkColumns ? `${TASKS_COLS},SourceNoteId,SourceBlockId` : TASKS_COLS;
}

function rowToTask(row: ICatalystRow): DbTask {
  return {
    id:                    String(row['TaskId'] ?? ''),
    ownerId:               String(row['OwnerId'] ?? LOCAL_DEV_OWNER),
    title:                 String(row['Title'] ?? ''),
    status:                String(row['Status'] ?? 'TODO'),
    quadrant:              String(row['Quadrant'] ?? 'SCHEDULE'),
    priority:              String(row['TaskPriority'] ?? ''),
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
    // Absent on rows from before the columns existed, or when they were not selected.
    sourceNoteId:          row['SourceNoteId'] != null ? String(row['SourceNoteId']) : '',
    sourceBlockId:         row['SourceBlockId'] != null ? String(row['SourceBlockId']) : '',
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
    TaskPriority:          t.priority,
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
    // Only when the columns exist. Leaving them out of an update leaves any
    // stored value untouched, so this can never clear a link.
    ...(taskLinkColumns
      ? { SourceNoteId: t.sourceNoteId ?? '', SourceBlockId: t.sourceBlockId ?? '' }
      : {}),
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
    // `|| null` also covers JSON-file tasks written before these fields existed.
    sourceNoteId:          t.sourceNoteId || null,
    sourceBlockId:         t.sourceBlockId || null,
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
  if (table === getTasksTable()) await ensureTaskLinkColumns(req);
  const cols = table === getTasksTable() ? tasksCols() : LISTS_COLS;
  try {
    const results = await app.zcql().executeZCQLQuery(
      `SELECT ${cols} FROM ${table} WHERE ${ownerCol} = ${zcqlString(ownerId)}`
    );
    return results.map((r) => converter(r[table] as ICatalystRow));
  } catch (e: unknown) {
    const msg = describeError(e);
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

// ── Request validation ────────────────────────────────────────────────────────
//
// Validation used to be `if (!body.title)` and nothing else. That accepted
// title as {} , [] , 12345 or "   ", and a 4 MB string under the body cap. The
// enum fields were never checked at all, so `status: "BANANA"` was persisted
// and then cast to a TaskStatus union in dbTaskToApi — the type was a lie, and
// it broke the status sort, which maps unknown values to the same rank.
// `taskOrder: "abc"` survived to `a.taskOrder - b.taskOrder`, producing a NaN
// comparator and an unstable order.

const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'DONE'] as const;
const QUADRANTS     = ['DO', 'SCHEDULE', 'DELEGATE', 'ELIMINATE'] as const;
const PRIORITIES    = ['LOW', 'MEDIUM', 'HIGH'] as const;

const MAX_TITLE_LEN    = 500;
const MAX_NOTE_LEN     = 10_000;  // Catalyst Text column limit
const MAX_CATEGORY_LEN = 100;

/** Collects field errors so a bad request reports everything at once. */
class FieldErrors {
  readonly errors: Record<string, string> = {};
  get ok(): boolean { return Object.keys(this.errors).length === 0; }
  add(field: string, message: string): void { this.errors[field] = message; }

  send(res: express.Response): void {
    res.status(400).json({
      error: 'validation_failed',
      message: 'One or more fields are invalid',
      fields: this.errors,
    });
  }
}

/** Required non-empty string within a length bound. */
function reqString(
  errs: FieldErrors, field: string, value: unknown, maxLen: number
): string | undefined {
  if (typeof value !== 'string') { errs.add(field, 'must be a string'); return undefined; }
  const trimmed = value.trim();
  if (trimmed === '')           { errs.add(field, 'must not be empty'); return undefined; }
  if (trimmed.length > maxLen)  { errs.add(field, `must be at most ${maxLen} characters`); return undefined; }
  return trimmed;
}

/** Optional string; absent/null yields the fallback. */
function optString(
  errs: FieldErrors, field: string, value: unknown, maxLen: number, fallback = ''
): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') { errs.add(field, 'must be a string'); return fallback; }
  if (value.length > maxLen)     { errs.add(field, `must be at most ${maxLen} characters`); return fallback; }
  return value;
}

/**
 * The firing steps of a rule: signed minutes from the due instant.
 *
 * Absent is legitimate — an older client sends a single `reminderOffset`
 * instead — so only a present-but-wrong value is an error.
 */
function optSteps(errs: FieldErrors, value: unknown): number[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) { errs.add('offsetMinutes', 'must be an array of minutes'); return []; }
  if (value.length > MAX_STEPS) {
    errs.add('offsetMinutes', `must have at most ${MAX_STEPS} entries`);
    return [];
  }
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) {
      errs.add('offsetMinutes', 'must contain only numbers');
      return [];
    }
    if (Math.abs(entry) > MAX_STEP_MINUTES) {
      errs.add('offsetMinutes', 'must be within a year of the due date');
      return [];
    }
  }
  return normaliseSteps(value as number[]);
}

/** Optional id: '' clears; anything else must be a safe id. */
function optSafeId(errs: FieldErrors, field: string, value: unknown): string {
  const v = optString(errs, field, value, 64);
  if (v !== '' && !SAFE_ID.test(v)) errs.add(field, `must match ${String(SAFE_ID)}`);
  return v;
}

/** Optional member of a fixed set. Case-insensitive, stored upper-case. */
function optEnum<T extends string>(
  errs: FieldErrors, field: string, value: unknown, allowed: readonly T[], fallback: T | ''
): T | '' {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') { errs.add(field, 'must be a string'); return fallback; }
  const upper = value.trim().toUpperCase() as T;
  if (!allowed.includes(upper)) {
    errs.add(field, `must be one of ${allowed.join(', ')}`);
    return fallback;
  }
  return upper;
}

/**
 * Optional member of a fixed set, preserving case.
 *
 * optEnum upper-cases, which suits the task columns (TODO, HIGH). The
 * automation vocabulary is lower-case and hyphenated — 'due-date', 'active',
 * 'critical' — and upper-casing it would make every value fail its own
 * allow-list.
 */
function optLowerEnum<T extends string>(
  errs: FieldErrors, field: string, value: unknown, allowed: readonly T[], fallback: T
): T {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') { errs.add(field, 'must be a string'); return fallback; }
  const lower = value.trim().toLowerCase() as T;
  if (!allowed.includes(lower)) {
    errs.add(field, `must be one of ${allowed.join(', ')}`);
    return fallback;
  }
  return lower;
}

/** Optional finite number. Rejects NaN, Infinity and numeric strings that are not. */
function optNumber(
  errs: FieldErrors, field: string, value: unknown, fallback: number, min = Number.NEGATIVE_INFINITY
): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) { errs.add(field, 'must be a finite number'); return fallback; }
  if (n < min)             { errs.add(field, `must be at least ${min}`); return fallback; }
  return n;
}

/** Optional boolean. Accepts real booleans and the strings "true"/"false". */
function optBoolean(
  errs: FieldErrors, field: string, value: unknown, fallback: boolean
): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true')  return true;
  if (value === 'false') return false;
  errs.add(field, 'must be a boolean');
  return fallback;
}

/** Optional YYYY-MM-DD date. */
function optDate(errs: FieldErrors, field: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    errs.add(field, 'must be a date in YYYY-MM-DD form');
    return '';
  }
  // Reject calendar-invalid dates such as 2026-02-31.
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    errs.add(field, 'is not a real calendar date');
    return '';
  }
  return value;
}

/** Optional HH:MM time. */
function optTime(errs: FieldErrors, field: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    errs.add(field, 'must be a time in HH:MM form');
    return '';
  }
  return value;
}

/**
 * Validated partial update for a task: only keys actually present in the body
 * are returned, so an omitted field is left untouched.
 *
 * A whitelist matters here. The routes used to build the updated row with
 * `{ ...existing, ...body }`. id and ownerId were pinned back afterwards, but
 * createdAt and completedAt were not — so a client could rewrite them and
 * forge the momentum and streak statistics, which are computed entirely from
 * completedAt. Unknown keys rode along into the row object too.
 */
function parseTaskPatch(body: Record<string, unknown>, errs: FieldErrors): Partial<DbTask> {
  const patch: Partial<DbTask> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);

  if (has('title')) {
    const v = reqString(errs, 'title', body['title'], MAX_TITLE_LEN);
    if (v !== undefined) patch.title = v;
  }
  if (has('status'))                patch.status                = optEnum(errs, 'status', body['status'], TASK_STATUSES, 'TODO');
  if (has('quadrant'))              patch.quadrant              = optEnum(errs, 'quadrant', body['quadrant'], QUADRANTS, 'SCHEDULE');
  if (has('priority'))              patch.priority              = optEnum(errs, 'priority', body['priority'], PRIORITIES, '');
  if (has('note'))                  patch.note                  = optString(errs, 'note', body['note'], MAX_NOTE_LEN);
  if (has('dueDate'))               patch.dueDate               = optDate(errs, 'dueDate', body['dueDate']);
  if (has('dueTime'))               patch.dueTime               = optTime(errs, 'dueTime', body['dueTime']);
  if (has('category'))              patch.category              = optString(errs, 'category', body['category'], MAX_CATEGORY_LEN);
  if (has('listId'))                patch.listId                = optString(errs, 'listId', body['listId'], 64);
  if (has('taskOrder'))             patch.taskOrder             = optNumber(errs, 'taskOrder', body['taskOrder'], 0);
  if (has('reminderEnabled'))       patch.reminderEnabled       = optBoolean(errs, 'reminderEnabled', body['reminderEnabled'], false);
  if (has('reminderMinutesBefore')) patch.reminderMinutesBefore = optNumber(errs, 'reminderMinutesBefore', body['reminderMinutesBefore'], 0, 0);
  if (has('sourceNoteId'))          patch.sourceNoteId          = optSafeId(errs, 'sourceNoteId', body['sourceNoteId']);
  if (has('sourceBlockId'))         patch.sourceBlockId         = optSafeId(errs, 'sourceBlockId', body['sourceBlockId']);

  // id, ownerId, createdAt, updatedAt and completedAt are server-owned and are
  // deliberately absent from this list.
  return patch;
}

/** Validated partial update for a list. */
function parseListPatch(body: Record<string, unknown>, errs: FieldErrors): Partial<DbList> {
  const patch: Partial<DbList> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);

  if (has('name')) {
    const v = reqString(errs, 'name', body['name'], MAX_TITLE_LEN);
    if (v !== undefined) patch.name = v;
  }
  if (has('color'))     patch.color     = optString(errs, 'color', body['color'], 32, 'emerald');
  if (has('listOrder')) patch.listOrder = optNumber(errs, 'listOrder', body['listOrder'], 0);
  return patch;
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

// Fail safe: anything other than an explicit development environment is
// treated as production, so error details are withheld by default. AppSail
// rejects NODE_ENV in env_variables (the CATALYST_/NODE_ reserved keywords),
// so a deployment may well not set it — and defaulting to "not production"
// there would echo raw datastore errors to clients.
const IS_PRODUCTION = (process.env['NODE_ENV'] ?? 'production') !== 'development';

/**
 * Renders an unknown thrown value usefully.
 *
 * The Catalyst SDK throws objects whose String() is "[object Object]" — which
 * is what a failing table probe used to log, hiding whether the cause was a
 * missing table, an expired token or a network fault.
 */
function describeError(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    const parts = [o['name'], o['code'], o['statusCode'], o['message']]
      .filter((v) => v !== undefined && v !== null)
      .map(String);
    if (parts.length) return parts.join(' | ');
    try { return JSON.stringify(e); } catch { /* fall through */ }
  }
  return String(e);
}

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

/**
 * Normalises an origin for comparison.
 *
 * A fully-qualified hostname may carry a trailing dot — https://example.com.
 * is a valid URL and resolves identically, but the browser treats it as a
 * DIFFERENT origin. Reaching this app by that form made its own same-origin
 * API calls cross-origin, and they were then refused here. Strip the dot so
 * both spellings match.
 */
function normaliseOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    url.hostname = url.hostname.replace(/\.$/, '');
    return url.origin;
  } catch {
    return origin;
  }
}

const allowedOriginSet = new Set(corsOrigins.map(normaliseOrigin));

app.use(cors({
  origin(origin, callback) {
    // No Origin header: same-origin, curl, or a server-to-server call.
    if (!origin) return callback(null, true);
    if (allowedOriginSet.has(normaliseOrigin(origin))) return callback(null, true);
    // Reject by withholding the header rather than erroring, so the browser
    // reports a clean CORS failure instead of a 500.
    return callback(null, false);
  },
  credentials: true,
}));
// The Slate client sends every call as a CORS simple request (the AppSail
// gateway answers preflights itself, with no CORS headers). Map its method
// override and timezone parameter back, refuse changes from origins that are
// not allowed, and read its text/plain bodies as JSON.
app.use('/api', simpleRequestMiddleware((origin) => allowedOriginSet.has(normaliseOrigin(origin))));
app.use(express.json({ limit: '4mb', type: ['application/json', 'text/plain'] }));

// ── Readiness gate ────────────────────────────────────────────────────────────
//
// The backend probe used to run before app.listen(), so the socket opened only
// after Catalyst had been contacted. That is correct but too slow for a
// platform that expects the port to be bound promptly — AppSail reports
// "Execution failed. Please check the startup command or port." if it waits
// too long.
//
// So: bind immediately, and hold API requests here until the backend has
// settled. Requests still never observe a half-configured backend (the bug the
// original change fixed), and the port is available at once.

let backendReady: Promise<void> | null = null;

app.use('/api', (req, res, next) => {
  // The background sweep has no request of its own, and under the gateway the
  // SDK's credentials live in request headers. Remember the latest set so the
  // timer has something to authenticate with. See catalyst/init.ts.
  captureGatewayCredentials(req);

  if (!backendReady) { next(); return; }
  backendReady.then(() => next(), (e) => {
    console.error('[kaizen] Backend never became ready:', e);
    res.status(503).json({ error: 'starting_up', message: 'Server is still starting' });
  });
});

// Keeps the sweep timer in step with the notifications switch in
// KaizenTrialFeatures, so turning it back on needs no redeploy: the next request
// starts the timer. Cached for a minute — one query a minute at most.
app.use('/api', (req, _res, next) => {
  if (catalystAvailable) {
    try {
      void syncTrialFeatures(initCatalyst(req) as unknown as NotificationApp);
    } catch { /* no credentials on this request; the next one tries again */ }
  }
  next();
});

// ── Health ────────────────────────────────────────────────────────────────────

app.head('/api/health', (_req, res) => { res.sendStatus(200); });
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    ts: Date.now(),
    backend: catalystAvailable ? 'catalyst' : 'json-file',
    // How the SDK would authenticate this request: 'gateway' (Catalyst headers
    // present), 'standalone' (env credentials) or 'none'. Without this, a
    // misconfiguration is invisible until a write fails.
    catalystMode: describeMode(req, standaloneConfig),
    lastCatalystMode,
  });
});

// ── Automation rules ─────────────────────────────────────────────────────────
//
// Until now these lived only in the browser's localStorage, and nothing
// anywhere read one and decided to fire it. A user could configure a rule, see
// it listed as active with a next-run time, and nothing would ever happen.
// Moving them here is what makes them executable — the sweep's PLAN phase
// queries this table; see server/automations/planner.ts.

const RECURRENCE_FREQS = ['daily', 'weekdays', 'weekly', 'monthly'] as const;

/** The API shape, which mirrors src/types/automation.ts. */
function ruleToApi(rule: AutomationRule) {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description || undefined,
    taskId: rule.taskId || undefined,
    triggerType: rule.triggerType,
    status: rule.status,
    urgency: rule.urgency,
    // Signed minutes from the due instant, one per firing. Derived for rules
    // written before the column existed, so a client never has to know which.
    offsetMinutes: stepsForRule(rule),
    // The single offset the first step describes. Kept for older clients.
    reminderOffset: rule.offsetValue > 0
      ? { value: rule.offsetValue, unit: rule.offsetUnit }
      : undefined,
    recurrence: {
      frequency: rule.recurrenceFreq,
      time: rule.recurrenceTime,
      dayOfWeek: rule.recurrenceDayOfWeek,
      dayOfMonth: rule.recurrenceDayOfMonth,
    },
    notifyInApp: rule.notifyInApp,
    notifyBrowser: rule.notifyBrowser,
    notifyEmail: rule.notifyEmail,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
    lastTriggeredAt: rule.lastTriggeredAt || undefined,
    nextTriggerAt: rule.nextTriggerAt || undefined,
  };
}

/** Validates a rule body. Returns undefined when anything is wrong. */
function parseRuleBody(
  body: Record<string, unknown>, errs: FieldErrors,
): Omit<AutomationRule, 'id' | 'ownerId' | 'createdAt' | 'updatedAt' |
                        'lastTriggeredAt' | 'nextTriggerAt' |
                        'ownerTimezone' | 'ownerEmail'> | undefined {
  const name = reqString(errs, 'name', body['name'], 255);

  const offset = (body['reminderOffset'] ?? {}) as Record<string, unknown>;
  const recurrence = (body['recurrence'] ?? {}) as Record<string, unknown>;

  const parsed = {
    name: name ?? '',
    description: optString(errs, 'description', body['description'], 2000),
    taskId: optString(errs, 'taskId', body['taskId'], 64),
    triggerType: optLowerEnum(errs, 'triggerType', body['triggerType'], TRIGGER_TYPES, 'due-date'),
    status: optLowerEnum(errs, 'status', body['status'], RULE_STATUSES, 'draft'),
    urgency: optLowerEnum(errs, 'urgency', body['urgency'], URGENCIES, 'medium'),
    offsetValue: optNumber(errs, 'reminderOffset.value', offset['value'], 0, 0),
    offsetUnit: optLowerEnum(errs, 'reminderOffset.unit', offset['unit'], OFFSET_UNITS, 'minutes'),
    recurrenceFreq: optLowerEnum(
      errs, 'recurrence.frequency', recurrence['frequency'], RECURRENCE_FREQS, 'daily',
    ),
    recurrenceTime: optTime(errs, 'recurrence.time', recurrence['time']),
    recurrenceDayOfWeek: optNumber(errs, 'recurrence.dayOfWeek', recurrence['dayOfWeek'], 0, 0),
    recurrenceDayOfMonth: optNumber(errs, 'recurrence.dayOfMonth', recurrence['dayOfMonth'], 1, 1),
    notifyInApp: optBoolean(errs, 'notifyInApp', body['notifyInApp'], true),
    notifyBrowser: optBoolean(errs, 'notifyBrowser', body['notifyBrowser'], false),
    notifyEmail: optBoolean(errs, 'notifyEmail', body['notifyEmail'], false),
    offsetSteps: optSteps(errs, body['offsetMinutes']),
  };

  // A schedule-driven rule with no time cannot be planned, and would sit
  // inert with nothing saying why. Reject it at the door instead.
  const scheduled = parsed.triggerType === 'recurring' || parsed.triggerType === 'daily-digest';
  if (scheduled && !parsed.recurrenceTime) {
    errs.add('recurrence.time', 'is required for a recurring or digest rule');
  }

  // A task-driven rule needs at least one firing. An older client sends none,
  // and its single reminderOffset becomes that one step, so both shapes work.
  const taskDriven = parsed.triggerType === 'due-date' || parsed.triggerType === 'overdue';
  if (taskDriven && parsed.offsetSteps.length === 0) {
    parsed.offsetSteps = parsed.triggerType === 'overdue'
      ? [0]
      : [-legacyOffsetMinutes(parsed.offsetValue, parsed.offsetUnit)];
  }

  return errs.ok && name !== undefined ? parsed : undefined;
}

/** The owner context a rule carries so the cron can fire it without a session. */
async function ruleOwnerContext(
  req: express.Request, ownerId: string,
): Promise<{ ownerTimezone: string; ownerEmail: string }> {
  return {
    ownerTimezone: resolveTimeZone(req.headers['x-timezone']),
    ownerEmail: (await getCurrentIdentity(req)).email,
  };
}

app.get('/api/automation-rules', async (req, res) => {
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;
  if (!catalystAvailable) { res.json([]); return; }
  await ensureRuleStepsColumn(req);

  try {
    const rules = await listRules(initCatalyst(req) as unknown as NotificationApp, ownerId);
    res.json(rules.map(ruleToApi));
  } catch (e) {
    sendError(res, '[GET /api/automation-rules]', e);
  }
});

app.post('/api/automation-rules', async (req, res) => {
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;
  if (!catalystAvailable) { res.status(503).json({ error: 'datastore_unavailable' }); return; }
  await ensureRuleStepsColumn(req);

  const errs = new FieldErrors();
  const fields = parseRuleBody((req.body ?? {}) as Record<string, unknown>, errs);
  if (!fields) { errs.send(res); return; }

  const now = Date.now();
  const owner = await ruleOwnerContext(req, ownerId);

  const rule: AutomationRule = {
    id: randomUUID(),
    ownerId,
    ...fields,
    ...owner,
    lastTriggeredAt: 0,
    nextTriggerAt: 0,
    createdAt: now,
    updatedAt: now,
  };
  // Compute when it first fires, so an active rule is due without waiting for
  // an edit. Non-schedule triggers get 0 and stay out of the planning query.
  rule.nextTriggerAt = initialTrigger({ ...rule, rowId: '' }, owner.ownerTimezone, now);

  try {
    await insertRule(initCatalyst(req) as unknown as NotificationApp, rule);
    res.status(201).json(ruleToApi(rule));
  } catch (e) {
    sendError(res, '[POST /api/automation-rules]', e);
  }
});

app.put('/api/automation-rules/:id', async (req, res) => {
  if (!assertSafeId(req.params.id, res)) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;
  if (!catalystAvailable) { res.status(503).json({ error: 'datastore_unavailable' }); return; }
  await ensureRuleStepsColumn(req);

  const errs = new FieldErrors();
  const fields = parseRuleBody((req.body ?? {}) as Record<string, unknown>, errs);
  if (!fields) { errs.send(res); return; }

  try {
    const catalyst = initCatalyst(req) as unknown as NotificationApp;
    const existing = await getRule(catalyst, ownerId, req.params.id);
    if (!existing) { res.status(404).json({ error: 'Not found' }); return; }

    const now = Date.now();
    const owner = await ruleOwnerContext(req, ownerId);
    const updated: RuleRow = {
      ...existing, ...fields, ...owner,
      id: req.params.id, ownerId, updatedAt: now,
    };

    // Re-plan on every edit. The schedule may have moved, the rule may have
    // been paused, or its trigger type changed — all of which change whether
    // and when it is next due, and none of which the tick could infer.
    updated.nextTriggerAt = initialTrigger(updated, owner.ownerTimezone, now);

    await updateRule(catalyst, existing.rowId, updated);
    res.json(ruleToApi(updated));
  } catch (e) {
    sendError(res, '[PUT /api/automation-rules/:id]', e);
  }
});

app.delete('/api/automation-rules/:id', async (req, res) => {
  if (!assertSafeId(req.params.id, res)) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;
  if (!catalystAvailable) { res.sendStatus(204); return; }
  await ensureRuleStepsColumn(req);

  try {
    const catalyst = initCatalyst(req) as unknown as NotificationApp;
    const existing = await getRule(catalyst, ownerId, req.params.id);
    if (!existing) { res.status(404).json({ error: 'Not found' }); return; }

    await deleteRule(catalyst, existing.rowId);
    // Withdraw anything the rule had already queued but not yet delivered —
    // its own firings and every per-task firing. Deleting a rule should not
    // leave one last notification in flight.
    await cancelPendingForRule(catalyst, ownerId, req.params.id);
    res.sendStatus(204);
  } catch (e) {
    sendError(res, '[DELETE /api/automation-rules/:id]', e);
  }
});

// ── Saved views ──────────────────────────────────────────────────────────────
//
// Named filter, sort and layout combinations over the owner's tasks. Filtering
// happens in the browser over loaded tasks (src/lib/taskFilters.ts); these
// routes only store the definitions. Without Catalyst they answer 503, so the
// client keeps views on the device rather than believing they were saved.

function sendViewErrors(res: express.Response, errors: Record<string, string>): void {
  res.status(400).json({ error: 'validation_failed', message: 'One or more fields are invalid', fields: errors });
}

// ── Databases ─────────────────────────────────────────────────────────────────
//
// Records that are not tasks. Fields and values are the existing
// KaizenPropDefs / KaizenTaskProps, scoped by DatabaseId — see server/databases.ts.

function sendDbErrors(res: express.Response, errors: Record<string, string>): void {
  res.status(400).json({ error: 'invalid', fields: errors });
}

app.get('/api/databases', async (req, res) => {
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;
  if (!catalystAvailable) { res.status(503).json({ error: 'datastore_unavailable' }); return; }

  try {
    const dbs = await listDatabases(initCatalyst(req) as unknown as NotificationApp, ownerId);
    res.json(dbs.map(databaseToApi));
  } catch (e) {
    sendError(res, '[GET /api/databases]', e);
  }
});

app.post('/api/databases', async (req, res) => {
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;
  if (!catalystAvailable) { res.status(503).json({ error: 'datastore_unavailable' }); return; }

  const parsed = parseDatabaseBody((req.body ?? {}) as Record<string, unknown>);
  if (!parsed.ok) { sendDbErrors(res, parsed.errors); return; }

  try {
    const catalyst = initCatalyst(req) as unknown as NotificationApp;
    const existing = await listDatabases(catalyst, ownerId);
    if (existing.length >= MAX_DATABASES) {
      sendDbErrors(res, { name: `you already have ${MAX_DATABASES} databases; delete one first` });
      return;
    }

    const now = Date.now();
    const db: KaizenDatabase = {
      ...parsed.value,
      id: randomUUID(),
      ownerId,
      dbOrder: parsed.value.dbOrder ?? existing.reduce((m, d) => Math.max(m, d.dbOrder), -1) + 1,
      createdAt: now,
      updatedAt: now,
    };
    await insertDatabase(catalyst, db);
    res.status(201).json(databaseToApi(db));
  } catch (e) {
    sendError(res, '[POST /api/databases]', e);
  }
});

app.put('/api/databases/:id', async (req, res) => {
  if (!assertSafeId(req.params.id, res)) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;
  if (!catalystAvailable) { res.status(503).json({ error: 'datastore_unavailable' }); return; }

  const parsed = parseDatabaseBody((req.body ?? {}) as Record<string, unknown>);
  if (!parsed.ok) { sendDbErrors(res, parsed.errors); return; }

  try {
    const catalyst = initCatalyst(req) as unknown as NotificationApp;
    const existing = await getDatabase(catalyst, ownerId, req.params.id);
    if (!existing) { res.status(404).json({ error: 'Not found' }); return; }

    const updated: KaizenDatabase = {
      ...existing,
      ...parsed.value,
      id: existing.id,
      ownerId,
      dbOrder: parsed.value.dbOrder ?? existing.dbOrder,
      updatedAt: Date.now(),
    };
    await updateDatabase(catalyst, existing.rowId, updated);
    res.json(databaseToApi(updated));
  } catch (e) {
    sendError(res, '[PUT /api/databases/:id]', e);
  }
});

app.post('/api/databases/:id/delete', async (req, res) => {
  if (!assertSafeId(req.params.id, res)) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;
  if (!catalystAvailable) { res.status(503).json({ error: 'datastore_unavailable' }); return; }

  try {
    const catalyst = initCatalyst(req) as unknown as NotificationApp;
    const existing = await getDatabase(catalyst, ownerId, req.params.id);
    if (!existing) { res.status(404).json({ error: 'Not found' }); return; }

    // Records first: stopping half-way leaves a database that still lists what
    // is left, rather than records belonging to nothing.
    const removed = await deleteRowsOfDatabase(catalyst, ownerId, existing.id);
    await deleteDatabase(catalyst, existing.rowId);
    res.json({ ok: true, recordsRemoved: removed });
  } catch (e) {
    sendError(res, '[POST /api/databases/:id/delete]', e);
  }
});

app.get('/api/databases/:id/rows', async (req, res) => {
  if (!assertSafeId(req.params.id, res)) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;
  if (!catalystAvailable) { res.status(503).json({ error: 'datastore_unavailable' }); return; }

  try {
    const catalyst = initCatalyst(req) as unknown as NotificationApp;
    const rows = await listRows(catalyst, ownerId, req.params.id);
    res.json(rows.map(rowToApi));
  } catch (e) {
    sendError(res, '[GET /api/databases/:id/rows]', e);
  }
});

app.post('/api/databases/:id/rows', async (req, res) => {
  if (!assertSafeId(req.params.id, res)) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;
  if (!catalystAvailable) { res.status(503).json({ error: 'datastore_unavailable' }); return; }

  const parsed = parseRowBody((req.body ?? {}) as Record<string, unknown>);
  if (!parsed.ok) { sendDbErrors(res, parsed.errors); return; }

  try {
    const catalyst = initCatalyst(req) as unknown as NotificationApp;
    const database = await getDatabase(catalyst, ownerId, req.params.id);
    if (!database) { res.status(404).json({ error: 'Not found' }); return; }

    const existing = await listRows(catalyst, ownerId, database.id);
    const now = Date.now();
    const record: DatabaseRow = {
      ...parsed.value,
      id: randomUUID(),
      ownerId,
      databaseId: database.id,
      rowOrder: parsed.value.rowOrder ?? existing.reduce((m, r) => Math.max(m, r.rowOrder), -1) + 1,
      createdAt: now,
      updatedAt: now,
    };
    await insertRow(catalyst, record);
    res.status(201).json(rowToApi(record));
  } catch (e) {
    sendError(res, '[POST /api/databases/:id/rows]', e);
  }
});

app.put('/api/databases/rows/:rowId', async (req, res) => {
  if (!assertSafeId(req.params.rowId, res)) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;
  if (!catalystAvailable) { res.status(503).json({ error: 'datastore_unavailable' }); return; }

  const parsed = parseRowBody((req.body ?? {}) as Record<string, unknown>);
  if (!parsed.ok) { sendDbErrors(res, parsed.errors); return; }

  try {
    const catalyst = initCatalyst(req) as unknown as NotificationApp;
    const existing = await getRow(catalyst, ownerId, req.params.rowId);
    if (!existing) { res.status(404).json({ error: 'Not found' }); return; }

    const updated: DatabaseRow = {
      ...existing,
      ...parsed.value,
      id: existing.id,
      ownerId,
      // A record stays in the database it was made in; its field values live
      // under that database's fields.
      databaseId: existing.databaseId,
      rowOrder: parsed.value.rowOrder ?? existing.rowOrder,
      updatedAt: Date.now(),
    };
    await updateRow(catalyst, existing.rowId, updated);
    res.json(rowToApi(updated));
  } catch (e) {
    sendError(res, '[PUT /api/databases/rows/:rowId]', e);
  }
});

app.delete('/api/databases/rows/:rowId', async (req, res) => {
  if (!assertSafeId(req.params.rowId, res)) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;
  if (!catalystAvailable) { res.status(503).json({ error: 'datastore_unavailable' }); return; }

  try {
    const catalyst = initCatalyst(req) as unknown as NotificationApp;
    const existing = await getRow(catalyst, ownerId, req.params.rowId);
    if (!existing) { res.status(404).json({ error: 'Not found' }); return; }

    // The record's field values go with it, as a deleted task's do.
    await deletePropsForTask(catalyst, ownerId, existing.id);
    await deleteRow(catalyst, existing.rowId);
    res.json({ ok: true });
  } catch (e) {
    sendError(res, '[DELETE /api/databases/rows/:rowId]', e);
  }
});

// ── Trial features ────────────────────────────────────────────────────────────

/** The app-wide switches, so the client can say when something is paused. */
app.get('/api/trial-features', async (req, res) => {
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;
  // The JSON-file fallback has no table of switches, and nothing to switch.
  if (!catalystAvailable) { res.json(ALL_ENABLED); return; }
  res.json(await trialFeatures.get(initCatalyst(req) as unknown as NotificationApp));
});

app.get('/api/views', async (req, res) => {
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;
  if (!catalystAvailable) { res.status(503).json({ error: 'datastore_unavailable' }); return; }
  await ensureViewDisplayColumn(req);

  try {
    const views = await listViews(initCatalyst(req) as unknown as NotificationApp, ownerId);
    res.json(views.map(viewToApi));
  } catch (e) {
    sendError(res, '[GET /api/views]', e);
  }
});

app.post('/api/views', async (req, res) => {
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;
  if (!catalystAvailable) { res.status(503).json({ error: 'datastore_unavailable' }); return; }

  const parsed = parseViewBody((req.body ?? {}) as Record<string, unknown>);
  if (!parsed.ok) { sendViewErrors(res, parsed.errors); return; }
  await ensureViewDisplayColumn(req);

  try {
    const catalyst = initCatalyst(req) as unknown as NotificationApp;
    const existing = await listViews(catalyst, ownerId);
    if (existing.length >= MAX_VIEWS) {
      sendViewErrors(res, { name: `you already have ${MAX_VIEWS} saved views; delete one first` });
      return;
    }

    const now = Date.now();
    const view: SavedView = {
      ...parsed.value,
      id: randomUUID(),
      ownerId,
      viewOrder: parsed.value.viewOrder ?? existing.reduce((m, v) => Math.max(m, v.viewOrder), -1) + 1,
      createdAt: now,
      updatedAt: now,
    };
    await insertView(catalyst, view);
    res.status(201).json(viewToApi(view));
  } catch (e) {
    sendError(res, '[POST /api/views]', e);
  }
});

app.put('/api/views/:id', async (req, res) => {
  if (!assertSafeId(req.params.id, res)) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;
  if (!catalystAvailable) { res.status(503).json({ error: 'datastore_unavailable' }); return; }

  const parsed = parseViewBody((req.body ?? {}) as Record<string, unknown>);
  if (!parsed.ok) { sendViewErrors(res, parsed.errors); return; }
  await ensureViewDisplayColumn(req);

  try {
    const catalyst = initCatalyst(req) as unknown as NotificationApp;
    const existing = await getView(catalyst, ownerId, req.params.id);
    if (!existing) { res.status(404).json({ error: 'Not found' }); return; }

    const updated: SavedView = {
      ...existing,
      ...parsed.value,
      id: existing.id,
      ownerId,
      viewOrder: parsed.value.viewOrder ?? existing.viewOrder,
      updatedAt: Date.now(),
    };
    await updateView(catalyst, existing.rowId, updated);
    res.json(viewToApi(updated));
  } catch (e) {
    sendError(res, '[PUT /api/views/:id]', e);
  }
});

app.delete('/api/views/:id', async (req, res) => {
  if (!assertSafeId(req.params.id, res)) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;
  if (!catalystAvailable) { res.status(503).json({ error: 'datastore_unavailable' }); return; }

  try {
    const catalyst = initCatalyst(req) as unknown as NotificationApp;
    const existing = await getView(catalyst, ownerId, req.params.id);
    if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
    await deleteView(catalyst, existing.rowId);
    res.sendStatus(204);
  } catch (e) {
    sendError(res, '[DELETE /api/views/:id]', e);
  }
});

// ── Custom task fields ───────────────────────────────────────────────────────
//
// A user's own fields (select, multi-select, number, date, checkbox, text) and
// each task's values. See server/fields.ts. Without Catalyst these answer 503;
// fields have no offline copy.

function sendFieldErrors(res: express.Response, errors: Record<string, string>): void {
  res.status(400).json({ error: 'validation_failed', message: 'One or more fields are invalid', fields: errors });
}

/**
 * Removes a deleted task's field values. The task is already gone, so a failure
 * here is logged rather than turned into an error for a delete that worked;
 * values for a task that no longer exists are never shown.
 */
async function removeTaskFieldValues(req: express.Request, ownerId: string, taskId: string): Promise<void> {
  try {
    await deletePropsForTask(initCatalyst(req) as unknown as NotificationApp, ownerId, taskId);
  } catch (e) {
    console.warn(`[kaizen] field values for deleted task ${taskId} not removed: ${describeError(e)}`);
  }
}

app.get('/api/fields', async (req, res) => {
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;
  if (!catalystAvailable) { res.status(503).json({ error: 'datastore_unavailable' }); return; }
  await ensureFieldsDatabaseColumn(req);

  const databaseId = String(req.query['databaseId'] ?? '');
  if (databaseId && !assertSafeId(databaseId, res)) return;

  try {
    const defs = await listDefs(initCatalyst(req) as unknown as NotificationApp, ownerId, databaseId);
    res.json(defs.map(defToApi));
  } catch (e) {
    sendError(res, '[GET /api/fields]', e);
  }
});

app.post('/api/fields', async (req, res) => {
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;
  if (!catalystAvailable) { res.status(503).json({ error: 'datastore_unavailable' }); return; }

  const parsed = parseFieldBody((req.body ?? {}) as Record<string, unknown>);
  if (!parsed.ok) { sendFieldErrors(res, parsed.errors); return; }
  await ensureFieldsDatabaseColumn(req);

  const databaseId = String((req.body as Record<string, unknown> | undefined)?.['databaseId'] ?? '');
  if (databaseId && !assertSafeId(databaseId, res)) return;

  try {
    const catalyst = initCatalyst(req) as unknown as NotificationApp;
    // The cap is per database, so one database's fields cannot use up another's.
    const existing = await listDefs(catalyst, ownerId, databaseId);
    if (existing.length >= MAX_FIELDS) {
      sendFieldErrors(res, { name: `you already have ${MAX_FIELDS} fields; delete one first` });
      return;
    }
    const now = Date.now();
    const def: FieldDef = {
      ...parsed.value,
      id: randomUUID(),
      ownerId,
      databaseId,
      fieldOrder: parsed.value.fieldOrder ?? existing.reduce((m, d) => Math.max(m, d.fieldOrder), -1) + 1,
      createdAt: now,
      updatedAt: now,
    };
    await insertDef(catalyst, def);
    res.status(201).json(defToApi(def));
  } catch (e) {
    sendError(res, '[POST /api/fields]', e);
  }
});

app.put('/api/fields/:id', async (req, res) => {
  if (!assertSafeId(req.params.id, res)) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;
  if (!catalystAvailable) { res.status(503).json({ error: 'datastore_unavailable' }); return; }

  await ensureFieldsDatabaseColumn(req);

  try {
    const catalyst = initCatalyst(req) as unknown as NotificationApp;
    const existing = await getDef(catalyst, ownerId, req.params.id);
    if (!existing) { res.status(404).json({ error: 'Not found' }); return; }

    const parsed = parseFieldBody((req.body ?? {}) as Record<string, unknown>, existing);
    if (!parsed.ok) { sendFieldErrors(res, parsed.errors); return; }

    const updated: FieldDef = {
      ...existing,
      ...parsed.value,
      id: existing.id,
      ownerId,
      // A field belongs to whatever it was created in; moving one would leave
      // its values behind in a database that no longer has the field.
      databaseId: existing.databaseId,
      fieldOrder: parsed.value.fieldOrder ?? existing.fieldOrder,
      updatedAt: Date.now(),
    };
    await updateDef(catalyst, existing.rowId, updated);
    res.json(defToApi(updated));
  } catch (e) {
    sendError(res, '[PUT /api/fields/:id]', e);
  }
});

app.delete('/api/fields/:id', async (req, res) => {
  if (!assertSafeId(req.params.id, res)) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;
  if (!catalystAvailable) { res.status(503).json({ error: 'datastore_unavailable' }); return; }

  await ensureFieldsDatabaseColumn(req);

  try {
    const catalyst = initCatalyst(req) as unknown as NotificationApp;
    const existing = await getDef(catalyst, ownerId, req.params.id);
    if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
    // Values first: if this stops half-way the field still exists and still
    // shows its remaining values, rather than leaving values with no field.
    await deletePropsForDef(catalyst, ownerId, existing.id);
    await deleteDefRow(catalyst, existing.rowId);
    res.sendStatus(204);
  } catch (e) {
    sendError(res, '[DELETE /api/fields/:id]', e);
  }
});

app.get('/api/field-values', async (req, res) => {
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;
  if (!catalystAvailable) { res.status(503).json({ error: 'datastore_unavailable' }); return; }

  try {
    const catalyst = initCatalyst(req) as unknown as NotificationApp;
    const [defs, props] = await Promise.all([listDefs(catalyst, ownerId), listProps(catalyst, ownerId)]);
    const byId = new Map(defs.map((d) => [d.id, d]));
    const out: Array<{ taskId: string; fieldId: string; value: unknown }> = [];
    for (const prop of props) {
      const def = byId.get(prop.defId);
      if (!def) continue;
      const value = decodeValue(def, prop.valueText);
      if (value !== null) out.push({ taskId: prop.taskId, fieldId: def.id, value });
    }
    res.json(out);
  } catch (e) {
    sendError(res, '[GET /api/field-values]', e);
  }
});

app.put('/api/tasks/:id/fields/:fieldId', async (req, res) => {
  if (!assertSafeId(req.params.id, res)) return;
  if (!assertSafeId(req.params.fieldId, res, 'fieldId')) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;
  if (!catalystAvailable) { res.status(503).json({ error: 'datastore_unavailable' }); return; }

  try {
    const catalyst = initCatalyst(req) as unknown as NotificationApp;
    const def = await getDef(catalyst, ownerId, req.params.fieldId);
    if (!def) { res.status(404).json({ error: 'Not found', message: 'No such field' }); return; }

    // The task must be the caller's; reads the owner's tasks, as the other task routes do.
    const tasks = await catalystGetOwnerRows(req, getTasksTable(), 'OwnerId', ownerId, rowToTask);
    if (!tasks.some((t) => t.id === req.params.id)) {
      res.status(404).json({ error: 'Not found', message: 'No such task' });
      return;
    }

    const encoded = encodeValue(def, (req.body ?? {})['value']);
    if (!encoded.ok) { sendFieldErrors(res, { value: encoded.error }); return; }

    await setProp(catalyst, ownerId, req.params.id, def.id, encoded.text);
    res.json({
      taskId: req.params.id,
      fieldId: def.id,
      value: encoded.text === null ? null : decodeValue(def, encoded.text),
    });
  } catch (e) {
    sendError(res, '[PUT /api/tasks/:id/fields/:fieldId]', e);
  }
});

// ── Automation runs ──────────────────────────────────────────────────────────
//
// The audit trail. `useAutomationRuns` has been polling
// /api/automation-runs/recent every 30 seconds against a server with no such
// route; this is the endpoint it was written for.

app.get('/api/automation-runs/recent', async (req, res) => {
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;
  if (!catalystAvailable) { res.json([]); return; }

  const limit = Number(req.query['limit'] ?? 20);
  try {
    const runs = await listRuns(
      initCatalyst(req) as unknown as NotificationApp,
      ownerId,
      Number.isFinite(limit) ? limit : 20,
    );
    res.json(runs);
  } catch (e) {
    sendError(res, '[GET /api/automation-runs/recent]', e);
  }
});

/**
 * POST /api/automation-runs/trigger/:id — the "Run now" button.
 *
 * Enqueues the rule's notification for immediate delivery without touching its
 * schedule: running a rule by hand should not skip or shift its next scheduled
 * firing.
 *
 * The DedupeKey is built from the current instant rather than from the rule's
 * NextTriggerAt, which is what keeps a manual run from colliding with the
 * scheduled one — and what makes pressing the button twice produce two
 * notifications, which is what pressing it twice should do.
 */
app.post('/api/automation-runs/trigger/:id', async (req, res) => {
  if (!assertSafeId(req.params.id, res)) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;
  if (!catalystAvailable) { res.status(503).json({ error: 'datastore_unavailable' }); return; }
  await ensureRuleStepsColumn(req);

  try {
    const catalyst = initCatalyst(req) as unknown as NotificationApp;
    if (!(await trialFeatures.get(catalyst)).automations) {
      res.status(409).json({ error: 'feature_paused', message: 'Automations are paused' });
      return;
    }
    const rule = await getRule(catalyst, ownerId, req.params.id);
    if (!rule) { res.status(404).json({ error: 'Not found' }); return; }

    const now = Date.now();
    const { title, body } = renderRule(rule);
    const channels = channelsFor(rule);

    await enqueue(catalyst, {
      ownerId,
      fireAt: now,
      dedupeKey: `rule:${rule.id}:manual:${now}`,
      kind: rule.triggerType === 'daily-digest' ? 'DIGEST' : 'AUTOMATION',
      sourceType: 'RULE',
      sourceId: rule.id,
      channels,
      title,
      body,
      payload: {
        email: (await getCurrentIdentity(req)).email,
        ruleId: rule.id,
        urgency: rule.urgency,
        ...(rule.taskId ? { taskId: rule.taskId } : {}),
      },
    });

    await recordRun(catalyst, {
      ownerId, ruleId: rule.id, ruleName: rule.name, triggeredAt: now,
      status: 'SUCCESS', source: 'manual',
      detail: 'queued by hand; delivers on the next sweep',
      channels,
    });

    // Delivery happens on the next sweep, not here: a manual run goes through
    // exactly the same claim-and-deliver path as a scheduled one, so it cannot
    // become a second way for a notification to be sent.
    res.status(202).json({
      id: randomUUID(),
      ruleId: rule.id,
      ruleName: rule.name,
      triggeredAt: now,
      status: 'SUCCESS',
      source: 'manual',
      detail: 'queued by hand; delivers on the next sweep',
      channels,
    });
  } catch (e) {
    sendError(res, '[POST /api/automation-runs/trigger/:id]', e);
  }
});

app.get('/api/automation-runs/rule/:id', async (req, res) => {
  if (!assertSafeId(req.params.id, res)) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;
  if (!catalystAvailable) { res.json([]); return; }

  try {
    const runs = await listRunsForRule(
      initCatalyst(req) as unknown as NotificationApp, ownerId, req.params.id,
    );
    res.json(runs);
  } catch (e) {
    sendError(res, '[GET /api/automation-runs/rule/:id]', e);
  }
});

// ── In-app inbox ──────────────────────────────────────────────────────────────
//
// What the bell reads. Rows arrive only from the `inapp` delivery channel, so
// every entry here corresponds to something that was scheduled and actually
// fired — unlike the localStorage records these replace, which were recomputed
// from the task list on every poll and so could show a notification for
// something that had never been delivered.

/** GET /api/notifications — newest first. */
app.get('/api/notifications', async (req, res) => {
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;

  if (!catalystAvailable) { res.json([]); return; }

  try {
    res.json(await listInbox(initCatalyst(req) as unknown as NotificationApp, ownerId));
  } catch (e) {
    sendError(res, '[GET /api/notifications]', e);
  }
});

/** PATCH /api/notifications/:id/read */
app.patch('/api/notifications/:id/read', async (req, res) => {
  if (!assertSafeId(req.params.id, res)) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;

  if (!catalystAvailable) { res.status(404).json({ error: 'Not found' }); return; }

  try {
    const ok = await markRead(
      initCatalyst(req) as unknown as NotificationApp, ownerId, req.params.id,
    );
    // A 404 covers both "no such id" and "not yours" — telling the two apart
    // would confirm to a caller that someone else's notification exists.
    if (!ok) { res.status(404).json({ error: 'Not found' }); return; }
    res.sendStatus(204);
  } catch (e) {
    sendError(res, '[PATCH /api/notifications/:id/read]', e);
  }
});

/** PATCH /api/notifications/read-all */
app.patch('/api/notifications/read-all', async (req, res) => {
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;

  if (!catalystAvailable) { res.json({ updated: 0 }); return; }

  try {
    const updated = await markAllRead(
      initCatalyst(req) as unknown as NotificationApp, ownerId,
    );
    res.json({ updated });
  } catch (e) {
    sendError(res, '[PATCH /api/notifications/read-all]', e);
  }
});

/** DELETE /api/notifications/:id — dismiss for good. */
app.delete('/api/notifications/:id', async (req, res) => {
  if (!assertSafeId(req.params.id, res)) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;

  if (!catalystAvailable) { res.sendStatus(204); return; }

  try {
    const ok = await removeEntry(
      initCatalyst(req) as unknown as NotificationApp, ownerId, req.params.id,
    );
    if (!ok) { res.status(404).json({ error: 'Not found' }); return; }
    res.sendStatus(204);
  } catch (e) {
    sendError(res, '[DELETE /api/notifications/:id]', e);
  }
});

// ── Reminder scheduling ───────────────────────────────────────────────────────
//
// Every task write keeps the delivery queue in step. See
// server/notifications/reminders.ts for why this is safe to call
// unconditionally, and why it never throws.

/**
 * Keeps a task's queued reminder in line with the task.
 *
 * Awaited before the response goes out, rather than left running behind it.
 * That costs a round trip on writes, and buys determinism: a user who sets a
 * reminder and immediately closes the tab has it queued, and the log lines for
 * two quick edits cannot interleave. It cannot fail the write — every path in
 * reminders.ts reports rather than throws.
 */
async function syncReminderFor(
  req: express.Request,
  ownerId: string,
  task: DbTask,
  previousStatus?: string,
): Promise<void> {
  if (!catalystAvailable) return;  // the JSON-file fallback has no queue

  const catalyst = initCatalyst(req) as unknown as NotificationApp;
  const email = (await getCurrentIdentity(req)).email;
  const timeZone = resolveTimeZone(req.headers['x-timezone']);

  const ctx: ReminderContext = { ownerId, email, timeZone };
  const schedulable = {
    id: task.id,
    title: task.title,
    status: task.status,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    reminderEnabled: task.reminderEnabled,
    reminderMinutesBefore: task.reminderMinutesBefore,
  };

  // The task's own reminder, set on the task itself.
  const result = await syncTaskReminder(catalyst, ctx, schedulable);

  // Only the interesting outcomes reach the log. "nothing to schedule" is the
  // common case and would drown everything else.
  if (result.error) console.warn(`[kaizen] reminder ${task.id}: ${result.detail}`);
  else if (result.enqueued || result.cancelled > 0) {
    console.log(`[kaizen] reminder ${task.id}: ${result.detail}`);
  }

  // The owner's automation rules that hang off a task rather than a clock:
  // due-date, overdue, and status-change. These cannot be found by
  // NextTriggerAt, so the write path is the only place they can be evaluated.
  await ensureRuleStepsColumn(req);
  const rules = await syncTaskRules(
    catalyst, { ownerId, timeZone, email, previousStatus }, schedulable,
  );
  if (rules.error) console.warn(`[kaizen] task rules ${task.id}: ${rules.error}`);
  else if (rules.enqueued > 0 || rules.cancelled > 0) {
    console.log(
      `[kaizen] task rules ${task.id}: queued ${rules.enqueued}, withdrew ${rules.cancelled}`,
    );
    for (const line of rules.details) console.log(`[kaizen]   ${line}`);
  }
}

/** Withdraws everything a deleted task had queued — its reminder and its rules. */
async function cancelRemindersFor(
  req: express.Request, ownerId: string, taskId: string,
): Promise<void> {
  if (!catalystAvailable) return;

  const catalyst = initCatalyst(req) as unknown as NotificationApp;

  const result = await cancelTaskReminders(catalyst, taskId);
  if (result.error) console.warn(`[kaizen] reminder ${taskId}: ${result.detail}`);
  else if (result.cancelled > 0) console.log(`[kaizen] reminder ${taskId}: ${result.detail}`);

  const rules = await cancelTaskRules(catalyst, ownerId, taskId);
  if (rules > 0) console.log(`[kaizen] task rules ${taskId}: withdrew ${rules}`);
}

/**
 * Queues reminders for tasks that predate the queue.
 *
 * Scoped to the caller, and deliberately so. The sweep runs as the cron with
 * no user session, so it has neither a delivery address nor a timezone for
 * anyone — both of which arrive on a signed-in request for free. Enumerating
 * every user to find them would be a larger and more fragile piece of
 * machinery than letting each user's own client ask once.
 *
 * Idempotent: every task re-derives the DedupeKey it would have had all along,
 * so a second call enqueues nothing. That makes it safe for the client to
 * call on sign-in rather than having to remember whether it already did.
 */
app.post('/api/reminders/backfill', async (req, res) => {
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;

  if (!catalystAvailable) {
    res.json({ scanned: 0, enqueued: 0, failed: 0, skipped: 'no Catalyst backend' });
    return;
  }

  try {
    const tasks = await catalystGetOwnerRows(req, getTasksTable(), 'OwnerId', ownerId, rowToTask);

    const ctx: ReminderContext = {
      ownerId,
      email: (await getCurrentIdentity(req)).email,
      timeZone: resolveTimeZone(req.headers['x-timezone']),
    };

    const catalyst = initCatalyst(req) as unknown as NotificationApp;
    const schedulable = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      dueDate: t.dueDate,
      dueTime: t.dueTime,
      reminderEnabled: t.reminderEnabled,
      reminderMinutesBefore: t.reminderMinutesBefore,
    }));

    const out = await backfillReminders(catalyst, ctx, schedulable);

    await ensureRuleStepsColumn(req);

    // The owner's task-driven rules, against the tasks that already exist. A
    // rule is otherwise only evaluated when a task is written, so one created
    // today would reach nothing until each task happened to be edited.
    const rules = await backfillTaskRules(
      catalyst, { ownerId, timeZone: ctx.timeZone, email: ctx.email }, schedulable,
    );
    if (rules.error) console.warn(`[kaizen] rule backfill for ${ownerId}: ${rules.error}`);
    else if (rules.enqueued > 0) {
      console.log(`[kaizen] rule backfill for ${ownerId}: queued ${rules.enqueued}`);
      for (const line of rules.details) console.log(`[kaizen]   ${line}`);
    }

    if (out.enqueued > 0 || out.failed > 0) {
      console.log(
        `[kaizen] backfill for ${ownerId}: scanned=${out.scanned} ` +
        `enqueued=${out.enqueued} failed=${out.failed}`,
      );
      for (const line of out.details) console.warn(`[kaizen]   ${line}`);
    }

    res.json({
      scanned: out.scanned,
      enqueued: out.enqueued,
      failed: out.failed,
      ruleFirings: rules.enqueued,
    });
  } catch (e) {
    sendError(res, '[POST /api/reminders/backfill]', e);
  }
});

// ── Scheduled sweep ───────────────────────────────────────────────────────────
//
// Called by a Catalyst cron every few minutes; see
// docs/catalyst/12-scheduling-and-delivery.md for the cron definition.
//
// Why an external cron rather than an interval inside this process: AppSail
// auto-scales to 1–5 instances, so a setInterval would run on every one of them
// and fire each reminder up to five times. A cron calling one endpoint is
// single-writer by construction. The queue's claim still guards against a
// retried or overlapping tick.

/** Shared secret for the tick endpoint. */
function tickSecret(): string {
  return (process.env['TICK_SECRET'] ?? '').trim();
}

/**
 * Runs one sweep.
 *
 * Not under the normal owner-scoping middleware: the caller is Catalyst's cron,
 * not a signed-in user, and it sweeps across all owners. It is protected by a
 * shared secret instead — and refuses to run at all when that secret is unset,
 * rather than defaulting to open. An endpoint that delivers notifications for
 * every user is not one to leave unauthenticated by accident.
 */
app.post('/api/internal/tick', async (req, res) => {
  const secret = tickSecret();
  if (!secret) {
    console.error('[kaizen] /api/internal/tick refused: TICK_SECRET is not set');
    res.status(503).json({
      error: 'not_configured',
      message: 'TICK_SECRET is not set, so the sweep endpoint is disabled',
    });
    return;
  }

  const presented = String(req.headers['x-tick-secret'] ?? '');
  // Length-independent comparison; the secret is short and the endpoint is
  // remote, but there is no reason to leak timing.
  if (presented.length !== secret.length || !timingSafeEqual(presented, secret)) {
    res.status(401).json({ error: 'unauthenticated', message: 'Invalid tick secret' });
    return;
  }

  if (!catalystAvailable) {
    // The JSON-file fallback has no queue; say so rather than silently
    // reporting a successful sweep that did nothing.
    res.status(503).json({
      error: 'datastore_unavailable',
      message: 'The sweep requires the Catalyst backend',
    });
    return;
  }

  try {
    const catalyst = initCatalyst(req) as unknown as NotificationApp;
    const sweepOptions = sweepOptionsFor(await syncTrialFeatures(catalyst));
    if (!sweepOptions) {
      res.json({ ok: true, paused: true, reason: 'notifications are switched off in KaizenTrialFeatures' });
      return;
    }
    const report = await runSweep(catalyst, sweepOptions);

    if (report.due > 0 || report.failed > 0) {
      console.log(`[kaizen] sweep ${describeSweep(report)}`);
      for (const line of report.details) console.log(`[kaizen]   ${line}`);
    }

    res.json({
      ok: true,
      due: report.due,
      delivered: report.delivered,
      failed: report.failed,
      discarded: report.discarded,
      reclaimed: report.reclaimed,
      purged: report.purged,
      durationMs: report.durationMs,
    });
  } catch (e) {
    sendError(res, '[POST /api/internal/tick]', e);
  }
});

/** Constant-time string comparison. */
function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

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

  for (const { name } of SCHEMA) {
    try {
      await app2.zcql().executeZCQLQuery(`SELECT ROWID FROM ${name} LIMIT 1`);
      tableStatus[name] = 'ok';
    } catch (e: unknown) {
      const msg = describeError(e);
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
      : 'Some tables are missing. Run `pnpm catalyst:setup` to create them.',
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
      tasks = readTasksDb().tasks;
      tasks = tasks.filter((t) => t.ownerId === ownerId);
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
      tasks = readTasksDb().tasks;
      tasks = tasks.filter((t) => t.ownerId === ownerId);
    }

    // The user's calendar day, not the server's — production runs in UTC.
    const zone = resolveTimeZone(req.headers['x-timezone']);
    const todayKey = dayKeyInZone(Date.now(), zone);
    const isToday = (ts: number) => dayKeyInZone(ts, zone) === todayKey;

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
      task = readTasksDb().tasks
        .find((t) => t.id === req.params.id && t.ownerId === ownerId);
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

  const body = (req.body ?? {}) as Record<string, unknown>;
  const errs = new FieldErrors();

  const title = reqString(errs, 'title', body['title'], MAX_TITLE_LEN);
  const fields = {
    status:                optEnum(errs, 'status', body['status'], TASK_STATUSES, 'TODO'),
    quadrant:              optEnum(errs, 'quadrant', body['quadrant'], QUADRANTS, 'SCHEDULE'),
    priority:              optEnum(errs, 'priority', body['priority'], PRIORITIES, ''),
    note:                  optString(errs, 'note', body['note'], MAX_NOTE_LEN),
    dueDate:               optDate(errs, 'dueDate', body['dueDate']),
    dueTime:               optTime(errs, 'dueTime', body['dueTime']),
    category:              optString(errs, 'category', body['category'], MAX_CATEGORY_LEN),
    listId:                optString(errs, 'listId', body['listId'], 64),
    taskOrder:             optNumber(errs, 'taskOrder', body['taskOrder'], 0),
    reminderEnabled:       optBoolean(errs, 'reminderEnabled', body['reminderEnabled'], false),
    reminderMinutesBefore: optNumber(errs, 'reminderMinutesBefore', body['reminderMinutesBefore'], 0, 0),
    sourceNoteId:          optSafeId(errs, 'sourceNoteId', body['sourceNoteId']),
    sourceBlockId:         optSafeId(errs, 'sourceBlockId', body['sourceBlockId']),
  };

  if (!errs.ok || title === undefined) { errs.send(res); return; }

  const now = Date.now();
  const task: DbTask = {
    id:          randomUUID(),
    ownerId,
    title,
    ...fields,
    // completedAt is set by the server when a task is completed, never by the
    // client — accepting it here let a caller forge the momentum/streak stats.
    completedAt: 0,
    createdAt:   now,
    updatedAt:   now,
  };

  try {
    if (catalystAvailable) {
      // An insert reads no rows first, so check the columns here or the link
      // would be dropped from a task created before any read.
      await ensureTaskLinkColumns(req);
      await catalystInsertRow(req, getTasksTable(), taskToRow(task));
      await syncReminderFor(req, ownerId, task);
      res.status(201).json(dbTaskToApi(task));
    } else {
      const db = readTasksDb();
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

  const errs = new FieldErrors();
  const body = parseTaskPatch((req.body ?? {}) as Record<string, unknown>, errs);
  if (!errs.ok) { errs.send(res); return; }
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
      await syncReminderFor(req, ownerId, updated, existing.status);
      res.json(dbTaskToApi(updated));
    } else {
      const db = readTasksDb();
      const idx = db.tasks.findIndex((t) => t.id === req.params.id && t.ownerId === ownerId);
      if (idx < 0) { res.status(404).json({ error: 'Not found' }); return; }
      const updated: DbTask = { ...db.tasks[idx], ...body, id: req.params.id, ownerId, updatedAt: now };
      db.tasks[idx] = updated;
      writeJson(TASKS_DB_PATH, db);
      res.json(dbTaskToApi(updated));
    }
  } catch (e) {
    sendError(res, '[PUT /api/tasks/:id]', e);
  }
});

/**
 * CompletedAt after a status change. Leaving DONE — an undo — clears it, so an
 * undone task drops out of today's history and the streak; entering DONE
 * stamps it once. It used to be left untouched, so an undone task kept a
 * completion time.
 */
function completedAtFor(existing: DbTask, status: string, now: number): number {
  if (status !== 'DONE') return 0;
  return existing.completedAt || now;
}

// PATCH /api/tasks/:id/status
app.patch('/api/tasks/:id/status', async (req, res) => {
  if (!assertSafeId(req.params.id, res)) return;
  const ownerId = await resolveOwner(req, res);
  if (!ownerId) return;

  const errs = new FieldErrors();
  const status = optEnum(errs, 'status', (req.body ?? {})['status'], TASK_STATUSES, '');
  if (!status) errs.add('status', 'is required');
  if (!errs.ok) { errs.send(res); return; }
  const now = Date.now();

  try {
    if (catalystAvailable) {
      const rowId = await catalystGetRowId(req, getTasksTable(), 'TaskId', req.params.id);
      if (!rowId) { res.status(404).json({ error: 'Not found' }); return; }
      const all = await catalystGetOwnerRows(req, getTasksTable(), 'OwnerId', ownerId, rowToTask);
      const existing = all.find((t) => t.id === req.params.id);
      if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
      const updated: DbTask = { ...existing, status, completedAt: completedAtFor(existing, status, now), updatedAt: now };
      await catalystUpdateRow(req, getTasksTable(), rowId, taskToRow(updated));
      await syncReminderFor(req, ownerId, updated, existing.status);
      res.json(dbTaskToApi(updated));
    } else {
      const db = readTasksDb();
      const idx = db.tasks.findIndex((t) => t.id === req.params.id && t.ownerId === ownerId);
      if (idx < 0) { res.status(404).json({ error: 'Not found' }); return; }
      const existing = db.tasks[idx];
      db.tasks[idx] = { ...existing, status, completedAt: completedAtFor(existing, status, now), updatedAt: now };
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
      // Completion withdraws the reminder; syncTaskReminder reaches that via
      // status === 'DONE', so there is one code path deciding what is due.
      await syncReminderFor(req, ownerId, updated, existing.status);
      res.json(dbTaskToApi(updated));
    } else {
      const db = readTasksDb();
      const idx = db.tasks.findIndex((t) => t.id === req.params.id && t.ownerId === ownerId);
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

  const errs = new FieldErrors();
  const quadrant = optEnum(errs, 'quadrant', (req.body ?? {})['quadrant'], QUADRANTS, '');
  if (!quadrant) errs.add('quadrant', 'is required');
  if (!errs.ok) { errs.send(res); return; }
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
      const db = readTasksDb();
      const idx = db.tasks.findIndex((t) => t.id === req.params.id && t.ownerId === ownerId);
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
      if (!task) { res.status(404).json({ error: 'Not found' }); return; }
      const rowId = await catalystGetRowId(req, getTasksTable(), 'TaskId', req.params.id);
      if (!rowId) { res.status(404).json({ error: 'Not found' }); return; }
      await catalystDeleteRow(req, getTasksTable(), rowId);
      await cancelRemindersFor(req, ownerId, req.params.id);
      await removeTaskFieldValues(req, ownerId, req.params.id);
      res.sendStatus(204);
    } else {
      const db = readTasksDb();
      const before = db.tasks.length;
      db.tasks = db.tasks.filter((t) => !(t.id === req.params.id && t.ownerId === ownerId));
      if (db.tasks.length === before) { res.status(404).json({ error: 'Not found' }); return; }
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
      lists = readListsDb().lists;
      lists = lists.filter((l) => l.ownerId === ownerId);
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
      list = readListsDb().lists
        .find((l) => l.id === req.params.id && l.ownerId === ownerId);
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

  const body = (req.body ?? {}) as Record<string, unknown>;
  const errs = new FieldErrors();
  const name = reqString(errs, 'name', body['name'], MAX_TITLE_LEN);
  const color = optString(errs, 'color', body['color'], 32, 'emerald');
  const listOrder = optNumber(errs, 'listOrder', body['listOrder'], 0);
  if (!errs.ok || name === undefined) { errs.send(res); return; }

  const now = Date.now();
  const list: DbList = {
    id:        randomUUID(),
    ownerId,
    name,
    color,
    listOrder,
    createdAt: now,
    updatedAt: now,
  };

  try {
    if (catalystAvailable) {
      await catalystInsertRow(req, LISTS_TABLE, listToRow(list));
      res.status(201).json(dbListToApi(list));
    } else {
      const db = readListsDb();
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

  const errs = new FieldErrors();
  const body = parseListPatch((req.body ?? {}) as Record<string, unknown>, errs);
  if (!errs.ok) { errs.send(res); return; }
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
      const db = readListsDb();
      const idx = db.lists.findIndex((l) => l.id === req.params.id && l.ownerId === ownerId);
      if (idx < 0) { res.status(404).json({ error: 'Not found' }); return; }
      const updated: DbList = { ...db.lists[idx], ...body, id: req.params.id, ownerId, updatedAt: now };
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
      if (!list) { res.status(404).json({ error: 'Not found' }); return; }
      {
        const rowId = await catalystGetRowId(req, LISTS_TABLE, 'ListId', req.params.id);
        if (rowId) await catalystDeleteRow(req, LISTS_TABLE, rowId);
        // Also delete tasks belonging to this list (owner-scoped)
        const tasks = await catalystGetOwnerRows(req, getTasksTable(), 'OwnerId', ownerId, rowToTask);
        const toDelete = tasks.filter((t) => t.listId === req.params.id);
        await Promise.all(toDelete.map(async (t) => {
          const rid = await catalystGetRowId(req, getTasksTable(), 'TaskId', t.id);
          if (rid) await catalystDeleteRow(req, getTasksTable(), rid);
          await removeTaskFieldValues(req, ownerId, t.id);
        }));
      }
      res.sendStatus(204);
    } else {
      const db = readListsDb();
      const before = db.lists.length;
      db.lists = db.lists.filter((l) => !(l.id === req.params.id && l.ownerId === ownerId));
      if (db.lists.length === before) { res.status(404).json({ error: 'Not found' }); return; }
      writeJson(LISTS_DB_PATH, db);
      // Also remove tasks for this list (owner-scoped)
      const tdb = readTasksDb();
      tdb.tasks = tdb.tasks.filter((t) => !(t.listId === req.params.id && t.ownerId === ownerId));
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
      tasks = readTasksDb().tasks;
      tasks = tasks.filter((t) => t.ownerId === ownerId);
    }

    const { listId } = req.query as Record<string, string>;
    if (listId) tasks = tasks.filter((t) => t.listId === listId);

    const doneTasks = tasks.filter((t) => t.status === 'DONE');
    // The user's calendar day, not the server's — production runs in UTC.
    const zone = resolveTimeZone(req.headers['x-timezone']);
    const todayKey = dayKeyInZone(Date.now(), zone);
    const isToday = (ts: number) => dayKeyInZone(ts, zone) === todayKey;

    const todayCompleted = doneTasks.filter((t) => t.completedAt && isToday(t.completedAt)).length;
    const totalCompleted = doneTasks.length;

    // Streak: consecutive days with a completion, in the user's zone.
    const streak = streakDays(doneTasks.map((t) => t.completedAt), zone, Date.now());

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

/**
 * A note's blocks are one Catalyst Text column, which holds 10,000 characters.
 * Nothing checked that: an oversized note reached the datastore, failed with an
 * unnamed 400, and the client retried the same payload forever. Rejecting it
 * here names the field, and notesSyncService stops retrying a rejected note.
 */
const MAX_NOTE_BLOCKS_LEN = 10_000;

function assertNoteFits(body: Partial<DbNote>, res: express.Response): boolean {
  if (typeof body.blocksJson !== 'string' || body.blocksJson.length <= MAX_NOTE_BLOCKS_LEN) return true;
  const errs = new FieldErrors();
  errs.add(
    'blocksJson',
    `is ${body.blocksJson.length} characters; a note can hold at most ${MAX_NOTE_BLOCKS_LEN}`,
  );
  errs.send(res);
  return false;
}

/** Reads the owner's notes from the JSON-file store. */
function readOwnedNotes(ownerId: string): DbNote[] {
  return readNotesDb().notes.filter((n) => noteOwner(n) === ownerId);
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
  if (!assertNoteFits(body, res)) return;

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
      const db = readNotesDb();
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
  if (!assertNoteFits(body, res)) return;

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
      const db = readNotesDb();
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
      if (!found) { res.status(404).json({ error: 'Not found' }); return; }
      await catalystDeleteRow(req, NOTES_TABLE, found.rowId);
      res.sendStatus(204);
    } else {
      const db = readNotesDb();
      const before = db.notes.length;
      db.notes = db.notes.filter((n) => !(n.id === req.params.id && noteOwner(n) === ownerId));
      if (db.notes.length === before) { res.status(404).json({ error: 'Not found' }); return; }
      writeJson(DB_PATH, db);
      res.sendStatus(204);
    }
  } catch (e) {
    sendError(res, '[DELETE /api/notes/:id]', e);
  }
});

// ── Catalyst Web SDK API ──────────────────────────────────────────────────────
//
// Must be registered before the SPA catch-all, which would otherwise answer
// these with index.html. See server/catalyst/baasProxy.ts for why the Web SDK
// addresses this server rather than Catalyst directly.
app.use('/baas', baasProxy());

// ── Unknown /api routes ───────────────────────────────────────────────────────
//
// This must come before the SPA fallback. Without it, GET /api/anything
// unmatched fell through to app.get('/{*path}') and was answered with
// dist/index.html — under the application/json Content-Type forced by the
// middleware at the top of the file. The client saw `200 application/json`
// whose body began `<!doctype html>`, and JSON.parse died on "Unexpected
// token '<'". That is exactly what the Automations page hit against
// /api/automation-runs/recent, and it presented as a permanent
// "Backend unavailable" banner rather than a 404.
app.use('/api', (req, res) => {
  res.status(404).json({
    error: 'not_found',
    message: `No API route for ${req.method} /api${req.path}`,
  });
});

// ── Static SPA serving ────────────────────────────────────────────────────────

/**
 * The built frontend, which the server serves from its own origin.
 *
 * Two layouts to satisfy:
 *   development  server/notes-server.ts  -> ../dist
 *   AppSail      server.js (bundled)     -> ./dist
 *
 * Hardcoding '../dist' meant the deployed bundle looked one level above the
 * app root, found nothing, skipped the static middleware entirely, and served
 * 404 for every non-API route.
 */
const DIST_DIR = [
  path.join(__dirname, '..', 'dist'),
  path.join(__dirname, 'dist'),
].find((dir) => fs.existsSync(path.join(dir, 'index.html')))
  ?? path.join(__dirname, '..', 'dist');

if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  // SPA fallback — must come AFTER the /api routes and the /api 404 above.
  app.get('/{*path}', (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

// ── Global error handler — always returns JSON ────────────────────────────────
//
// Express matches middleware in registration order, so an error handler only
// sees errors thrown by what was registered BEFORE it. This used to sit above
// the static/SPA middleware, which meant a failure in express.static or in
// res.sendFile (a missing dist/index.html, EACCES) bypassed it entirely and
// returned Express's default HTML stack-trace page. It must be registered last.
//
// It also catches express.json() parse errors and any rejection an async
// handler forwards, so the client always gets a JSON body.
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const shape = classifyError(err);
  // Trust an explicit HTTP status on the error (express.json sets 400) over
  // the classifier's guess.
  const explicit = (err as { status?: number; statusCode?: number })?.status
    ?? (err as { status?: number; statusCode?: number })?.statusCode;
  const status = typeof explicit === 'number' ? explicit : shape.status;

  console.error(`[kaizen] Unhandled error on ${req.method} ${req.path}:`, err);
  if (res.headersSent) return;
  res.status(status).json({
    error: status === 400 ? 'bad_request' : shape.error,
    message: status === 400 ? 'Malformed request body' : shape.message,
    ...(IS_PRODUCTION ? {} : { detail: err instanceof Error ? err.message : String(err) }),
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
//
// Port resolution, in order:
//   1. X_ZOHO_CATALYST_LISTEN_PORT — injected by Catalyst AppSail. This is the
//      variable AppSail actually sets; reading only PORT meant a deployed app
//      bound the wrong port and the platform health check never passed.
//   2. PORT                        — other hosts, and local overrides.
//   3. DEFAULT_PORT (9000)         — Catalyst's documented AppSail fallback.
//                                   Local dev pins PORT=3001 via package scripts.

function resolvePort(): number {
  for (const name of ['X_ZOHO_CATALYST_LISTEN_PORT', 'PORT']) {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === '') continue;
    const n = Number(raw);
    // parseInt() used to be applied straight to PORT, so a non-numeric value
    // produced NaN and listen() silently chose a random free port.
    if (!Number.isInteger(n) || n < 0 || n > 65535) {
      console.warn(`[kaizen] Ignoring ${name}="${raw}" — not a valid port. Falling back.`);
      continue;
    }
    return n;
  }
  return DEFAULT_PORT;
}

const LISTEN_PORT = resolvePort();

/**
 * Probes Catalyst and settles `catalystAvailable` BEFORE the socket opens.
 *
 * This used to run inside the app.listen callback, i.e. after the server was
 * already accepting connections. Two things went wrong in that window:
 *
 *   - catalystAvailable was true while useTestTable was still false, so early
 *     requests queried a table that often does not exist and got a 503.
 *   - If the probe then flipped catalystAvailable to false, a request that had
 *     already resolved its owner against Catalyst wrote that owner into the
 *     JSON store — where the LOCAL_DEV_OWNER filter would never match it
 *     again. The row was written and permanently invisible.
 *
 * Probing first costs a little startup latency and removes the window entirely.
 */
async function settleBackend(): Promise<void> {
  const activeSignals = Object.entries(CATALYST_ENV_SIGNALS)
    .filter(([, on]) => on)
    .map(([name]) => name);
  console.log(
    activeSignals.length
      ? `[kaizen] Catalyst credentials detected via: ${activeSignals.join(', ')}`
      : '[kaizen] No Catalyst credentials in env — using JSON-file storage'
  );

  // With no gateway headers and no standalone config, fall back to the CLI's
  // own login if someone has run `catalyst login` + `catalyst init` here. This
  // is what lets `pnpm dev` reach the real project with no secrets in the repo.
  // Under the Catalyst gateway (AppSail, Functions) the project credentials
  // arrive as per-request headers, so there is nothing for a startup probe to
  // authenticate with: it would fail, and the old code then disabled Catalyst
  // for the whole process — which is why the first successful deployment
  // reported "json-file" while running inside Catalyst.
  //
  // Trust the runtime instead and let each request initialise from its own
  // headers. Table problems surface as classified per-request errors rather
  // than a silent process-wide downgrade.
  if (catalystAvailable && !standaloneConfig && CATALYST_ENV_SIGNALS.X_ZOHO_CATALYST_LISTEN_PORT) {
    console.log('[kaizen] Catalyst gateway runtime detected — credentials arrive per request');
    lastCatalystMode = 'gateway';
    return;
  }

  if (!catalystAvailable) {
    const app = await getCliApp();
    if (app) {
      const project = cliProject();
      catalystAvailable = true;
      lastCatalystMode = 'cli';
      const r = region();
      console.log(
        `[kaizen] Using the Catalyst CLI login` +
        (project ? ` for project ${project.projectName} (${project.projectId})` : '') +
        ` — dc ${r.dataCentre}, ${r.consoleUrl}`
      );
    } else {
      return;
    }
  }

  try {
    // The SDK reads credentials from the platform env rather than the request
    // when running inside Catalyst, so a bare object is enough for the probe.
    const tablesOk = await probeCatalystTables({} as express.Request);
    if (tablesOk) {
      console.log('[kaizen] Catalyst DataStore tables verified');
      // Settle the after-launch columns here too, so the in-process sweep
      // knows about them before any request has arrived to probe them. Under
      // the gateway there are no credentials yet and this is a no-op; the
      // per-request probes cover that case.
      await ensureTaskLinkColumns({} as express.Request);
      await ensureRuleStepsColumn({} as express.Request);
      return;
    }
    console.warn('[kaizen] Catalyst DataStore tables unavailable — using JSON-file fallback.');
  } catch (e) {
    console.warn('[kaizen] Catalyst table probe failed — using JSON-file fallback:', e);
  }
  catalystAvailable = false;
}

// Bind the port first so the platform's health check succeeds, then settle the
// storage backend while the readiness gate above holds API requests.
const server = app.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`[kaizen] Server listening on http://0.0.0.0:${LISTEN_PORT}`);
  if (fs.existsSync(DIST_DIR)) console.log(`[kaizen] Serving SPA from ${DIST_DIR}`);
});

backendReady = settleBackend()
  .then(() => {
    console.log(`[kaizen] Backend: ${catalystAvailable ? 'Catalyst DataStore' : 'JSON file fallback'}`);
    bootSweepScheduler();
  })
  .catch((e) => {
    // Never leave the gate rejected: fall back to the JSON store rather than
    // refusing every request for the life of the process.
    console.error('[kaizen] Backend setup failed, using JSON-file storage:', e);
    catalystAvailable = false;
  });

/**
 * Starts the in-process sweep.
 *
 * Safe to run on every AppSail instance despite the auto-scaling: a sweep
 * claims each row before touching any channel, so of N concurrent sweeps
 * exactly one delivers. Concurrency costs a duplicate query, not a duplicate
 * notification — see server/notifications/scheduler.ts.
 *
 * It exists because Catalyst's crons could not be made to run every five
 * minutes; the hourly webhook cron remains as the backstop for a container
 * that has been idle long enough to be stopped.
 */
const trialFeatures = createTrialFeatureCache();
let sweepScheduler: Scheduler | null = null;
let sweepDisabledLogged = false;

/** Reads the switches (cached) and starts or stops the timer to match. */
async function syncTrialFeatures(app: NotificationApp): Promise<TrialFeatures> {
  const flags = await trialFeatures.get(app);
  if (flags.notifications) startSweepScheduler();
  else stopSweepScheduler();
  return flags;
}

/**
 * At startup the switches can only be read where background credentials exist
 * already. Under the gateway they arrive with the first request, and the
 * middleware above starts the timer then.
 */
function bootSweepScheduler(): void {
  if (!catalystAvailable) return;
  const app = backgroundCatalystApp(standaloneConfig);
  if (!app) {
    console.log('[kaizen] Sweep scheduler starts on the first request, once KaizenTrialFeatures can be read');
    return;
  }
  void syncTrialFeatures(app as unknown as NotificationApp).then((flags) => {
    if (!flags.notifications) {
      console.log('[kaizen] Notifications are switched off in KaizenTrialFeatures — sweep scheduler not started');
    }
  });
}

function startSweepScheduler(): void {
  if (sweepScheduler) return;            // already running
  if (!catalystAvailable) return;       // the JSON-file fallback has no queue
  if (!schedulerEnabled()) {
    if (!sweepDisabledLogged) console.log('[kaizen] Sweep scheduler disabled by SWEEP_DISABLED');
    sweepDisabledLogged = true;
    return;
  }

  sweepScheduler = startScheduler(() => {
    const app = backgroundCatalystApp(standaloneConfig);
    if (!app) {
      // Under the gateway this just means no request has arrived yet. The
      // tick is skipped and the next one tries again.
      throw new Error('no Catalyst credentials for background work yet');
    }
    return app as unknown as NotificationApp;
  }, {
    // Re-checks the switches every tick, so switching notifications off stops
    // the timer within one interval even if no request arrives.
    prepareTick: async (app) => sweepOptionsFor(await syncTrialFeatures(app as unknown as NotificationApp)),
    onError: (e) => {
      // Expected before the first request under the gateway; not worth a
      // warning every five minutes until then.
      const waiting = !hasBackgroundCredentials(standaloneConfig);
      if (!waiting) console.warn(`[kaizen] sweep failed: ${String(e)}`);
    },
  });

  console.log(`[kaizen] Sweep scheduler running every ${intervalFromEnv() / 1000}s`);
}

function stopSweepScheduler(): void {
  if (!sweepScheduler) return;
  sweepScheduler.stop();
  sweepScheduler = null;
  console.log('[kaizen] Sweep scheduler stopped: notifications are switched off in KaizenTrialFeatures');
}

// A rejected promise with no handler terminates the process on modern Node.
// Log it with context rather than dying silently mid-request.
process.on('unhandledRejection', (reason) => {
  console.error('[kaizen] Unhandled promise rejection:', reason);
});

// Graceful shutdown
function shutdown(signal: string): void {
  console.log(`[kaizen] ${signal} received, shutting down gracefully`);
  server.close(() => process.exit(0));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
