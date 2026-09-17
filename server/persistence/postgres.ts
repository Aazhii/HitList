/**
 * PostgreSQL implementation of the small Catalyst storage surface used by the
 * domain modules. Keeping the Catalyst-shaped facade lets routes and services
 * share one code path without teaching each service about a deployment target.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { CatalystApp, CatalystDatastore, CatalystTable, CatalystZcql } from '../notifications/types.ts';

type StoredRow = Record<string, string | number | null>;
type ScalarOperator = '=' | '<' | '<=' | '>' | '>=';
type ScalarComparison = { column: string; operator: ScalarOperator; value: string | number };
type Comparison = ScalarComparison
  | { column: string; operator: 'IN'; values: Array<string | number> };

const PRIMARY_KEYS: Record<string, string> = {
  KaizenTasks: 'TaskId',
  KaizenLists: 'ListId',
  KaizenNotes: 'NoteId',
  KaizenNotificationQueue: 'QueueId',
  KaizenAutomationRules: 'RuleId',
  KaizenNotifications: 'NotificationId',
  KaizenAutomationRuns: 'RunId',
  KaizenViews: 'ViewId',
  KaizenPropDefs: 'DefId',
  KaizenTaskProps: 'PropId',
  KaizenTrialFeatures: 'FeatureKey',
  KaizenDatabases: 'DatabaseId',
  KaizenDbRows: 'RecordId',
};

// Catalyst serializes several numeric fields as strings. Their local Postgres
// representation is intentionally opaque JSON, so keep their query semantics
// numeric instead of allowing "10" to sort before "2".
const NUMERIC_COLUMNS = new Set([
  'AttemptCount',
  'CompletedAt',
  'CreatedAt',
  'DbOrder',
  'FireAt',
  'ListOrder',
  'ReminderMinutesBefore',
  'RowOrder',
  'TaskOrder',
  'UpdatedAt',
]);

function withoutRowId(row: Record<string, string | number | null>): StoredRow {
  const { ROWID: _rowId, ...data } = row;
  return data;
}

function splitTopLevel(input: string, separator: RegExp): string[] {
  const out: string[] = [];
  let start = 0;
  let quoted = false;
  let depth = 0;
  for (let i = 0; i < input.length; i++) {
    if (input[i] === "'") {
      if (quoted && input[i + 1] === "'") { i++; continue; }
      quoted = !quoted;
    } else if (!quoted && input[i] === '(') depth++;
    else if (!quoted && input[i] === ')') depth--;
    else if (!quoted && depth === 0) {
      const remainder = input.slice(i);
      const match = remainder.match(separator);
      if (match?.index === 0) {
        out.push(input.slice(start, i).trim());
        i += match[0].length - 1;
        start = i + 1;
      }
    }
  }
  out.push(input.slice(start).trim());
  return out.filter(Boolean);
}

function literal(raw: string): string | number {
  const value = raw.trim();
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function parseWhere(where: string | undefined): Comparison[] {
  if (!where) return [];
  return splitTopLevel(where, /^AND\s+/i).map((part) => {
    const inMatch = part.match(/^([A-Za-z][A-Za-z0-9_]*)\s+IN\s+\((.*)\)$/i);
    if (inMatch) {
      return {
        column: inMatch[1],
        operator: 'IN' as const,
        values: splitTopLevel(inMatch[2], /^,\s*/).map(literal),
      };
    }
    const match = part.match(/^([A-Za-z][A-Za-z0-9_]*)\s*(<=|>=|=|<|>)\s*(.+)$/);
    if (!match) throw new Error(`Unsupported local storage predicate: ${part}`);
    return { column: match[1], operator: match[2] as ScalarOperator, value: literal(match[3]) };
  });
}

function valueFor(row: StoredRow & { ROWID: string }, column: string): string | number | null {
  return column === 'ROWID' ? row.ROWID : row[column];
}

function compare(left: string | number | null, right: string | number | null, column?: string): number {
  if (left === null || left === undefined) return right === null || right === undefined ? 0 : -1;
  if (right === null || right === undefined) return 1;
  if (typeof right === 'number' || (column !== undefined && NUMERIC_COLUMNS.has(column))) {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  }
  return String(left).localeCompare(String(right));
}

