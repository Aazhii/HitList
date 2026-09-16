/**
 * Custom task fields: a user's own field definitions, and each task's values.
 *
 * Definitions and values are two tables, not new columns on KaizenTasks: fields
 * are per user and change at runtime, and Catalyst tables are provisioned ahead
 * of time. Values are stored as text and parsed by the field's kind here,
 * rather than in `date` or `double` columns — whether those round-trip through
 * the SDK has not been verified on this project, and a value that silently
 * changed type would be data loss.
 *
 * A field's kind cannot change after it is created, so a stored value can
 * always be read back by the kind it was written with.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { CatalystApp } from './notifications/types.ts';
import { PROP_DEFS_TABLE, TASK_PROPS_TABLE } from './catalyst/schema.ts';
import { zcqlString, unwrapRows, str, num } from './notifications/zcql.ts';

export const FIELD_KINDS = ['select', 'multi', 'number', 'date', 'checkbox', 'text'] as const;
export type FieldKind = typeof FIELD_KINDS[number];

export const OPTION_COLORS = ['accent', 'sage', 'do', 'schedule', 'delegate', 'eliminate'] as const;
export type OptionColor = typeof OPTION_COLORS[number];

export const MAX_FIELDS = 30;
export const MAX_OPTIONS = 50;
export const MAX_FIELD_NAME = 100;
export const MAX_OPTION_LABEL = 60;
export const MAX_TEXT_VALUE = 2000;

export interface FieldOption { id: string; label: string; color: OptionColor }

export interface FieldDef {
  id: string;
  ownerId: string;
  /**
   * The database this field belongs to; '' is the task fields, which is every
   * field written before databases existed. See server/databases.ts.
   */
  databaseId: string;
  name: string;
  kind: FieldKind;
  options: FieldOption[];
  fieldOrder: number;
  showOnCard: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface FieldDefRow extends FieldDef { rowId: string }

export type FieldValue = string | number | boolean | string[];

const OPTION_ID = /^[A-Za-z0-9_-]{1,16}$/;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

const newOptionId = () => randomUUID().replace(/-/g, '').slice(0, 10);

const hasOptions = (kind: FieldKind) => kind === 'select' || kind === 'multi';

/**
 * Tidies an options list: labels trimmed and required, ids kept when valid so
 * renaming an option keeps every task that uses it, new ids for new options.
 */
export function normaliseOptions(raw: unknown, makeId: () => string = newOptionId): FieldOption[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: FieldOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const label = typeof o['label'] === 'string' ? o['label'].trim().slice(0, MAX_OPTION_LABEL) : '';
    if (!label) continue;
    let id = typeof o['id'] === 'string' && OPTION_ID.test(o['id']) ? o['id'] : makeId();
    while (seen.has(id)) id = makeId();
    seen.add(id);
    const color = (OPTION_COLORS as readonly string[]).includes(o['color'] as string)
      ? (o['color'] as OptionColor)
      : 'accent';
    out.push({ id, label, color });
    if (out.length >= MAX_OPTIONS) break;
  }
  return out;
}

export interface FieldInput {
  name: string;
  kind: FieldKind;
  options: FieldOption[];
  showOnCard: boolean;
  fieldOrder?: number;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };

/** Validates a create (no `existing`) or an update. */
export function parseFieldBody(
  body: Record<string, unknown>,
  existing?: FieldDef,
  makeId: () => string = newOptionId,
): Parsed<FieldInput> {
  const errors: Record<string, string> = {};

  const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
  if (!name) errors['name'] = 'is required';
  else if (name.length > MAX_FIELD_NAME) errors['name'] = `must be at most ${MAX_FIELD_NAME} characters`;

  const kindRaw = body['kind'] ?? existing?.kind;
  const kind = (FIELD_KINDS as readonly string[]).includes(kindRaw as string) ? (kindRaw as FieldKind) : null;
  if (!kind) errors['kind'] = `must be one of ${FIELD_KINDS.join(', ')}`;
  else if (existing && kind !== existing.kind) errors['kind'] = 'cannot change after the field is created';

  if (body['options'] !== undefined && !Array.isArray(body['options'])) errors['options'] = 'must be a list';
  if (body['showOnCard'] !== undefined && typeof body['showOnCard'] !== 'boolean') {
    errors['showOnCard'] = 'must be true or false';
  }
  const order = body['fieldOrder'];
  if (order !== undefined && !(typeof order === 'number' && Number.isInteger(order) && order >= 0)) {
    errors['fieldOrder'] = 'must be a whole number, 0 or more';
  }

  if (Object.keys(errors).length > 0 || !kind) return { ok: false, errors };

  const options = !hasOptions(kind) ? []
    : body['options'] === undefined ? (existing?.options ?? [])
    : normaliseOptions(body['options'], makeId);

  return {
    ok: true,
    value: {
      name,
      kind,
      options,
      showOnCard: typeof body['showOnCard'] === 'boolean' ? body['showOnCard'] : (existing?.showOnCard ?? false),
      fieldOrder: order as number | undefined,
    },
  };
}

