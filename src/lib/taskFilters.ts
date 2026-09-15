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
import { getCategoryConfig, type Todo } from '@/types/todo';
import { compareTasks, type TaskCompare } from '@/lib/quadrantBuckets';
import type { FieldDef, TaskFieldValues } from '@/types/fields';

/** Relative, so a saved "Overdue" view is still right tomorrow. */
export type DuePreset = '' | 'overdue' | 'today' | 'next7' | 'none';
export type TaskSortKey = 'order' | 'created' | 'due-date' | 'status' | 'title';

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
  sortBy: TaskSortKey;
  sortDir: 'asc' | 'desc';
  /**
   * Custom field filters: field id → option ids and/or FIELD_SET / FIELD_EMPTY.
   * A task matches a field when it matches any of its choices.
   */
  fields: Record<string, string[]>;
  /** '' groups the list by quadrant; otherwise a select field's id. */
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
const SORT_KEYS: readonly TaskSortKey[] = ['order', 'created', 'due-date', 'status', 'title'];
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
    sortBy: oneOf(o.sortBy, SORT_KEYS, 'order'),
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

/**
 * How tasks are ordered within a quadrant. Done stays last whichever way the
 * rest is sorted, as it does in manual order, and ties fall back to the user's
 * own order so equal keys don't shuffle between renders.
 */
export function compareForFilters(f: Pick<FilterState, 'sortBy' | 'sortDir'>): TaskCompare {
  if (f.sortBy === 'order' && f.sortDir === 'asc') return compareTasks;
  const dir = f.sortDir === 'desc' ? -1 : 1;

  return (a, b) => {
    const done = (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0);
    if (done !== 0) return done;

    if (f.sortBy === 'due-date') {
      const ad = dueInstant(a);
      const bd = dueInstant(b);
      // No due date sorts after the rest in either direction.
      if (ad === null || bd === null) {
        if (ad === bd) return a.order - b.order;
        return ad === null ? 1 : -1;
      }
      return (ad - bd) * dir || a.order - b.order;
    }

    let key: number;
    switch (f.sortBy) {
      case 'created': key = a.createdAt - b.createdAt; break;
      case 'title': key = a.text.localeCompare(b.text); break;
      case 'status': key = (STATUS_RANK[a.status] ?? 1) - (STATUS_RANK[b.status] ?? 1); break;
      default: key = a.order - b.order;
    }
    return key * dir || a.order - b.order;
  };
}