function matches(row: StoredRow & { ROWID: string }, comparisons: Comparison[]): boolean {
  return comparisons.every((comparison) => {
    const current = valueFor(row, comparison.column);
    if (comparison.operator === 'IN') {
      return comparison.values.some((value) => compare(current, value, comparison.column) === 0);
    }
    const result = compare(current, comparison.value, comparison.column);
    return comparison.operator === '=' ? result === 0
      : comparison.operator === '<' ? result < 0
      : comparison.operator === '<=' ? result <= 0
      : comparison.operator === '>' ? result > 0
      : result >= 0;
  });
}

function parseSelect(query: string): {
  columns: string[]; table: string; comparisons: Comparison[]; order?: { column: string; direction: 1 | -1 };
  limit?: { offset: number; count: number };
} {
  const match = query.trim().match(/^SELECT\s+(.+?)\s+FROM\s+([A-Za-z][A-Za-z0-9_]*)(.*)$/is);
  if (!match) throw new Error(`Unsupported local storage query: ${query}`);
  let tail = match[3].trim();
  let where: string | undefined;
  let order: { column: string; direction: 1 | -1 } | undefined;
  let limit: { offset: number; count: number } | undefined;

  const limitMatch = tail.match(/(?:^|\s)LIMIT\s+(\d+)(?:\s*,\s*(\d+))?\s*$/i);
  if (limitMatch) {
    limit = limitMatch[2]
      ? { offset: Number(limitMatch[1]), count: Number(limitMatch[2]) }
      : { offset: 0, count: Number(limitMatch[1]) };
    tail = tail.slice(0, limitMatch.index ?? 0).trim();
  }
  const orderMatch = tail.match(/(?:^|\s)ORDER\s+BY\s+([A-Za-z][A-Za-z0-9_]*)(?:\s+(ASC|DESC))?\s*$/i);
  if (orderMatch) {
    order = { column: orderMatch[1], direction: orderMatch[2]?.toUpperCase() === 'DESC' ? -1 : 1 };
    tail = tail.slice(0, orderMatch.index ?? 0).trim();
  }
  if (tail) {
    const whereMatch = tail.match(/^WHERE\s+(.+)$/is);
    if (!whereMatch) throw new Error(`Unsupported local storage query clause: ${tail}`);
    where = whereMatch[1];
  }
  return {
    columns: match[1].split(',').map((column) => column.trim()),
    table: match[2],
    comparisons: parseWhere(where),
    order,
    limit,
  };
}

class PostgresTable implements CatalystTable {
  private readonly store: PostgresStore;
  private readonly tableName: string;
  constructor(store: PostgresStore, tableName: string) {
    this.store = store;
    this.tableName = tableName;
  }

  async insertRow(row: Record<string, string | number | null>): Promise<unknown> {
    return this.store.insert(this.tableName, row);
  }

  async updateRow(row: Record<string, string | number | null>): Promise<unknown> {
    return this.store.update(this.tableName, row);
  }

  async deleteRow(rowId: string | number): Promise<unknown> {
    return this.store.delete(this.tableName, String(rowId));
  }
}

class PostgresDatastore implements CatalystDatastore {
  private readonly store: PostgresStore;
  constructor(store: PostgresStore) { this.store = store; }
  table(name: string): CatalystTable { return new PostgresTable(this.store, name); }
}

class PostgresZcql implements CatalystZcql {
  private readonly store: PostgresStore;
  constructor(store: PostgresStore) { this.store = store; }
  executeZCQLQuery(query: string): Promise<Array<Record<string, unknown>>> { return this.store.select(query); }
}

export class PostgresStore implements CatalystApp {
  private readonly datastoreFacade = new PostgresDatastore(this);
  private readonly zcqlFacade = new PostgresZcql(this);
  private readonly pool: Pool;

  constructor(pool: Pool) { this.pool = pool; }

