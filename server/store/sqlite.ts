import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { DatabaseSync as DatabaseSyncInstance } from 'node:sqlite';
import type { CatalystApp, CatalystTable } from '../notifications/types.ts';
import type { ColumnSpec, TableSpec } from '../catalyst/schema.ts';
import { SCHEMA } from '../catalyst/schema.ts';

type SqliteValue = string | number | bigint | null;

const TABLES = new Map<string, TableSpec>(SCHEMA.map((table) => [table.name, table]));
const COLUMNS = new Map<string, Map<string, ColumnSpec>>(
  SCHEMA.map((table) => [table.name, new Map(table.columns.map((column) => [column.name, column]))]),
);

const SQLITE_INDEXES: Array<{ name: string; table: string; columns: string[] }> = [
  { name: 'idx_kaizen_tasks_owner_order', table: 'KaizenTasks', columns: ['OwnerId', 'TaskOrder'] },
  { name: 'idx_kaizen_lists_owner_order', table: 'KaizenLists', columns: ['OwnerId', 'ListOrder'] },
  { name: 'idx_kaizen_notes_owner_updated', table: 'KaizenNotes', columns: ['OwnerId', 'UpdatedAt'] },
  { name: 'idx_kaizen_queue_status_fireat', table: 'KaizenNotificationQueue', columns: ['Status', 'FireAt'] },
  { name: 'idx_kaizen_queue_owner_source', table: 'KaizenNotificationQueue', columns: ['OwnerId', 'SourceType', 'SourceId'] },
  { name: 'idx_kaizen_rules_owner_status', table: 'KaizenAutomationRules', columns: ['OwnerId', 'RuleStatus'] },
  { name: 'idx_kaizen_rules_due', table: 'KaizenAutomationRules', columns: ['RuleStatus', 'NextTriggerAt'] },
  { name: 'idx_kaizen_inbox_owner_created', table: 'KaizenNotifications', columns: ['OwnerId', 'CreatedAt'] },
  { name: 'idx_kaizen_runs_owner_triggered', table: 'KaizenAutomationRuns', columns: ['OwnerId', 'TriggeredAt'] },
  { name: 'idx_kaizen_views_owner_order', table: 'KaizenViews', columns: ['OwnerId', 'ViewOrder'] },
  { name: 'idx_kaizen_propdefs_owner_db_order', table: 'KaizenPropDefs', columns: ['OwnerId', 'DatabaseId', 'DefOrder'] },
  { name: 'idx_kaizen_taskprops_owner_task', table: 'KaizenTaskProps', columns: ['OwnerId', 'TaskId'] },
  { name: 'idx_kaizen_databases_owner_order', table: 'KaizenDatabases', columns: ['OwnerId', 'DbOrder'] },
  { name: 'idx_kaizen_dbrows_owner_db_order', table: 'KaizenDbRows', columns: ['OwnerId', 'DatabaseId', 'RowOrder'] },
];

export interface SqliteStore {
  app: CatalystApp;
  path: string;
  close: () => void;
}

const sharedStores = new Map<string, SqliteStore>();
const requireNode = createRequire(import.meta.url);

type DatabaseSyncConstructor = new (location: string) => DatabaseSyncInstance;

