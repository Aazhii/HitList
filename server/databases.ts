/**
 * Databases: records that are not tasks.
 *
 * A database is a name and an icon; its records are rows with a title. Every
 * other column a record has is a custom field — the same KaizenPropDefs and
 * KaizenTaskProps that tasks use, with the field's DatabaseId saying which
 * database it belongs to ('' being the task fields). That reuse is the point:
 * field kinds, validation, filtering, grouping and the cell editors all work on
 * a database the day its tables exist.
 *
 * Tasks are deliberately NOT stored here. They keep their own table, their
 * reminders and their escalation; a database row has none of that, and the
 * Databases screen says so rather than pretending.
 *
 * Reads are paged from the start: ZCQL returns at most 300 rows, and a database
 * is the one thing here meant to grow past that.
 */
import type { CatalystApp } from './notifications/types.ts';
import { DATABASES_TABLE, DB_ROWS_TABLE } from './catalyst/schema.ts';
import { zcqlString, unwrapRows, str, num } from './notifications/zcql.ts';
import {
  DELETION_PENDING_UPDATED_AT, deletionLockKey, isDeletionPending, withDeletionLock, withDeletionLocks,
} from './deletion.ts';

export const MAX_DATABASES = 50;
export const MAX_NAME = 100;
export const MAX_TITLE = 255;
/** ZCQL's page size, and so ours. */
const PAGE = 300;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface KaizenDatabase {
  id: string;
  ownerId: string;
  name: string;
  icon: string;
  /**
   * Which of this database's date fields its calendar reads; '' = none chosen.
   * A record has no due date of its own, so the calendar has to be told.
   */
  dateFieldId: string;
  dbOrder: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Whether KaizenDatabases has DateFieldId. Added after the table existed, so
 * until `pnpm catalyst:setup` adds it a database simply has no calendar.
 */
let dateFieldAvailable = false;
export function setDatabaseDateFieldAvailable(available: boolean): void { dateFieldAvailable = available; }
export function databaseDateFieldAvailable(): boolean { return dateFieldAvailable; }

export interface DatabaseRow {
  id: string;
  ownerId: string;
  databaseId: string;
  title: string;
  rowOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface DatabaseWithRowId extends KaizenDatabase { rowId: string }
export interface RecordWithRowId extends DatabaseRow { rowId: string }

// ── Validation ────────────────────────────────────────────────────────────────

export interface DatabaseInput { name: string; icon: string; dateFieldId: string; dbOrder?: number }
export interface RowInput { title: string; rowOrder?: number }

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };

export function parseDatabaseBody(body: Record<string, unknown>): Parsed<DatabaseInput> {
  const errors: Record<string, string> = {};

  const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
  if (!name) errors['name'] = 'is required';
  else if (name.length > MAX_NAME) errors['name'] = `must be at most ${MAX_NAME} characters`;

  const icon = body['icon'] ?? '';
  // One emoji, or nothing. Longer values are a mistake, not a picture.
  if (typeof icon !== 'string' || icon.length > 16) errors['icon'] = 'must be a short emoji, or empty';

  const dateFieldId = body['dateFieldId'] ?? '';
  if (typeof dateFieldId !== 'string' || (dateFieldId !== '' && !SAFE_ID.test(dateFieldId))) {
    errors['dateFieldId'] = 'must be a field id, or empty';
  }

  const order = body['dbOrder'];
  if (order !== undefined && !(typeof order === 'number' && Number.isInteger(order) && order >= 0)) {
    errors['dbOrder'] = 'must be a whole number, 0 or more';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name, icon: icon as string, dateFieldId: dateFieldId as string, dbOrder: order as number | undefined,
    },
  };
}

export function parseRowBody(body: Record<string, unknown>): Parsed<RowInput> {
  const errors: Record<string, string> = {};

  const title = typeof body['title'] === 'string' ? body['title'].trim() : '';
  if (!title) errors['title'] = 'is required';
  else if (title.length > MAX_TITLE) errors['title'] = `must be at most ${MAX_TITLE} characters`;

  const order = body['rowOrder'];
  if (order !== undefined && !(typeof order === 'number' && Number.isInteger(order) && order >= 0)) {
    errors['rowOrder'] = 'must be a whole number, 0 or more';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { title, rowOrder: order as number | undefined } };
}

export const isSafeId = (id: string): boolean => SAFE_ID.test(id);

// ── Row shapes ────────────────────────────────────────────────────────────────

const BASE_DB_COLUMNS = 'ROWID,DatabaseId,OwnerId,Name,Icon,DbOrder,CreatedAt,UpdatedAt';

