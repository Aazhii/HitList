import { describe, expect, it } from 'vitest';
import { dueFill, fieldFill, fillRatio, missingDueCount } from '@/lib/taskQuality';
import type { FieldDef } from '@/types/fields';
import type { Todo } from '@/types/todo';

const todo = (over: Partial<Todo>): Todo => ({
  id: 'x', text: 'Task', status: 'todo', createdAt: 1, listId: 'l', order: 0, quadrant: 'do', ...over,
});
const effort: FieldDef = { id: 'effort', name: 'Effort', kind: 'select', options: [], fieldOrder: 0, showOnCard: false, createdAt: 1, updatedAt: 1 };

describe('task data quality', () => {
  const tasks = [
    todo({ id: 'a', dueDate: '2030-01-01' }),
    todo({ id: 'b' }),
    todo({ id: 'c', status: 'done' }),
    todo({ id: 'd', dueDate: '2030-01-02' }),
  ];

  it('measures how many tasks have a due date', () => {
    expect(dueFill(tasks)).toEqual({ filled: 2, total: 4 });
    expect(fillRatio(dueFill(tasks))).toBe(0.5);
  });

  it('counts only open tasks as missing a date', () => {
    expect(missingDueCount(tasks)).toBe(1);
    expect(missingDueCount([])).toBe(0);
  });

  it('measures a custom field, treating empty strings and empty lists as unfilled', () => {
    const values = { a: { effort: 'hi' }, b: { effort: '' }, c: { effort: [] }, d: {} };
    expect(fieldFill(effort, tasks, values)).toEqual({ filled: 1, total: 4 });
  });

  it('has no ratio for nothing to measure', () => {
    expect(fillRatio({ filled: 0, total: 0 })).toBe(0);
  });
});
