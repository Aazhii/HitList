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
}

export const DEFAULT_FILTERS: FilterState = {
  search: '',
  status: '',
  quadrant: '',
  due: '',
  dueAfter: '',
  dueBefore: '',
  sortBy: 'order',
  sortDir: 'asc',
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
  return n;
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

export function applyTaskFilters(todos: readonly Todo[], f: FilterState, now: Date = new Date()): Todo[] {
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
