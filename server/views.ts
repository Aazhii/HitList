/**
 * Saved views: a named filter, sort, layout and list scope over a user's tasks.
 *
 * Filtering itself happens in the browser over the tasks already loaded (see
 * src/lib/taskFilters.ts); the server only stores the definitions. The filter
 * is one JSON value because its fields follow the filter bar and nothing
 * queries inside it. It is normalised on the way in and on the way out against
 * the same fields the client understands, so a view can never carry a field
 * the app would silently ignore.
 */
import type { CatalystApp } from './notifications/types.ts';
import { VIEWS_TABLE } from './catalyst/schema.ts';
import { zcqlString, unwrapRows, str, num } from './notifications/zcql.ts';

export const VIEW_LAYOUTS = ['list', 'matrix', 'table', 'board', 'calendar'] as const;
export type ViewLayout = typeof VIEW_LAYOUTS[number];

/** Enough for any real use; a cap so a runaway client cannot fill the table. */
export const MAX_VIEWS = 50;
export const MAX_VIEW_NAME = 100;

const STATUSES = ['', 'TODO', 'IN_PROGRESS', 'DONE'] as const;
const QUADRANTS = ['', 'DO', 'SCHEDULE', 'DELEGATE', 'ELIMINATE'] as const;
const DUE_PRESETS = ['', 'overdue', 'today', 'next7', 'none'] as const;
const SORT_KEYS = ['order', 'created', 'due-date', 'status', 'title', 'quadrant'] as const;
/** Sorting by a custom field. */
const FIELD_SORT = /^field:[A-Za-z0-9_-]{1,64}$/;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Mirrors FilterState in src/lib/taskFilters.ts. */
export interface ViewFilters {
  search: string;
  status: string;
  quadrant: string;
  due: string;
  dueAfter: string;
  dueBefore: string;
  sortBy: string;
  sortDir: 'asc' | 'desc';
  /** Custom field filters: field id → option ids and/or '__set__' / '__empty__'. */
  fields: Record<string, string[]>;
  /** '' = group by quadrant; otherwise a select field's id. */
  groupBy: string;
}

const FIELD_ID = /^[A-Za-z0-9_-]{1,64}$/;
const FIELD_CHOICE = /^(?:__set__|__empty__|[A-Za-z0-9_-]{1,16})$/;

function normaliseFieldFilters(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [id, choices] of Object.entries(raw as Record<string, unknown>).slice(0, 30)) {
    if (!FIELD_ID.test(id) || !Array.isArray(choices)) continue;
    const kept = [...new Set(choices.filter((c): c is string => typeof c === 'string' && FIELD_CHOICE.test(c)))].slice(0, 50);
    if (kept.length) out[id] = kept;
  }
  return out;
}

/**
 * How a table shows its columns: which are hidden, the order they run in, and
 * any widths dragged out. Stored in DisplayJson, a column added after launch —
 * so it is written only once the server has seen it (setViewDisplayAvailable).
 */
export interface ViewDisplay {
  hidden: string[];
  order: string[];
  widths: Record<string, number>;
}

export const DEFAULT_DISPLAY: ViewDisplay = { hidden: [], order: [], widths: {} };

const COLUMN_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Narrow enough to read, wide enough to be useful. */
const MIN_WIDTH = 80;
const MAX_WIDTH = 600;
const MAX_COLUMNS = 60;

/** Only known-shaped ids and sane widths; never throws. */
export function normaliseDisplay(raw: unknown): ViewDisplay {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const ids = (v: unknown) => (Array.isArray(v) ? v : [])
    .filter((x): x is string => typeof x === 'string' && COLUMN_ID.test(x))
    .slice(0, MAX_COLUMNS);

  const widths: Record<string, number> = {};
  const rawWidths = (o['widths'] && typeof o['widths'] === 'object' && !Array.isArray(o['widths']))
    ? o['widths'] as Record<string, unknown>
    : {};
  for (const [id, value] of Object.entries(rawWidths).slice(0, MAX_COLUMNS)) {
    if (!COLUMN_ID.test(id)) continue;
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    widths[id] = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n)));
  }

  return { hidden: [...new Set(ids(o['hidden']))], order: [...new Set(ids(o['order']))], widths };
}

