/**
 * The task filter bar's model, and applying it.
 *
 * The filter bar used to change nothing on screen: its state was handed to
 * useCatalystSync, which ignored it, and every fetch returned every task.
 *
 * Filters are applied here, to the tasks already loaded, rather than by asking
 * the server for a filtered list. That is deliberate. App's task array also
 * feeds the list counts, reminders, note chips and the offline copy in
 * localStorage; a filtered fetch would have replaced every one of those with
 * the filtered subset.
 *
 * Priority is not part of the model. Nothing in the app sets a task's
 * priority, so filtering by it could only hide every task — the quadrant is
 * the priority model.
 */
import { QUADRANTS, getCategoryConfig, type Todo } from '@/types/todo';
import { compareTasks, type TaskCompare } from '@/lib/quadrantBuckets';
import type { FieldDef, FieldKind, FieldValue, OptionColor, TaskFieldValues } from '@/types/fields';

/** Relative, so a saved "Overdue" view is still right tomorrow. */
export type DuePreset = '' | 'overdue' | 'today' | 'next7' | 'none';
export type TaskSortKey = 'order' | 'created' | 'due-date' | 'status' | 'title' | 'quadrant';
/** Sorting by a custom field: `field:<field id>`. */
export type FieldSortKey = `field:${string}`;

export const fieldSortKey = (fieldId: string): FieldSortKey => `field:${fieldId}`;

/** The field a sort key names, or null for a built-in sort. */
export function sortFieldId(sortBy: string): string | null {
  return sortBy.startsWith('field:') ? sortBy.slice('field:'.length) : null;
}

export interface FilterState {
  search: string;
  /** '' | 'TODO' | 'IN_PROGRESS' | 'DONE' */
  status: string;
  /** '' | 'DO' | 'SCHEDULE' | 'DELEGATE' | 'ELIMINATE' */
  quadrant: string;
  due: DuePreset;
  /** YYYY-MM-DD or '' — inclusive. */
  dueAfter: string;
  /** YYYY-MM-DD or '' — inclusive. */
  dueBefore: string;
  sortBy: TaskSortKey | FieldSortKey;
  sortDir: 'asc' | 'desc';
  /**
   * Custom field filters: field id → option ids and/or FIELD_SET / FIELD_EMPTY.
   * A task matches a field when it matches any of its choices.
   */
  fields: Record<string, string[]>;
  /** A select, multi-select or checkbox field's id to group by. '' = quadrants in the list, no groups in the table. */
  groupBy: string;
}

/** Choice meaning "has any value" — for a checkbox, "checked". */
export const FIELD_SET = '__set__';
/** Choice meaning "has no value" — for a checkbox, "unchecked". */
export const FIELD_EMPTY = '__empty__';

export const DEFAULT_FILTERS: FilterState = {
  search: '',
  status: '',
  quadrant: '',
  due: '',
  dueAfter: '',
  dueBefore: '',
  sortBy: 'order',
  sortDir: 'asc',
  fields: {},
  groupBy: '',
};

export function countActiveFilters(f: FilterState): number {
  let n = 0;
  if (f.search) n++;
  if (f.status) n++;
  if (f.quadrant) n++;
  if (f.due) n++;
  if (f.dueAfter) n++;
  if (f.dueBefore) n++;
  if (f.sortBy !== 'order') n++;
  if (f.sortDir === 'desc') n++;
  n += Object.values(f.fields ?? {}).filter((choices) => choices.length > 0).length;
  if (f.groupBy) n++;
  return n;
}


const FIELD_ID = /^[A-Za-z0-9_-]{1,64}$/;
const FIELD_CHOICE = /^(?:__set__|__empty__|[A-Za-z0-9_-]{1,16})$/;

/** Per-field filter choices: valid ids only, no empty entries, capped. */
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

const DUE_PRESETS: readonly DuePreset[] = ['', 'overdue', 'today', 'next7', 'none'];
const SORT_KEYS: readonly TaskSortKey[] = ['order', 'created', 'due-date', 'status', 'title', 'quadrant'];
const FIELD_SORT = /^field:[A-Za-z0-9_-]{1,64}$/;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A filter read from storage or the server, made safe to apply: unknown fields
 * dropped, illegal values reset to the default. Mirrors server/views.ts.
 */