function isCalendarDate(s: string): boolean {
  if (!DATE_KEY.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/**
 * The stored text for a value, or null to clear it. A value that does not fit
 * the field's kind is an error, never coerced into something else.
 */
export function encodeValue(def: Pick<FieldDef, 'kind' | 'options'>, raw: unknown):
  { ok: true; text: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, text: null };
  const optionIds = new Set(def.options.map((o) => o.id));

  switch (def.kind) {
    case 'text':
      if (typeof raw !== 'string') return { ok: false, error: 'must be text' };
      if (raw.length > MAX_TEXT_VALUE) return { ok: false, error: `must be at most ${MAX_TEXT_VALUE} characters` };
      return { ok: true, text: raw.trim() ? raw : null };
    case 'number':
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return { ok: false, error: 'must be a number' };
      return { ok: true, text: String(raw) };
    case 'date':
      if (typeof raw !== 'string' || !isCalendarDate(raw)) return { ok: false, error: 'must be a date, YYYY-MM-DD' };
      return { ok: true, text: raw };
    case 'checkbox':
      if (typeof raw !== 'boolean') return { ok: false, error: 'must be true or false' };
      return { ok: true, text: raw ? 'true' : null };
    case 'select':
      if (typeof raw !== 'string' || !optionIds.has(raw)) return { ok: false, error: "must be one of the field's options" };
      return { ok: true, text: raw };
    case 'multi': {
      if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string' || !optionIds.has(v))) {
        return { ok: false, error: "must be a list of the field's options" };
      }
      const ids = [...new Set(raw as string[])];
      return { ok: true, text: ids.length ? JSON.stringify(ids) : null };
    }
  }
}

/**
 * A stored value read back by kind. Tolerant: an option that has since been
 * removed is left out, and anything unreadable reads as no value rather than
 * failing the whole list.
 */
export function decodeValue(def: Pick<FieldDef, 'kind' | 'options'>, text: string): FieldValue | null {
  if (!text) return null;
  const optionIds = new Set(def.options.map((o) => o.id));
  switch (def.kind) {
    case 'text': return text;
    case 'number': { const n = Number(text); return Number.isFinite(n) ? n : null; }
    case 'date': return isCalendarDate(text) ? text : null;
    case 'checkbox': return text === 'true' ? true : null;
    case 'select': return optionIds.has(text) ? text : null;
    case 'multi': {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (!Array.isArray(parsed)) return null;
        const ids = parsed.filter((v): v is string => typeof v === 'string' && optionIds.has(v));
        return ids.length ? ids : null;
      } catch { return null; }
    }
  }
}

/**
 * One value row per task and field, keyed deterministically. `${taskId}:${defId}`
 * would be 73 characters in a 64-character column — the SourceId bug again —
 * so the key is a hash. The unique constraint on it is what stops two
 * concurrent writes creating two values for the same field. `|` cannot occur
 * in either id, so the joined string is unambiguous.
 */
export function propId(taskId: string, defId: string): string {
  return createHash('sha256').update(`${taskId}|${defId}`).digest('hex').slice(0, 40);
}

// ── Rows ──────────────────────────────────────────────────────────────────────

const BASE_DEF_COLUMNS = 'ROWID,DefId,OwnerId,Name,FieldKind,OptionsJson,DefOrder,ShowOnCard,CreatedAt,UpdatedAt';

/**
 * Whether KaizenPropDefs has DatabaseId. It was added with databases, so until
 * `pnpm catalyst:setup` adds it every field is read and written exactly as
 * before — as a task field.
 */
