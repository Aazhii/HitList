import { describe, expect, it } from 'vitest';
import { greeting, isOverdue, planToday, rankForToday } from '@/lib/today';
import type { Todo } from '@/types/todo';

const NOW = new Date('2026-09-30T10:00:00').getTime();
let n = 0;
const task = (over: Partial<Todo>): Todo => ({
  id: `t${++n}`, text: 'x', status: 'todo', createdAt: 0, listId: 'l', order: n, quadrant: 'do', ...over,
});

describe('rankForToday', () => {
  it('puts overdue first, then in progress, then the quadrant', () => {
    const late = task({ quadrant: 'eliminate', dueDate: '2026-09-28' });
    const going = task({ status: 'in-progress', quadrant: 'delegate' });
    const doFirst = task({ quadrant: 'do' });
    const plan = task({ quadrant: 'schedule' });
    expect(rankForToday([plan, doFirst, going, late], NOW)).toEqual([late, going, doFirst, plan]);
  });

  it('breaks ties by due date, then by hand order; done tasks never appear', () => {
    const soon = task({ dueDate: '2026-10-01' });
    const later = task({ dueDate: '2026-10-05' });
    const undated = task({});
    const done = task({ status: 'done' });
    expect(rankForToday([undated, later, soon, done], NOW)).toEqual([soon, later, undated]);
  });

  it('counts a date with no time as due at the end of that day', () => {
    expect(isOverdue(task({ dueDate: '2026-09-30' }), NOW)).toBe(false);
    expect(isOverdue(task({ dueDate: '2026-09-30', dueTime: '09:00' }), NOW)).toBe(true);
    expect(isOverdue(task({ dueDate: '2026-09-01', status: 'done' }), NOW)).toBe(false);
  });
});

describe('planToday', () => {
  it('names one task, two after, the overdue ones, and how many are left', () => {
    const tasks = [1, 2, 3, 4, 5].map((i) => task({ order: i, dueDate: i === 5 ? '2026-09-20' : undefined }));
    const plan = planToday(tasks, NOW);
    expect(plan.next?.id).toBe(tasks[4].id);
    expect(plan.after).toHaveLength(2);
    expect(plan.overdue).toEqual([tasks[4]]);
    expect(plan.rest).toBe(2);
  });

  it('is empty with nothing open', () => {
    expect(planToday([], NOW)).toEqual({ next: null, after: [], overdue: [], rest: 0 });
  });
});

describe('greeting', () => {
  it('follows the hour', () => {
    expect(greeting(new Date('2026-09-30T08:00:00'))).toBe('Good morning');
    expect(greeting(new Date('2026-09-30T14:00:00'))).toBe('Good afternoon');
    expect(greeting(new Date('2026-09-30T20:00:00'))).toBe('Good evening');
  });
});