export function normaliseFilters(raw: unknown): FilterState {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback);

  return {
    search: text(o.search).slice(0, 200),
    status: oneOf(o.status, ['', 'TODO', 'IN_PROGRESS', 'DONE'], ''),
    quadrant: oneOf(o.quadrant, ['', 'DO', 'SCHEDULE', 'DELEGATE', 'ELIMINATE'], ''),
    due: oneOf(o.due, DUE_PRESETS, ''),
    dueAfter: DATE_KEY.test(text(o.dueAfter)) ? text(o.dueAfter) : '',
    dueBefore: DATE_KEY.test(text(o.dueBefore)) ? text(o.dueBefore) : '',
    sortBy: typeof o.sortBy === 'string' && FIELD_SORT.test(o.sortBy)
      ? (o.sortBy as FieldSortKey)
      : oneOf(o.sortBy, SORT_KEYS, 'order'),
    sortDir: o.sortDir === 'desc' ? 'desc' : 'asc',
    fields: normaliseFieldFilters(o.fields),
    groupBy: typeof o.groupBy === 'string' && FIELD_ID.test(o.groupBy) ? o.groupBy : '',
  };
}

/** Whether two filters would show the same thing. */
export function sameFilters(a: unknown, b: unknown): boolean {
  const x = normaliseFilters(a);
  const y = normaliseFilters(b);
  const canonical = (fields: Record<string, string[]>) =>
    JSON.stringify(Object.keys(fields).sort().map((k) => [k, [...fields[k]].sort()]));
  return (Object.keys(x) as Array<keyof FilterState>).every((k) =>
    k === 'fields' ? canonical(x.fields) === canonical(y.fields) : x[k] === y[k]);
}

const STATUS: Record<string, Todo['status']> = { TODO: 'todo', IN_PROGRESS: 'in-progress', DONE: 'done' };
const QUADRANT: Record<string, Todo['quadrant']> = {
  DO: 'do', SCHEDULE: 'schedule', DELEGATE: 'delegate', ELIMINATE: 'eliminate',
};

/** YYYY-MM-DD for the browser's own calendar day. */
export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return localDateKey(new Date(y, m - 1, d + days));
}

/** When a task falls due: its time, or the end of its day. Matches getDueInfo. */
function dueInstant(t: Todo): number | null {
  if (!t.dueDate) return null;
  const ts = new Date(t.dueTime ? `${t.dueDate}T${t.dueTime}:00` : `${t.dueDate}T23:59:59`).getTime();
  return Number.isNaN(ts) ? null : ts;
}

export function applyTaskFilters(
  todos: readonly Todo[],
  f: FilterState,
  now: Date = new Date(),
  /** Custom fields and values. Field filters are skipped without them. */
  custom?: { defs: FieldDef[]; values: TaskFieldValues },
): Todo[] {
  // Only fields that still exist: a saved view whose field was deleted must
  // not quietly hide every task.
  const known = new Set((custom?.defs ?? []).map((d) => d.id));
  const fieldFilters = Object.entries(f.fields ?? {}).filter(([id, choices]) => known.has(id) && choices.length > 0);

  const needle = f.search.trim().toLowerCase();
  const status = STATUS[f.status];
  const quadrant = QUADRANT[f.quadrant];
  const today = localDateKey(now);
  const weekEnd = addDays(today, 7);

  return todos.filter((t) => {
    if (status && t.status !== status) return false;
    if (quadrant && t.quadrant !== quadrant) return false;

    if (needle) {
      const category = getCategoryConfig(t.category)?.label ?? t.category ?? '';
      if (!`${t.text}\n${t.note ?? ''}\n${category}`.toLowerCase().includes(needle)) return false;
    }

    if (f.dueAfter && !(t.dueDate && t.dueDate >= f.dueAfter)) return false;
    if (f.dueBefore && !(t.dueDate && t.dueDate <= f.dueBefore)) return false;

    switch (f.due) {
      case 'overdue': {
        const at = dueInstant(t);
        if (t.status === 'done' || at === null || at >= now.getTime()) return false;
        break;
      }
      case 'today':
        if (t.dueDate !== today) return false;
        break;
      case 'next7':
        if (!t.dueDate || t.dueDate < today || t.dueDate > weekEnd) return false;
        break;
      case 'none':
        if (t.dueDate) return false;
        break;
    }

    for (const [fieldId, choices] of fieldFilters) {
      const value = custom?.values[t.id]?.[fieldId];
      const matches = choices.some((choice) => {
        if (choice === FIELD_SET) return value !== undefined;
        if (choice === FIELD_EMPTY) return value === undefined;
        return Array.isArray(value) ? value.includes(choice) : value === choice;
      });
      if (!matches) return false;
    }
    return true;
  });
}

