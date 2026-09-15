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

export const VIEW_LAYOUTS = ['list', 'matrix'] as const;
export type ViewLayout = typeof VIEW_LAYOUTS[number];

/** Enough for any real use; a cap so a runaway client cannot fill the table. */
export const MAX_VIEWS = 50;
export const MAX_VIEW_NAME = 100;

const STATUSES = ['', 'TODO', 'IN_PROGRESS', 'DONE'] as const;
const QUADRANTS = ['', 'DO', 'SCHEDULE', 'DELEGATE', 'ELIMINATE'] as const;
const DUE_PRESETS = ['', 'overdue', 'today', 'next7', 'none'] as const;
const SORT_KEYS = ['order', 'created', 'due-date', 'status', 'title'] as const;
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

export interface SavedView {
  id: string;
  ownerId: string;
  name: string;
  layout: ViewLayout;
  /** A list the view opens; '' = whichever list is open. */
  scopeListId: string;
  filters: ViewFilters;
  showDone: boolean;
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
    sortBy: oneOf(o['sortBy'], SORT_KEYS, 'order'),
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
    errors['layout'] = 'must be list or matrix';
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
      viewOrder: order as number | undefined,
    },
  };
}

const COLUMNS = 'ROWID,ViewId,OwnerId,Name,ViewLayout,ScopeListId,FilterJson,ShowDone,ViewOrder,CreatedAt,UpdatedAt';

function bool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  const s = str(v).toLowerCase();
  return s === 'true' || s === '1';
}

export function toView(row: Record<string, unknown>): ViewRow {
  let filters: unknown = {};
  try { filters = JSON.parse(str(row['FilterJson']) || '{}'); } catch { filters = {}; }
  const layout = str(row['ViewLayout']);

  return {
    rowId: str(row['ROWID']),
    id: str(row['ViewId']),
    ownerId: str(row['OwnerId']),
    name: str(row['Name']),
    layout: (VIEW_LAYOUTS as readonly string[]).includes(layout) ? (layout as ViewLayout) : 'list',
    scopeListId: str(row['ScopeListId']),
    filters: normaliseFilters(filters),
    showDone: bool(row['ShowDone']),
    viewOrder: num(row['ViewOrder']),
    createdAt: num(row['CreatedAt']),
    updatedAt: num(row['UpdatedAt']),
  };
}

export function toRow(view: SavedView): Record<string, string> {
  return {
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
      `SELECT ${COLUMNS} FROM ${VIEWS_TABLE} WHERE OwnerId = ${zcqlString(ownerId)} ` +
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
    `SELECT ${COLUMNS} FROM ${VIEWS_TABLE} ` +
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