/** The database columns to SELECT, given what the table has. */
function dbColumns(): string {
  return dateFieldAvailable ? `${BASE_DB_COLUMNS},DateFieldId` : BASE_DB_COLUMNS;
}
const ROW_COLUMNS = 'ROWID,RecordId,OwnerId,DatabaseId,Title,RowOrder,CreatedAt,UpdatedAt';

export function toDatabase(row: Record<string, unknown>): DatabaseWithRowId {
  return {
    rowId: str(row['ROWID']),
    id: str(row['DatabaseId']),
    ownerId: str(row['OwnerId']),
    name: str(row['Name']),
    icon: str(row['Icon']),
    dateFieldId: str(row['DateFieldId']),
    dbOrder: num(row['DbOrder']),
    createdAt: num(row['CreatedAt']),
    updatedAt: num(row['UpdatedAt']),
  };
}

export function toDatabaseRow(row: Record<string, unknown>): RecordWithRowId {
  return {
    rowId: str(row['ROWID']),
    id: str(row['RecordId']),
    ownerId: str(row['OwnerId']),
    databaseId: str(row['DatabaseId']),
    title: str(row['Title']),
    rowOrder: num(row['RowOrder']),
    createdAt: num(row['CreatedAt']),
    updatedAt: num(row['UpdatedAt']),
  };
}

export function databaseToRow(db: KaizenDatabase): Record<string, string> {
  return {
    DatabaseId: db.id,
    OwnerId: db.ownerId,
    Name: db.name.slice(0, MAX_NAME),
    Icon: db.icon,
    // Written only once the column is known to exist; before that a database
    // saves exactly as it did and simply has no calendar.
    ...(dateFieldAvailable ? { DateFieldId: db.dateFieldId } : {}),
    DbOrder: String(db.dbOrder),
    CreatedAt: String(db.createdAt),
    UpdatedAt: String(db.updatedAt),
  };
}

export function rowToRow(record: DatabaseRow): Record<string, string> {
  return {
    RecordId: record.id,
    OwnerId: record.ownerId,
    DatabaseId: record.databaseId,
    Title: record.title.slice(0, MAX_TITLE),
    RowOrder: String(record.rowOrder),
    CreatedAt: String(record.createdAt),
    UpdatedAt: String(record.updatedAt),
  };
}

/** The API shapes: no ROWID, which stays internal to Catalyst. */
export function databaseToApi(db: KaizenDatabase) {
  return {
    id: db.id, name: db.name, icon: db.icon, dateFieldId: db.dateFieldId,
    dbOrder: db.dbOrder, createdAt: db.createdAt, updatedAt: db.updatedAt,
  };
}

export function rowToApi(record: DatabaseRow) {
  return {
    id: record.id, databaseId: record.databaseId, title: record.title,
    rowOrder: record.rowOrder, createdAt: record.createdAt, updatedAt: record.updatedAt,
  };
}

// ── Storage ───────────────────────────────────────────────────────────────────