const STATUS_RANK: Record<string, number> = { 'in-progress': 0, todo: 1, done: 2 };
const QUADRANT_RANK: Record<string, number> = Object.fromEntries(QUADRANTS.map((q, i) => [q.id, i]));

/**
 * What a task sorts by for one field. null = no value, which sorts last in
 * either direction. Select and multi sort by the field's option order, so the
 * order the user gave the options is the order they sort in.
 */
export function fieldSortValue(def: FieldDef, value: FieldValue | undefined): number | string | null {
  if (value === undefined) return null;
  const optionIndex = (id: string) => def.options.findIndex((o) => o.id === id);
  switch (def.kind) {
    case 'select': {
      const i = typeof value === 'string' ? optionIndex(value) : -1;
      return i >= 0 ? i : null;
    }
    case 'multi': {
      const found = (Array.isArray(value) ? value : []).map(optionIndex).filter((i) => i >= 0);
      return found.length ? Math.min(...found) : null;
    }
    case 'number': return typeof value === 'number' ? value : null;
    case 'date': return typeof value === 'string' && value ? value : null;
    case 'text': return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
    case 'checkbox': return value === true ? 0 : null;
  }
}

/**
 * How tasks are ordered within a quadrant. Done stays last whichever way the
 * rest is sorted, as it does in manual order, and ties fall back to the user's
 * own order so equal keys don't shuffle between renders.
 *
 * Sorting by a field that no longer exists falls back to the manual order.
 */
export function compareForFilters(
  f: Pick<FilterState, 'sortBy' | 'sortDir'>,
  custom?: { defs: FieldDef[]; values: TaskFieldValues },
): TaskCompare {
  const fieldId = sortFieldId(f.sortBy);
  const fieldDef = fieldId ? custom?.defs.find((d) => d.id === fieldId) : undefined;
  if (fieldId && !fieldDef) return compareTasks;
  if (f.sortBy === 'order' && f.sortDir === 'asc') return compareTasks;
  const dir = f.sortDir === 'desc' ? -1 : 1;

  return (a, b) => {
    const done = (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0);
    if (done !== 0) return done;

    if (f.sortBy === 'due-date' || fieldDef) {
      const av = fieldDef ? fieldSortValue(fieldDef, custom?.values[a.id]?.[fieldDef.id]) : dueInstant(a);
      const bv = fieldDef ? fieldSortValue(fieldDef, custom?.values[b.id]?.[fieldDef.id]) : dueInstant(b);
      // No value sorts after the rest in either direction.
      if (av === null || bv === null) {
        if (av === bv) return a.order - b.order;
        return av === null ? 1 : -1;
      }
      const key = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
      return key * dir || a.order - b.order;
    }

    let key: number;
    switch (f.sortBy) {
      case 'created': key = a.createdAt - b.createdAt; break;
      case 'title': key = a.text.localeCompare(b.text); break;
      case 'status': key = (STATUS_RANK[a.status] ?? 1) - (STATUS_RANK[b.status] ?? 1); break;
      case 'quadrant': key = (QUADRANT_RANK[a.quadrant] ?? 0) - (QUADRANT_RANK[b.quadrant] ?? 0); break;
      default: key = a.order - b.order;
    }
    return key * dir || a.order - b.order;
  };
}

