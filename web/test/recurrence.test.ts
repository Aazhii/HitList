import { describe, expect, it } from 'vitest';
import { fromApiRecurrence, recurrenceLabel, toApiRecurrence } from '@/lib/recurrence';
import { apiTaskToTodo } from '@/hooks/useServerSync';
import type { ApiTask } from '@/lib/api';

describe('recurrence', () => {
  it('speaks the wire spelling both ways', () => {
    expect(toApiRecurrence('weekly')).toBe('WEEKLY');
    expect(toApiRecurrence('')).toBe('');
    expect(fromApiRecurrence('WEEKDAYS')).toBe('weekdays');
    expect(fromApiRecurrence(null)).toBeUndefined();
    expect(fromApiRecurrence('HOURLY')).toBeUndefined();
    expect(recurrenceLabel('monthly')).toBe('Every month');
    expect(recurrenceLabel(undefined)).toBe('Does not repeat');
  });

  it('reads a server task with and without a repeat', () => {
    const base = {
      id: 'a', title: 'x', status: 'TODO', quadrant: 'DO', priority: null, note: null, dueDate: '2030-01-02', dueTime: null,
      category: null, listId: 'l', taskOrder: 0, reminderEnabled: false, reminderMinutesBefore: null, completedAt: null,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    } as ApiTask;
    expect(apiTaskToTodo({ ...base, recurrence: 'DAILY' }).recurrence).toBe('daily');
    expect(apiTaskToTodo(base).recurrence).toBeUndefined();
  });
});