/**
 * Whether KaizenViews has DisplayJson. Until the setup script adds it, views
 * are read and written exactly as before and column choices stay on the device.
 */
let displayAvailable = false;
export function setViewDisplayAvailable(available: boolean): void { displayAvailable = available; }
export function viewDisplayAvailable(): boolean { return displayAvailable; }

export interface SavedView {
  id: string;
  ownerId: string;
  name: string;
  layout: ViewLayout;
  /** A list the view opens; '' = whichever list is open. */
  scopeListId: string;
  filters: ViewFilters;
  showDone: boolean;
  display: ViewDisplay;
  viewOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface ViewRow extends SavedView {
  rowId: string;
}

/** Only known fields, each with a legal value. Never throws. */
export function normaliseFilters(raw: unknown): ViewFilters {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  const oneOf = (v: unknown, allowed: readonly string[], fallback: string) =>
    (typeof v === 'string' && allowed.includes(v) ? v : fallback);

  return {
    search: text(o['search']).slice(0, 200),
    status: oneOf(o['status'], STATUSES, ''),
    quadrant: oneOf(o['quadrant'], QUADRANTS, ''),
    due: oneOf(o['due'], DUE_PRESETS, ''),
    dueAfter: DATE_KEY.test(text(o['dueAfter'])) ? text(o['dueAfter']) : '',
    dueBefore: DATE_KEY.test(text(o['dueBefore'])) ? text(o['dueBefore']) : '',
    sortBy: typeof o['sortBy'] === 'string' && FIELD_SORT.test(o['sortBy']) ? o['sortBy'] : oneOf(o['sortBy'], SORT_KEYS, 'order'),
    sortDir: o['sortDir'] === 'desc' ? 'desc' : 'asc',
    fields: normaliseFieldFilters(o['fields']),
    groupBy: typeof o['groupBy'] === 'string' && FIELD_ID.test(o['groupBy']) ? o['groupBy'] : '',
  };
}

export interface ViewInput {
  name: string;
  layout: ViewLayout;
  scopeListId: string;
  filters: ViewFilters;
  showDone: boolean;
  display: ViewDisplay;
  viewOrder?: number;
}

export type ParsedView =
  | { ok: true; value: ViewInput }
  | { ok: false; errors: Record<string, string> };

export function parseViewBody(body: Record<string, unknown>): ParsedView {
  const errors: Record<string, string> = {};

  const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
  if (!name) errors['name'] = 'is required';
  else if (name.length > MAX_VIEW_NAME) errors['name'] = `must be at most ${MAX_VIEW_NAME} characters`;

  const layout = body['layout'] ?? 'list';
  if (typeof layout !== 'string' || !(VIEW_LAYOUTS as readonly string[]).includes(layout)) {
    errors['layout'] = `must be one of ${VIEW_LAYOUTS.join(', ')}`;
  }

  const scope = body['scopeListId'] ?? '';
  if (typeof scope !== 'string' || (scope !== '' && !SAFE_ID.test(scope))) {
    errors['scopeListId'] = 'must be a list id, or empty';
  }

  const filters = body['filters'];
  if (filters !== undefined && (typeof filters !== 'object' || filters === null || Array.isArray(filters))) {
    errors['filters'] = 'must be an object';
  }

  if (body['showDone'] !== undefined && typeof body['showDone'] !== 'boolean') {
    errors['showDone'] = 'must be true or false';
  }

  const display = body['display'];
  if (display !== undefined && (typeof display !== 'object' || display === null || Array.isArray(display))) {
    errors['display'] = 'must be an object';
  }

  const order = body['viewOrder'];
  if (order !== undefined && !(typeof order === 'number' && Number.isInteger(order) && order >= 0)) {
    errors['viewOrder'] = 'must be a whole number, 0 or more';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      layout: layout as ViewLayout,
      scopeListId: scope as string,
      filters: normaliseFilters(filters),
      showDone: body['showDone'] === true,
      display: normaliseDisplay(display),
      viewOrder: order as number | undefined,
    },
  };
}

const BASE_COLUMNS = 'ROWID,ViewId,OwnerId,Name,ViewLayout,ScopeListId,FilterJson,ShowDone,ViewOrder,CreatedAt,UpdatedAt';