/** Every page of a query, so nothing is silently cut off at 300. */
async function readPages<T>(
  app: CatalystApp,
  table: string,
  query: (offset: number) => string,
  toRow: (row: Record<string, unknown>) => T,
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const results = await app.zcql().executeZCQLQuery(query(offset));
    const page = unwrapRows(results, table).map(toRow);
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

export async function listDatabases(app: CatalystApp, ownerId: string): Promise<DatabaseWithRowId[]> {
  const databases = await readPages(
    app, DATABASES_TABLE,
    (offset) => `SELECT ${dbColumns()} FROM ${DATABASES_TABLE} WHERE OwnerId = ${zcqlString(ownerId)} ` +
      `ORDER BY DbOrder ASC LIMIT ${offset},${PAGE}`,
    toDatabase,
  );
  return databases.filter((database) => !isDeletionPending(database));
}

export async function getDatabase(
  app: CatalystApp, ownerId: string, databaseId: string,
): Promise<DatabaseWithRowId | null> {
  const results = await app.zcql().executeZCQLQuery(
    `SELECT ${dbColumns()} FROM ${DATABASES_TABLE} ` +
    `WHERE DatabaseId = ${zcqlString(databaseId)} AND OwnerId = ${zcqlString(ownerId)} LIMIT 1`,
  );
  const rows = unwrapRows(results, DATABASES_TABLE);
  return rows.length ? toDatabase(rows[0]) : null;
}

export async function insertDatabase(app: CatalystApp, db: KaizenDatabase): Promise<void> {
  await app.datastore().table(DATABASES_TABLE).insertRow(databaseToRow(db));
}

export async function updateDatabase(app: CatalystApp, rowId: string, db: KaizenDatabase): Promise<void> {
  await withDeletionLock(deletionLockKey('database', db.ownerId, db.id), async () => {
    if (!isDeletionPending(db)) {
      const current = await getDatabase(app, db.ownerId, db.id);
      if (!current || isDeletionPending(current)) throw new Error('Database deletion is pending');
    }
    await app.datastore().table(DATABASES_TABLE).updateRow({ ROWID: rowId, ...databaseToRow(db) });
  });
}

export async function deleteDatabase(app: CatalystApp, rowId: string): Promise<void> {
  await app.datastore().table(DATABASES_TABLE).deleteRow(rowId);
}

/** Hide a database before deleting its children, so a failed purge is retryable. */
export async function markDatabaseDeleting(app: CatalystApp, database: DatabaseWithRowId): Promise<void> {
  if (isDeletionPending(database)) return;
  await app.datastore().table(DATABASES_TABLE).updateRow({
    ROWID: database.rowId,
    ...databaseToRow({ ...database, updatedAt: DELETION_PENDING_UPDATED_AT }),
  });
}

export async function listRows(
  app: CatalystApp, ownerId: string, databaseId: string, includeDeleting = false,
): Promise<RecordWithRowId[]> {
  const rows = await readPages(
    app, DB_ROWS_TABLE,
    (offset) => `SELECT ${ROW_COLUMNS} FROM ${DB_ROWS_TABLE} ` +
      `WHERE OwnerId = ${zcqlString(ownerId)} AND DatabaseId = ${zcqlString(databaseId)} ` +
      `ORDER BY RowOrder ASC LIMIT ${offset},${PAGE}`,
    toDatabaseRow,
  );
  return includeDeleting ? rows : rows.filter((row) => !isDeletionPending(row));
}

export async function getRow(
  app: CatalystApp, ownerId: string, rowIdValue: string,
): Promise<RecordWithRowId | null> {
  const results = await app.zcql().executeZCQLQuery(
    `SELECT ${ROW_COLUMNS} FROM ${DB_ROWS_TABLE} ` +
    `WHERE RecordId = ${zcqlString(rowIdValue)} AND OwnerId = ${zcqlString(ownerId)} LIMIT 1`,
  );
  const rows = unwrapRows(results, DB_ROWS_TABLE);
  return rows.length ? toDatabaseRow(rows[0]) : null;
}

export async function insertRow(app: CatalystApp, record: DatabaseRow): Promise<void> {
  await app.datastore().table(DB_ROWS_TABLE).insertRow(rowToRow(record));
}

export async function updateRow(app: CatalystApp, rowId: string, record: DatabaseRow): Promise<void> {
  await withDeletionLocks([
    deletionLockKey('database', record.ownerId, record.databaseId),
    deletionLockKey('database-row', record.ownerId, record.id),
  ], async () => {
    if (!isDeletionPending(record)) {
      const database = await getDatabase(app, record.ownerId, record.databaseId);
      if (!database || isDeletionPending(database)) throw new Error('Database deletion is pending');
      const current = await getRow(app, record.ownerId, record.id);
      if (!current || isDeletionPending(current)) throw new Error('Record deletion is pending');
    }
    await app.datastore().table(DB_ROWS_TABLE).updateRow({ ROWID: rowId, ...rowToRow(record) });
  });
}

export async function deleteRow(app: CatalystApp, rowId: string): Promise<void> {
  await app.datastore().table(DB_ROWS_TABLE).deleteRow(rowId);
}

/** Hide a record before removing its field values. */
export async function markRowDeleting(app: CatalystApp, record: RecordWithRowId): Promise<void> {
  if (isDeletionPending(record)) return;
  await app.datastore().table(DB_ROWS_TABLE).updateRow({
    ROWID: record.rowId,
    ...rowToRow({ ...record, updatedAt: DELETION_PENDING_UPDATED_AT }),
  });
}

/**
 * Deleting a database deletes its records. Read every page before deleting any
 * of them, so removing rows cannot shift the paging past one that is left.
 */
export async function deleteRowsOfDatabase(
  app: CatalystApp,
  ownerId: string,
  databaseId: string,
  beforeDelete?: (record: RecordWithRowId) => Promise<void>,
): Promise<number> {
  const rows = await listRows(app, ownerId, databaseId, true);
  for (const record of rows) {
    await beforeDelete?.(record);
    await deleteRow(app, record.rowId);
  }
  return rows.length;
}