  datastore(): CatalystDatastore { return this.datastoreFacade; }
  zcql(): CatalystZcql { return this.zcqlFacade; }
  email() { return { sendMail: async () => { throw new Error('Catalyst email is unavailable in local PostgreSQL mode'); } }; }
  pushNotification() { return { web: () => ({ sendNotification: async () => { throw new Error('Catalyst web push is unavailable in local PostgreSQL mode'); } }) }; }

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS hitlist_storage_rows (
        row_id VARCHAR(64) PRIMARY KEY,
        table_name VARCHAR(64) NOT NULL,
        owner_id VARCHAR(64) NOT NULL DEFAULT '',
        entity_key VARCHAR(255) NOT NULL DEFAULT '',
        dedupe_key VARCHAR(255) NOT NULL DEFAULT '',
        data TEXT NOT NULL,
        created_at BIGINT NOT NULL
      )
    `);
    await this.pool.query('CREATE INDEX IF NOT EXISTS hitlist_storage_rows_table_owner_idx ON hitlist_storage_rows (table_name, owner_id)');
    await this.pool.query('CREATE INDEX IF NOT EXISTS hitlist_storage_rows_table_created_idx ON hitlist_storage_rows (table_name, created_at)');
    await this.pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS hitlist_storage_rows_entity_unique
      ON hitlist_storage_rows (table_name, entity_key) WHERE entity_key <> ''`);
    await this.pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS hitlist_storage_rows_dedupe_unique
      ON hitlist_storage_rows (table_name, dedupe_key) WHERE dedupe_key <> ''`);
  }

  async insert(tableName: string, row: Record<string, string | number | null>): Promise<StoredRow & { ROWID: string }> {
    const data = withoutRowId(row);
    const rowId = randomUUID();
    const entityKey = String(data[PRIMARY_KEYS[tableName]] ?? '');
    const dedupeKey = tableName === 'KaizenNotificationQueue' ? String(data.DedupeKey ?? '') : '';
    await this.pool.query(
      `INSERT INTO hitlist_storage_rows (row_id, table_name, owner_id, entity_key, dedupe_key, data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [rowId, tableName, String(data.OwnerId ?? ''), entityKey, dedupeKey, JSON.stringify(data), Date.now()],
    );
    return { ...data, ROWID: rowId };
  }

  async update(tableName: string, row: Record<string, string | number | null>): Promise<StoredRow & { ROWID: string }> {
    const rowId = String(row.ROWID ?? '');
    if (!rowId) throw new Error('A ROWID is required for local storage updates');
    const found = await this.pool.query<{ data: string }>(
      'SELECT data FROM hitlist_storage_rows WHERE table_name = $1 AND row_id = $2',
      [tableName, rowId],
    );
    if (!found.rowCount) throw new Error(`Local storage row not found: ${tableName}/${rowId}`);
    const data = { ...(JSON.parse(found.rows[0].data) as StoredRow), ...withoutRowId(row) };
    const entityKey = String(data[PRIMARY_KEYS[tableName]] ?? '');
    const dedupeKey = tableName === 'KaizenNotificationQueue' ? String(data.DedupeKey ?? '') : '';
    await this.pool.query(
      `UPDATE hitlist_storage_rows
       SET owner_id = $1, entity_key = $2, dedupe_key = $3, data = $4
       WHERE table_name = $5 AND row_id = $6`,
      [String(data.OwnerId ?? ''), entityKey, dedupeKey, JSON.stringify(data), tableName, rowId],
    );
    return { ...data, ROWID: rowId };
  }

  async delete(tableName: string, rowId: string): Promise<void> {
    await this.pool.query('DELETE FROM hitlist_storage_rows WHERE table_name = $1 AND row_id = $2', [tableName, rowId]);
  }

  async select(query: string): Promise<Array<Record<string, unknown>>> {
    const parsed = parseSelect(query);
    const owner = parsed.comparisons.find((comparison): comparison is ScalarComparison =>
      comparison.operator === '=' && comparison.column === 'OwnerId',
    );
    const result = owner
      ? await this.pool.query<{ row_id: string; data: string }>(
        'SELECT row_id, data FROM hitlist_storage_rows WHERE table_name = $1 AND owner_id = $2',
        [parsed.table, String(owner.value)],
      )
      : await this.pool.query<{ row_id: string; data: string }>(
        'SELECT row_id, data FROM hitlist_storage_rows WHERE table_name = $1', [parsed.table],
      );
    let rows = result.rows
      .map(({ row_id, data }) => ({ ...JSON.parse(data) as StoredRow, ROWID: row_id }))
      .filter((row) => matches(row, parsed.comparisons));
    if (parsed.order) {
      const { column, direction } = parsed.order;
      rows = rows.sort((a, b) => compare(valueFor(a, column), valueFor(b, column), column) * direction);
    }
    if (parsed.limit) rows = rows.slice(parsed.limit.offset, parsed.limit.offset + parsed.limit.count);
    return rows.map((row) => ({
      [parsed.table]: Object.fromEntries(
        parsed.columns.flatMap((column) => column === '*' ? Object.entries(row) : [[column, valueFor(row, column)]]),
      ),
    }));
  }
}

export function createPostgresStore(databaseUrl: string): PostgresStore {
  return new PostgresStore(new Pool({ connectionString: databaseUrl }));
}
