/**
 * Reminder timer reconciliation.
 *
 * scheduleAllReminders() used to cancel every timer and rebuild them all, and
 * the effect calling it re-runs whenever the todos array identity changes —
 * which is every keystroke-driven state update. A reminder falling due inside
 * that churn window could be cancelled microseconds before it was meant to
 * fire, so reminders went missing for reasons that looked like nothing at all.
 *
 * The property under test is therefore not "a reminder fires" but "a reminder
 * that did not change is left alone".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  scheduleAllReminders,
  cancelAllReminders,
  DEFAULT_REMINDER_MINUTES,
} from '@/lib/notifications';
import type { Todo } from '@/types/todo';

/** A task due an hour out, with a reminder 15 minutes before it. */
function reminderTodo(overrides: Partial<Todo> = {}): Todo {
  const due = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    id: 'task-1',
    text: 'Ship the scheduler',
    status: 'todo',
    createdAt: Date.now(),
    listId: 'list-daily',
    order: 0,
    quadrant: 'do',
    dueDate: `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`,
    dueTime: `${pad(due.getHours())}:${pad(due.getMinutes())}`,
    reminderEnabled: true,
    reminderMinutesBefore: DEFAULT_REMINDER_MINUTES,
    ...overrides,
  };
}

describe('reminder reconciliation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (Notification as unknown as { permission: string }).permission = 'granted';
    cancelAllReminders();
  });

  afterEach(() => {
    cancelAllReminders();
    vi.useRealTimers();
  });

  it('keeps the existing timer when nothing relevant changed', () => {
    const todo = reminderTodo();
    scheduleAllReminders([todo]);

    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const setSpy = vi.spyOn(globalThis, 'setTimeout');

    // A new array with an equivalent todo — exactly what a re-render produces.
    scheduleAllReminders([{ ...todo }]);

    expect(clearSpy).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('survives many re-renders without rescheduling', () => {
    const todo = reminderTodo();
    scheduleAllReminders([todo]);

    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    for (let i = 0; i < 20; i++) scheduleAllReminders([{ ...todo }]);

    expect(clearSpy).not.toHaveBeenCalled();
  });

  it('reschedules when the due time changes', () => {
    const todo = reminderTodo();
    scheduleAllReminders([todo]);

    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    scheduleAllReminders([{ ...todo, dueTime: '23:30' }]);

    expect(setSpy).toHaveBeenCalled();
  });

  it('reschedules when the reminder offset changes', () => {
    const todo = reminderTodo();
    scheduleAllReminders([todo]);

    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    scheduleAllReminders([{ ...todo, reminderMinutesBefore: 30 }]);

    expect(setSpy).toHaveBeenCalled();
  });

  it('cancels the timer when the reminder is switched off', () => {
    const todo = reminderTodo();
    scheduleAllReminders([todo]);

    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    scheduleAllReminders([{ ...todo, reminderEnabled: false }]);

    expect(clearSpy).toHaveBeenCalled();
  });

  it('cancels the timer when the task is deleted', () => {
    scheduleAllReminders([reminderTodo()]);

    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    scheduleAllReminders([]);

    expect(clearSpy).toHaveBeenCalled();
  });

  it('cancels the timer when the task is completed', () => {
    const todo = reminderTodo();
    scheduleAllReminders([todo]);

    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    scheduleAllReminders([{ ...todo, status: 'done' }]);

    expect(clearSpy).toHaveBeenCalled();
  });

  it('drops every timer when permission is revoked', () => {
    scheduleAllReminders([reminderTodo()]);

    (Notification as unknown as { permission: string }).permission = 'denied';
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    scheduleAllReminders([reminderTodo()]);

    expect(clearSpy).toHaveBeenCalled();
  });

  it('reconciles a mixed list, touching only what changed', () => {
    const a = reminderTodo({ id: 'a' });
    const b = reminderTodo({ id: 'b' });
    scheduleAllReminders([a, b]);

    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

    // a unchanged, b retimed, c added.
    scheduleAllReminders([
      { ...a },
      { ...b, dueTime: '22:15' },
      reminderTodo({ id: 'c' }),
    ]);

    // Exactly one cancellation: b's stale timer. a was left alone.
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });
});