let databaseColumnAvailable = false;
export function setFieldsDatabaseAvailable(available: boolean): void { databaseColumnAvailable = available; }
export function fieldsDatabaseAvailable(): boolean { return databaseColumnAvailable; }

/** The definition columns to SELECT, given what the table has. */
function defColumns(): string {
  return databaseColumnAvailable ? `${BASE_DEF_COLUMNS},DatabaseId` : BASE_DEF_COLUMNS;
}

/** Narrows a query to one database's fields, or to the task fields. */
function databaseWhere(databaseId: string): string {
  return databaseColumnAvailable ? ` AND DatabaseId = ${zcqlString(databaseId)}` : '';
}
const PROP_COLUMNS = 'ROWID,PropId,OwnerId,TaskId,DefId,ValueText,UpdatedAt';
const PAGE = 300;

function bool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  const s = str(v).toLowerCase();
  return s === 'true' || s === '1';
}

/** A stored JSON column, or the fallback when it is empty or unreadable. */
function storedJson(raw: unknown, fallback: unknown): unknown {
  try { return JSON.parse(str(raw) || JSON.stringify(fallback)); } catch { return fallback; }
}

export function toDef(row: Record<string, unknown>): FieldDefRow {
  const options = storedJson(row['OptionsJson'], []);
  const kind = str(row['FieldKind']);
  return {
    rowId: str(row['ROWID']),
    id: str(row['DefId']),
    ownerId: str(row['OwnerId']),
    databaseId: str(row['DatabaseId']),
    name: str(row['Name']),
    kind: (FIELD_KINDS as readonly string[]).includes(kind) ? (kind as FieldKind) : 'text',
    options: normaliseOptions(options),
    fieldOrder: num(row['DefOrder']),
    showOnCard: bool(row['ShowOnCard']),
    createdAt: num(row['CreatedAt']),
    updatedAt: num(row['UpdatedAt']),
  };
}

export function defToRow(def: FieldDef): Record<string, string> {
  return {
    DefId: def.id,
    OwnerId: def.ownerId,
    // Written only once the column is known to exist; before that every field
    // is a task field, which is what it would have been anyway.
    ...(databaseColumnAvailable ? { DatabaseId: def.databaseId } : {}),
    Name: def.name.slice(0, MAX_FIELD_NAME),
    FieldKind: def.kind,
    OptionsJson: JSON.stringify(def.options),
    DefOrder: String(def.fieldOrder),
    ShowOnCard: String(def.showOnCard),
    CreatedAt: String(def.createdAt),
    UpdatedAt: String(def.updatedAt),
  };
}

export function defToApi(def: FieldDef) {
  return {
    id: def.id, databaseId: def.databaseId, name: def.name, kind: def.kind, options: def.options,
    fieldOrder: def.fieldOrder, showOnCard: def.showOnCard,
    createdAt: def.createdAt, updatedAt: def.updatedAt,
  };
}

