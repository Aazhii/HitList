/**
 * The Today surface's ranking (P5.1): which open task is the one to do next, which two follow, and
 * which are overdue. Derived from what a task already has — quadrant, due date, status, hand order —
 * so nothing new is asked of the user. Pure; `now` is passed in.
 */
import type { Quadrant, Todo } from '@/types/todo';

const QUADRANT_RANK: Record<Quadrant, number> = { do: 0, schedule: 1, delegate: 2, eliminate: 3 };

/** When a task is due, in ms. A date with no time is due at the end of that day. */
export function dueTimestamp(todo: Pick<Todo, 'dueDate' | 'dueTime'>): number | null {
  if (!todo.dueDate) return null;
  const at = new Date(todo.dueTime ? `${todo.dueDate}T${todo.dueTime}:00` : `${todo.dueDate}T23:59:59`).getTime();
  return Number.isNaN(at) ? null : at;
}

export function isOverdue(todo: Todo, now: number): boolean {
  if (todo.status === 'done') return false;
  const due = dueTimestamp(todo);
  return due !== null && due < now;
}

/**
 * Open tasks, most deserving of attention first: overdue, then in progress, then by quadrant
 * (Do first → Eliminate), then soonest due, then the order the person put them in.
 */
export function rankForToday(todos: readonly Todo[], now: number): Todo[] {
  return todos
    .filter((t) => t.status !== 'done')
    .map((t) => ({ t, overdue: isOverdue(t, now), due: dueTimestamp(t) ?? Infinity }))
    .sort((a, b) =>
      Number(b.overdue) - Number(a.overdue)
      || Number(b.t.status === 'in-progress') - Number(a.t.status === 'in-progress')
      || QUADRANT_RANK[a.t.quadrant] - QUADRANT_RANK[b.t.quadrant]
      || (a.due === b.due ? 0 : a.due < b.due ? -1 : 1)
      || a.t.order - b.t.order)
    .map((r) => r.t);
}

export interface TodayPlan {
  /** The one to do next. */
  next: Todo | null;
  /** The two after it. */
  after: Todo[];
  overdue: Todo[];
  /** Open tasks not shown above. */
  rest: number;
}

export function planToday(todos: readonly Todo[], now: number): TodayPlan {
  const ranked = rankForToday(todos, now);
  return {
    next: ranked[0] ?? null,
    after: ranked.slice(1, 3),
    overdue: ranked.filter((t) => isOverdue(t, now)),
    rest: Math.max(0, ranked.length - 3),
  };
}

/** "Good morning" and so on. */
export function greeting(now: Date): string {
  const h = now.getHours();
  return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