/**
 * The same ordering for tasks from several quadrants in one run — the table,
 * and list groups by field. A task's manual order only means something inside
 * its quadrant, so the manual order here is quadrant first, then that order.
 */
export function compareAcrossQuadrants(
  f: Pick<FilterState, 'sortBy' | 'sortDir'>,
  custom?: { defs: FieldDef[]; values: TaskFieldValues },
): TaskCompare {
  const within = compareForFilters(f, custom);
  const manual = f.sortBy === 'order' || (sortFieldId(f.sortBy) !== null && within === compareTasks);
  if (!manual) return within;
  const dir = f.sortDir === 'desc' ? -1 : 1;
  return (a, b) => {
    const done = (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0);
    if (done !== 0) return done;
    const q = (QUADRANT_RANK[a.quadrant] ?? 0) - (QUADRANT_RANK[b.quadrant] ?? 0);
    return (q || a.order - b.order) * dir;
  };
}

/** Field kinds whose values name groups: an option, several options, or ticked / not. */
export const GROUPABLE_KINDS: readonly FieldKind[] = ['select', 'multi', 'checkbox'];

export const isGroupableField = (def: FieldDef): boolean => GROUPABLE_KINDS.includes(def.kind);

/** The field the filter groups by, if it still exists and can still be grouped by. */
export function groupFieldFor(f: Pick<FilterState, 'groupBy'>, defs: readonly FieldDef[]): FieldDef | null {
  if (!f.groupBy) return null;
  return defs.find((d) => d.id === f.groupBy && isGroupableField(d)) ?? null;
}

/**
 * The groups one value puts a task in: its option, each of its options for a
 * multi-select, or FIELD_SET for a ticked checkbox. Empty = no value.
 */
export function groupKeysFor(def: FieldDef, value: FieldValue | undefined): string[] {
  if (value === undefined) return [];
  if (def.kind === 'checkbox') return value === true ? [FIELD_SET] : [];
  if (def.kind === 'multi') return Array.isArray(value) ? value : [];
  return typeof value === 'string' ? [value] : [];
}

export interface TaskGroup {
  /** An option id, or FIELD_EMPTY for tasks with no value. */
  key: string;
  label: string;
  color: OptionColor | null;
  tasks: Todo[];
}

/**
 * Tasks grouped by a field: one group per option, in the field's order, then
 * one for tasks with no value — only when there are some, unless `includeEmpty`
 * (a board needs that column as somewhere to drop). A value naming a deleted
 * option counts as no value.
 *
 * A multi-select task appears in the group of every option it has. A checkbox
 * has two groups, Checked and Not checked, both always shown.
 */
export function groupByField(
  todos: readonly Todo[],
  showDone: boolean,
  compare: TaskCompare,
  def: FieldDef,
  values: TaskFieldValues,
  options: { includeEmpty?: boolean } = {},
): TaskGroup[] {
  const isCheckbox = def.kind === 'checkbox';
  const groups: TaskGroup[] = isCheckbox
    ? [{ key: FIELD_SET, label: 'Checked', color: null, tasks: [] }]
    : def.options.map((o) => ({ key: o.id, label: o.label, color: o.color, tasks: [] }));
  const empty: TaskGroup = { key: FIELD_EMPTY, label: isCheckbox ? 'Not checked' : `No ${def.name}`, color: null, tasks: [] };
  const byKey = new Map(groups.map((g) => [g.key, g]));

  for (const t of todos) {
    if (!showDone && t.status === 'done') continue;
    const keys = groupKeysFor(def, values[t.id]?.[def.id]).filter((k) => byKey.has(k));
    if (keys.length === 0) empty.tasks.push(t);
    for (const k of new Set(keys)) byKey.get(k)!.tasks.push(t);
  }
  for (const g of groups) g.tasks.sort(compare);
  empty.tasks.sort(compare);
  return empty.tasks.length || options.includeEmpty || isCheckbox ? [...groups, empty] : groups;
}