function loadDatabaseSync(): DatabaseSyncConstructor {
  try {
    const sqlite = requireNode('node:sqlite') as { DatabaseSync?: DatabaseSyncConstructor };
    if (typeof sqlite.DatabaseSync !== 'function') throw new Error('DatabaseSync is unavailable');
    return sqlite.DatabaseSync;
  } catch {
    throw new Error(
      'KAIZEN_STORE=sqlite requires a Node.js runtime that supports node:sqlite (Node.js 22.5.0 or newer).',
    );
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function tableSpec(name: string): TableSpec {
  const spec = TABLES.get(name);
  if (!spec) throw new Error(`Unsupported table: ${JSON.stringify(name)}`);
  return spec;
}

function columnSpec(table: string, column: string): ColumnSpec | null {
  if (column === 'ROWID') return null;
  const spec = COLUMNS.get(table)?.get(column);
  if (!spec) throw new Error(`Unsupported column ${JSON.stringify(column)} on ${table}`);
  return spec;
}

function sqliteType(column: ColumnSpec): string {
  return column.type === 'int' || column.type === 'bigint' ? 'INTEGER' : 'TEXT';
}

function ensureDirectory(filePath: string): void {
  if (filePath === ':memory:' || filePath.startsWith('file:')) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function ensureSchema(db: DatabaseSyncInstance): void {
  for (const table of SCHEMA) {
    const columns = table.columns.map((column) => {
      const parts = [quoteIdentifier(column.name), sqliteType(column)];
      if (column.mandatory) parts.push('NOT NULL');
      if (column.unique) parts.push('UNIQUE');
      return parts.join(' ');
    });
    db.exec(`CREATE TABLE IF NOT EXISTS ${quoteIdentifier(table.name)} (${columns.join(', ')})`);
  }

  for (const index of SQLITE_INDEXES) {
    const columns = index.columns.map((column) => quoteIdentifier(column)).join(', ');
    db.exec(`CREATE INDEX IF NOT EXISTS ${quoteIdentifier(index.name)} ON ${quoteIdentifier(index.table)} (${columns})`);
  }
}

function parseIntegerLiteral(raw: string): number | bigint {
  const text = raw.trim();
  const asNumber = Number(text);
  if (Number.isSafeInteger(asNumber)) return asNumber;
  return BigInt(text);
}

function unescapeStringLiteral(raw: string): string {
  return raw.slice(1, -1).replace(/''/g, "'");
}

function parseLiteral(raw: string): SqliteValue {
  const trimmed = raw.trim();
  if (trimmed === "''") return '';
  if (/^'(?:[^']|'')*'$/.test(trimmed)) return unescapeStringLiteral(trimmed);
  if (/^-?\d+$/.test(trimmed)) return parseIntegerLiteral(trimmed);
  throw new Error(`Unsupported literal in SQLite-backed ZCQL query: ${trimmed}`);
}

function splitCommaList(value: string): string[] {
  const out: string[] = [];
  let current = '';
  let inString = false;

  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === "'") {
      current += char;
      if (inString && value[i + 1] === "'") {
        current += "'";
        i++;
      } else {
        inString = !inString;
      }
      continue;
    }
    if (char === ',' && !inString) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  if (current.trim()) out.push(current.trim());
  return out;
}

function parseWhereClause(table: string, clause: string): { sql: string; params: SqliteValue[] } {
  const parts = clause.split(/\s+AND\s+/i).map((part) => part.trim()).filter(Boolean);
  const sql: string[] = [];
  const params: SqliteValue[] = [];

  for (const part of parts) {
    const inMatch = part.match(/^([A-Za-z][A-Za-z0-9_]*)\s+IN\s*\((.*)\)$/i);
    if (inMatch) {
      const [, column, rawList] = inMatch;
      columnSpec(table, column);
      const values = splitCommaList(rawList).map(parseLiteral);
      if (values.length === 0) throw new Error(`Empty IN list in query: ${part}`);
      sql.push(`${column === 'ROWID' ? 'ROWID' : quoteIdentifier(column)} IN (${values.map(() => '?').join(', ')})`);
      params.push(...values);
      continue;
    }

    const comparison = part.match(/^([A-Za-z][A-Za-z0-9_]*)\s*(=|<=|>=|<|>)\s*(.+)$/);
    if (!comparison) throw new Error(`Unsupported WHERE clause in SQLite-backed ZCQL query: ${part}`);
    const [, column, operator, literal] = comparison;
    columnSpec(table, column);
    sql.push(`${column === 'ROWID' ? 'ROWID' : quoteIdentifier(column)} ${operator} ?`);
    params.push(parseLiteral(literal));
  }

  return { sql: sql.join(' AND '), params };
}

function buildSelectQuery(query: string): {
  table: string;
  sql: string;
  params: SqliteValue[];
} {
  const parsed = query.trim().match(
    /^SELECT\s+(.+?)\s+FROM\s+([A-Za-z][A-Za-z0-9_]*)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER BY\s+([A-Za-z][A-Za-z0-9_]*)\s+(ASC|DESC))?(?:\s+LIMIT\s+(\d+)(?:\s*,\s*(\d+))?)?\s*$/i,
  );
  if (!parsed) throw new Error(`Unsupported SQLite-backed ZCQL query: ${query}`);

  const [, columnsRaw, table, whereRaw, orderBy, orderDir, limitA, limitB] = parsed;
  const spec = tableSpec(table);
  const columns = splitCommaList(columnsRaw).map((column) => column.trim()).filter(Boolean);
  if (columns.length === 0) throw new Error(`Query selects no columns: ${query}`);

  const projected = columns.map((column) => {
    columnSpec(spec.name, column);
    if (column === 'ROWID') return 'ROWID AS "ROWID"';
    return `${quoteIdentifier(column)} AS ${quoteIdentifier(column)}`;
  });

  const params: SqliteValue[] = [];
  const clauses = [
    `SELECT ${projected.join(', ')} FROM ${quoteIdentifier(spec.name)}`,
  ];

  if (whereRaw) {
    const where = parseWhereClause(spec.name, whereRaw);
    clauses.push(`WHERE ${where.sql}`);
    params.push(...where.params);
  }

  if (orderBy) {
    columnSpec(spec.name, orderBy);
    clauses.push(`ORDER BY ${orderBy === 'ROWID' ? 'ROWID' : quoteIdentifier(orderBy)} ${(orderDir ?? 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC'}`);
  }

  if (limitA !== undefined) {
    if (limitB !== undefined) {
      clauses.push('LIMIT ? OFFSET ?');
      params.push(Number(limitB), Number(limitA));
    } else {
      clauses.push('LIMIT ?');
      params.push(Number(limitA));
    }
  }

  return { table: spec.name, sql: clauses.join(' '), params };
}

function serialiseValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  return String(value);
}

function coerceValue(table: string, column: string, value: string | number | null): SqliteValue {
  if (column === 'ROWID') return value === null ? null : parseLiteral(String(value));
  const spec = columnSpec(table, column);
  if (!spec) throw new Error(`ROWID is not a writable column on ${table}`);
  if (value === null) return null;

  if (spec.type === 'varchar') {
    return String(value).slice(0, spec.maxLength ?? 255);
  }
  if (spec.type === 'text' || spec.type === 'boolean') {
    return String(value);
  }
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : Math.trunc(value);
  const text = String(value).trim();
  if (!text) return null;
  return parseIntegerLiteral(text);
}

function mapConstraintError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (/UNIQUE constraint failed/i.test(message)) {
    const column = message.split(':')[1]?.split('.').pop()?.trim() ?? 'unique column';
    throw { code: 'DUPLICATE_VALUE', message: `duplicate value for ${column}` };
  }
  throw error;
}

function readRow(db: DatabaseSyncInstance, table: string, rowId: string | number): Record<string, string | null> | null {
  const spec = tableSpec(table);
  const columns = ['ROWID', ...spec.columns.map((column) => column.name)];
  const select = columns
    .map((column) => column === 'ROWID'
      ? 'ROWID AS "ROWID"'
      : `${quoteIdentifier(column)} AS ${quoteIdentifier(column)}`)
    .join(', ');
  const row = db.prepare(
    `SELECT ${select} FROM ${quoteIdentifier(table)} WHERE ROWID = ?`,
  ).get(parseIntegerLiteral(String(rowId))) as Record<string, unknown> | undefined;
  if (!row) return null;
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, serialiseValue(value)]),
  );
}

