import { describe, expect, it } from 'vitest';
import {
  CALENDAR_DAY_PREFIX, NO_DATE, calendarDrop, isInMonth, monthWeeks, shiftMonth, tasksByDay,
} from '@/lib/calendar';
import { compareTasks } from '@/lib/quadrantBuckets';
import type { Todo } from '@/types/todo';

const task = (over: Partial<Todo>): Todo => ({
  id: 'x', text: 'Task', status: 'todo', createdAt: 1, listId: 'l', order: 0, quadrant: 'do', ...over,
});
const day = (key: string) => `${CALENDAR_DAY_PREFIX}${key}`;

describe('monthWeeks', () => {
  it('starts on the Monday before the 1st and ends on the Sunday after the last day', () => {
    // 1 September 2026 is a Tuesday; the 30th is a Wednesday.
    const weeks = monthWeeks({ year: 2026, month: 8 });
    expect(weeks).toHaveLength(5);
    expect(weeks[0][0]).toBe('2026-08-31');
    expect(weeks[0][1]).toBe('2026-09-01');
    expect(weeks[4][6]).toBe('2026-10-04');
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it('is exactly four weeks for a February that starts on a Monday', () => {
    const weeks = monthWeeks({ year: 2027, month: 1 });
    expect(weeks).toHaveLength(4);
    expect(weeks[0][0]).toBe('2027-02-01');
    expect(weeks[3][6]).toBe('2027-02-28');
  });

  it('never repeats or skips a day, across a daylight-saving change', () => {
    const days = monthWeeks({ year: 2026, month: 2 }).flat();
    expect(new Set(days).size).toBe(days.length);
    expect(days).toContain('2026-03-29');
    expect(days).toContain('2026-03-30');
  });
});

describe('shiftMonth / isInMonth', () => {
  it('crosses year boundaries both ways', () => {
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth({ year: 2027, month: 0 }, -1)).toEqual({ year: 2026, month: 11 });
  });

  it('tells a day from the month shown from a neighbouring one', () => {
    expect(isInMonth('2026-09-30', { year: 2026, month: 8 })).toBe(true);
    expect(isInMonth('2026-10-01', { year: 2026, month: 8 })).toBe(false);
  });
});

describe('tasksByDay', () => {
  const timedLate = task({ id: 'late', text: 'late', dueDate: '2026-09-15', dueTime: '17:00', order: 1 });
  const timedEarly = task({ id: 'early', text: 'early', dueDate: '2026-09-15', dueTime: '09:30', order: 2 });
  const untimed = task({ id: 'untimed', text: 'untimed', dueDate: '2026-09-15', order: 0 });
  const done = task({ id: 'done', text: 'done', dueDate: '2026-09-15', status: 'done' });
  const noDate = task({ id: 'nodate', text: 'nodate' });

  it('puts timed tasks first in time order, then the rest, and collects tasks with no date', () => {
    const { byDay, undated } = tasksByDay([untimed, timedLate, done, timedEarly, noDate], false, compareTasks);
    expect(byDay.get('2026-09-15')?.map((t) => t.text)).toEqual(['early', 'late', 'untimed']);
    expect(undated.map((t) => t.text)).toEqual(['nodate']);
  });

  it('shows done tasks last, only when asked', () => {
    const { byDay } = tasksByDay([done, untimed], true, compareTasks);
    expect(byDay.get('2026-09-15')?.map((t) => t.text)).toEqual(['untimed', 'done']);
  });
});

describe('calendarDrop', () => {
  const dated = task({ id: 'a', dueDate: '2026-09-15', dueTime: '10:00' });
  const undated = task({ id: 'b' });
  const todos = [dated, undated];

  it('moves the date and keeps the time', () => {
    expect(calendarDrop('a', day('2026-09-20'), todos)).toEqual({ taskId: 'a', changes: { dueDate: '2026-09-20' } });
  });

  it('gives an undated task a date', () => {
    expect(calendarDrop('b', day('2026-09-01'), todos)).toEqual({ taskId: 'b', changes: { dueDate: '2026-09-01' } });
  });

  it('takes the date and the time off when dropped on the no-date tray', () => {
    expect(calendarDrop('a', day(NO_DATE), todos)).toEqual({ taskId: 'a', changes: { dueDate: '', dueTime: '' } });
    expect(calendarDrop('b', day(NO_DATE), todos)).toBeNull();
  });

  it('changes nothing for the same day, nowhere, an unknown target or an unknown task', () => {
    expect(calendarDrop('a', day('2026-09-15'), todos)).toBeNull();
    expect(calendarDrop('a', null, todos)).toBeNull();
    expect(calendarDrop('a', 'board-column:x', todos)).toBeNull();
    expect(calendarDrop('a', day('not-a-date'), todos)).toBeNull();
    expect(calendarDrop('missing', day('2026-09-20'), todos)).toBeNull();
  });
});
