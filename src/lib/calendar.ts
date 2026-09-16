/**
 * The calendar layout's model: month grids, tasks by day, and what a drop
 * changes. All in the browser's own calendar, the same days the due-date
 * filters use.
 */
import type { Todo } from '@/types/todo';
import type { TaskCompare } from '@/lib/quadrantBuckets';
import { localDateKey } from '@/lib/taskFilters';

/** A month; `month` is 0–11, as Date uses. */
export interface CalendarMonth {
  year: number;
  month: number;
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export const monthOf = (date: Date): CalendarMonth => ({ year: date.getFullYear(), month: date.getMonth() });

export function shiftMonth(m: CalendarMonth, delta: number): CalendarMonth {
  return monthOf(new Date(m.year, m.month + delta, 1));
}

export function isInMonth(dateKey: string, m: CalendarMonth): boolean {
  const [y, mo] = dateKey.split('-').map(Number);
  return y === m.year && mo - 1 === m.month;
}

/**
 * The weeks a month grid shows, Monday first: from the Monday on or before the
 * 1st to the Sunday on or after the last day. Each day is a YYYY-MM-DD key.
 *
 * Steps a day at a time with setDate rather than adding 24 hours, so a
 * daylight-saving change cannot skip or repeat a day.
 */
export function monthWeeks(m: CalendarMonth): string[][] {
  const first = new Date(m.year, m.month, 1);
  const last = new Date(m.year, m.month + 1, 0);
  const day = new Date(m.year, m.month, 1 - ((first.getDay() + 6) % 7));
  const end = localDateKey(new Date(m.year, m.month, last.getDate() + (6 - ((last.getDay() + 6) % 7))));

  const weeks: string[][] = [];
  for (;;) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(localDateKey(day));
      day.setDate(day.getDate() + 1);
    }
    weeks.push(week);
    if (week[6] === end) return weeks;
  }
}

/**
 * Tasks by due date, and those with none. Within a day, tasks with a time come
 * first in time order, then the rest in the filter's order; done tasks last.
 */
export function tasksByDay(
  todos: readonly Todo[],
  showDone: boolean,
  compare: TaskCompare,
): { byDay: Map<string, Todo[]>; undated: Todo[] } {
  const byDay = new Map<string, Todo[]>();
  const undated: Todo[] = [];

  for (const t of todos) {
    if (!showDone && t.status === 'done') continue;
    if (!t.dueDate) { undated.push(t); continue; }
    const day = byDay.get(t.dueDate);
    if (day) day.push(t); else byDay.set(t.dueDate, [t]);
  }

  const withinDay: TaskCompare = (a, b) => {
    const done = (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0);
    if (done !== 0) return done;
    if (a.dueTime && b.dueTime && a.dueTime !== b.dueTime) return a.dueTime < b.dueTime ? -1 : 1;
    if (!!a.dueTime !== !!b.dueTime) return a.dueTime ? -1 : 1;
    return compare(a, b);
  };
  for (const day of byDay.values()) day.sort(withinDay);
  undated.sort(compare);
  return { byDay, undated };
}

/**
 * Records by the date field the database calendars on, and those with no date.
 *
 * A record has no due date of its own — only the fields it was given — so the
 * database says which date field its calendar reads. Everything else about the
 * grid, and calendarDrop, is the same as for tasks.
 */
export function recordsByDay<T extends { id: string }>(
  records: readonly T[],
  fieldId: string,
  values: Record<string, Record<string, unknown>>,
  compare: (a: T, b: T) => number,
): { byDay: Map<string, T[]>; undated: T[] } {
  const byDay = new Map<string, T[]>();
  const undated: T[] = [];

  for (const record of records) {
    const value = values[record.id]?.[fieldId];
    // A date field holds YYYY-MM-DD; anything else has no place on the grid.
    const day = typeof value === 'string' && DATE_KEY.test(value) ? value : null;
    if (!day) { undated.push(record); continue; }
    const bucket = byDay.get(day);
    if (bucket) bucket.push(record); else byDay.set(day, [record]);
  }

  for (const day of byDay.values()) day.sort(compare);
  undated.sort(compare);
  return { byDay, undated };
}

export const CALENDAR_DAY_PREFIX = 'calendar-day:';
/** The tray of tasks without a due date, as a drop target. */
export const NO_DATE = 'none';

/**
 * What dropping a task on a day, or on the no-date tray, changes — or null when
 * nothing should. A new day keeps the task's time. Taking the date away takes
 * the time too, since a time without a day means nothing.
 */
export function calendarDrop(
  taskId: string,
  overId: string | null,
  todos: readonly Todo[],
): { taskId: string; changes: Pick<Todo, 'dueDate'> & Partial<Pick<Todo, 'dueTime'>> } | null {
  if (!overId || !overId.startsWith(CALENDAR_DAY_PREFIX)) return null;
  const todo = todos.find((t) => t.id === taskId);
  if (!todo) return null;

  const target = overId.slice(CALENDAR_DAY_PREFIX.length);
  if (target === NO_DATE) {
    if (!todo.dueDate) return null;
    return { taskId, changes: todo.dueTime ? { dueDate: '', dueTime: '' } : { dueDate: '' } };
  }
  if (!DATE_KEY.test(target) || todo.dueDate === target) return null;
  return { taskId, changes: { dueDate: target } };
}