function makeTable(db: DatabaseSyncInstance, table: string): CatalystTable {
  const spec = tableSpec(table);
  const columns = spec.columns.map((column) => column.name);

  return {
    async insertRow(row) {
      const provided = columns.filter((column) => Object.prototype.hasOwnProperty.call(row, column));
      const values = provided.map((column) => coerceValue(table, column, row[column] ?? null));
      const names = provided.map((column) => quoteIdentifier(column)).join(', ');
      const placeholders = provided.map(() => '?').join(', ');

      try {
        const result = db.prepare(
          `INSERT INTO ${quoteIdentifier(table)} (${names}) VALUES (${placeholders})`,
        ).run(...values);
        return readRow(db, table, String(result.lastInsertRowid));
      } catch (error) {
        mapConstraintError(error);
      }
    },

    async updateRow(row) {
      const rowId = row['ROWID'];
      if (rowId === undefined || rowId === null || rowId === '') throw new Error('ROWID is required');
      const provided = columns.filter((column) => Object.prototype.hasOwnProperty.call(row, column));
      if (provided.length === 0) {
        const existing = readRow(db, table, String(rowId));
        if (!existing) throw new Error('no such row');
        return existing;
      }
      const assignments = provided.map((column) => `${quoteIdentifier(column)} = ?`).join(', ');
      const values = provided.map((column) => coerceValue(table, column, row[column] ?? null));

      try {
        const result = db.prepare(
          `UPDATE ${quoteIdentifier(table)} SET ${assignments} WHERE ROWID = ?`,
        ).run(...values, parseIntegerLiteral(String(rowId)));
        if (result.changes === 0) throw new Error('no such row');
        return readRow(db, table, String(rowId));
      } catch (error) {
        mapConstraintError(error);
      }
    },

    async deleteRow(rowId) {
      db.prepare(
        `DELETE FROM ${quoteIdentifier(table)} WHERE ROWID = ?`,
      ).run(parseIntegerLiteral(String(rowId)));
      return true;
    },
  };
}

export function createSqliteStore(filePath: string): SqliteStore {
  ensureDirectory(filePath);
  const DatabaseSync = loadDatabaseSync();
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA busy_timeout = 5000');
  if (filePath !== ':memory:') {
    try { db.exec('PRAGMA journal_mode = WAL'); } catch { /* older builds may refuse */ }
  }
  ensureSchema(db);

  const app: CatalystApp = {
    datastore: () => ({
      table: (name: string) => makeTable(db, name),
    }),
    zcql: () => ({
      async executeZCQLQuery(query: string) {
        const compiled = buildSelectQuery(query);
        const rows = db.prepare(compiled.sql).all(...compiled.params) as Array<Record<string, unknown>>;
        return rows.map((row) => ({
          [compiled.table]: Object.fromEntries(
            Object.entries(row).map(([key, value]) => [key, serialiseValue(value)]),
          ),
        }));
      },
    }),
    email: () => ({
      async sendMail() {
        throw new Error('Catalyst email delivery is unavailable when KAIZEN_STORE=sqlite');
      },
    }),
    pushNotification: () => ({
      web: () => ({
        async sendNotification() {
          throw new Error('Catalyst web push is unavailable when KAIZEN_STORE=sqlite');
        },
      }),
    }),
  };

  return {
    app,
    path: filePath,
    close: () => db.close(),
  };
}

export function sharedSqliteStore(filePath: string): SqliteStore {
  const existing = sharedStores.get(filePath);
  if (existing) return existing;
  const store = createSqliteStore(filePath);
  sharedStores.set(filePath, store);
  return store;
}

export function __resetSharedSqliteStores(): void {
  for (const store of sharedStores.values()) store.close();
  sharedStores.clear();
}