/** The columns to SELECT, given what the table has. */
function viewColumns(): string {
  return displayAvailable ? `${BASE_COLUMNS},DisplayJson` : BASE_COLUMNS;
}

function bool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  const s = str(v).toLowerCase();
  return s === 'true' || s === '1';
}

/** A stored JSON column, or {} when it is empty or unreadable. */
function storedJson(raw: unknown): unknown {
  try { return JSON.parse(str(raw) || '{}'); } catch { return {}; }
}

export function toView(row: Record<string, unknown>): ViewRow {
  const filters = storedJson(row['FilterJson']);
  const layout = str(row['ViewLayout']);
  const display = storedJson(row['DisplayJson']);

  return {
    rowId: str(row['ROWID']),
    id: str(row['ViewId']),
    ownerId: str(row['OwnerId']),
    name: str(row['Name']),
    layout: (VIEW_LAYOUTS as readonly string[]).includes(layout) ? (layout as ViewLayout) : 'list',
    scopeListId: str(row['ScopeListId']),
    filters: normaliseFilters(filters),
    showDone: bool(row['ShowDone']),
    display: normaliseDisplay(display),
    viewOrder: num(row['ViewOrder']),
    createdAt: num(row['CreatedAt']),
    updatedAt: num(row['UpdatedAt']),
  };
}

export function toRow(view: SavedView): Record<string, string> {
  return {
    // Written only once the column is known to exist; before that a view saves
    // exactly as it always did and the choice stays in the browser.
    ...(displayAvailable ? { DisplayJson: JSON.stringify(normaliseDisplay(view.display)) } : {}),
    ViewId: view.id,
    OwnerId: view.ownerId,
    Name: view.name.slice(0, MAX_VIEW_NAME),
    ViewLayout: view.layout,
    ScopeListId: view.scopeListId,
    FilterJson: JSON.stringify(normaliseFilters(view.filters)),
    ShowDone: String(view.showDone),
    ViewOrder: String(view.viewOrder),
    CreatedAt: String(view.createdAt),
    UpdatedAt: String(view.updatedAt),
  };
}

/** The API shape. */
export function viewToApi(view: SavedView) {
  return {
    id: view.id,
    name: view.name,
    layout: view.layout,
    scopeListId: view.scopeListId || null,
    filters: view.filters,
    showDone: view.showDone,
    display: normaliseDisplay(view.display),
    viewOrder: view.viewOrder,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  };
}

/** Every view the owner has, read a page at a time, in the user's order. */
export async function listViews(app: CatalystApp, ownerId: string): Promise<ViewRow[]> {
  const PAGE = 300;
  const out: ViewRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const results = await app.zcql().executeZCQLQuery(
      `SELECT ${viewColumns()} FROM ${VIEWS_TABLE} WHERE OwnerId = ${zcqlString(ownerId)} ` +
      `ORDER BY ViewOrder ASC LIMIT ${offset},${PAGE}`,
    );
    const page = unwrapRows(results, VIEWS_TABLE).map(toView);
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out.sort((a, b) => a.viewOrder - b.viewOrder || a.createdAt - b.createdAt);
}

/** Scoped by owner as well as id, so another user's view is a 404. */
export async function getView(app: CatalystApp, ownerId: string, viewId: string): Promise<ViewRow | null> {
  const results = await app.zcql().executeZCQLQuery(
    `SELECT ${viewColumns()} FROM ${VIEWS_TABLE} ` +
    `WHERE ViewId = ${zcqlString(viewId)} AND OwnerId = ${zcqlString(ownerId)} LIMIT 1`,
  );
  const rows = unwrapRows(results, VIEWS_TABLE);
  return rows.length ? toView(rows[0]) : null;
}

export async function insertView(app: CatalystApp, view: SavedView): Promise<void> {
  await app.datastore().table(VIEWS_TABLE).insertRow(toRow(view));
}

export async function updateView(app: CatalystApp, rowId: string, view: SavedView): Promise<void> {
  await app.datastore().table(VIEWS_TABLE).updateRow({ ROWID: rowId, ...toRow(view) });
}

export async function deleteView(app: CatalystApp, rowId: string): Promise<void> {
  await app.datastore().table(VIEWS_TABLE).deleteRow(rowId);
}