async function pagedRows(app: CatalystApp, table: string, columns: string, where: string, orderBy: string) {
  const out: Array<Record<string, unknown>> = [];
  for (let offset = 0; ; offset += PAGE) {
    const results = await app.zcql().executeZCQLQuery(
      `SELECT ${columns} FROM ${table} WHERE ${where} ORDER BY ${orderBy} ASC LIMIT ${offset},${PAGE}`,
    );
    const page = unwrapRows(results, table);
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

/** One database's fields, or the task fields when databaseId is ''. */
export async function listDefs(app: CatalystApp, ownerId: string, databaseId = ''): Promise<FieldDefRow[]> {
  const rows = await pagedRows(
    app, PROP_DEFS_TABLE, defColumns(),
    `OwnerId = ${zcqlString(ownerId)}${databaseWhere(databaseId)}`, 'DefOrder',
  );
  return rows.map(toDef).sort((a, b) => a.fieldOrder - b.fieldOrder || a.createdAt - b.createdAt);
}

export async function getDef(app: CatalystApp, ownerId: string, defId: string): Promise<FieldDefRow | null> {
  const results = await app.zcql().executeZCQLQuery(
    `SELECT ${defColumns()} FROM ${PROP_DEFS_TABLE} ` +
    `WHERE DefId = ${zcqlString(defId)} AND OwnerId = ${zcqlString(ownerId)} LIMIT 1`,
  );
  const rows = unwrapRows(results, PROP_DEFS_TABLE);
  return rows.length ? toDef(rows[0]) : null;
}

export async function insertDef(app: CatalystApp, def: FieldDef): Promise<void> {
  await app.datastore().table(PROP_DEFS_TABLE).insertRow(defToRow(def));
}

export async function updateDef(app: CatalystApp, rowId: string, def: FieldDef): Promise<void> {
  await app.datastore().table(PROP_DEFS_TABLE).updateRow({ ROWID: rowId, ...defToRow(def) });
}

export async function deleteDefRow(app: CatalystApp, rowId: string): Promise<void> {
  await app.datastore().table(PROP_DEFS_TABLE).deleteRow(rowId);
}

export interface PropRow { rowId: string; propId: string; taskId: string; defId: string; valueText: string }

const toProp = (r: Record<string, unknown>): PropRow => ({
  rowId: str(r['ROWID']), propId: str(r['PropId']), taskId: str(r['TaskId']),
  defId: str(r['DefId']), valueText: str(r['ValueText']),
});

/** Every value the owner has, read a page at a time. */
export async function listProps(app: CatalystApp, ownerId: string): Promise<PropRow[]> {
  const rows = await pagedRows(app, TASK_PROPS_TABLE, PROP_COLUMNS, `OwnerId = ${zcqlString(ownerId)}`, 'UpdatedAt');
  return rows.map(toProp);
}

async function findProp(app: CatalystApp, ownerId: string, key: string): Promise<PropRow | null> {
  const results = await app.zcql().executeZCQLQuery(
    `SELECT ${PROP_COLUMNS} FROM ${TASK_PROPS_TABLE} ` +
    `WHERE PropId = ${zcqlString(key)} AND OwnerId = ${zcqlString(ownerId)} LIMIT 1`,
  );
  const rows = unwrapRows(results, TASK_PROPS_TABLE);
  return rows.length ? toProp(rows[0]) : null;
}

function isDuplicate(e: unknown): boolean {
  const o = e as { code?: unknown; message?: unknown } | null;
  const text = `${String(o?.code ?? '')} ${String(o?.message ?? (e instanceof Error ? e.message : ''))}`.toLowerCase();
  return text.includes('duplicate') || text.includes('already exists') || text.includes('unique');
}

/** Sets or clears (text = null) one task's value for one field. */
export async function setProp(
  app: CatalystApp, ownerId: string, taskId: string, defId: string, text: string | null, now = Date.now(),
): Promise<void> {
  const key = propId(taskId, defId);
  const table = app.datastore().table(TASK_PROPS_TABLE);
  const existing = await findProp(app, ownerId, key);

  if (text === null) {
    if (existing) await table.deleteRow(existing.rowId);
    return;
  }
  if (existing) {
    await table.updateRow({ ROWID: existing.rowId, ValueText: text, UpdatedAt: String(now) });
    return;
  }
  try {
    await table.insertRow({
      PropId: key, OwnerId: ownerId, TaskId: taskId, DefId: defId, ValueText: text, UpdatedAt: String(now),
    });
  } catch (e) {
    // Another write created it first; the unique key means it is this same value slot.
    if (!isDuplicate(e)) throw e;
    const winner = await findProp(app, ownerId, key);
    if (winner) await table.updateRow({ ROWID: winner.rowId, ValueText: text, UpdatedAt: String(now) });
  }
}

async function deletePropsWhere(app: CatalystApp, where: string): Promise<number> {
  const rows = (await pagedRows(app, TASK_PROPS_TABLE, PROP_COLUMNS, where, 'UpdatedAt')).map(toProp);
  const table = app.datastore().table(TASK_PROPS_TABLE);
  for (const row of rows) await table.deleteRow(row.rowId);
  return rows.length;
}

/** A field was deleted: remove every task's value for it. */
export function deletePropsForDef(app: CatalystApp, ownerId: string, defId: string): Promise<number> {
  return deletePropsWhere(app, `OwnerId = ${zcqlString(ownerId)} AND DefId = ${zcqlString(defId)}`);
}

/** A task was deleted: remove its values so they do not orphan. */
export function deletePropsForTask(app: CatalystApp, ownerId: string, taskId: string): Promise<number> {
  return deletePropsWhere(app, `OwnerId = ${zcqlString(ownerId)} AND TaskId = ${zcqlString(taskId)}`);
}
