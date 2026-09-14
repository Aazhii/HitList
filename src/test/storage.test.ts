/**
 * Storage round-trip.
 *
 * These exist because of a bug that was invisible without them: migrateTodo()
 * rebuilt each Todo field by field and never copied reminderEnabled or
 * reminderMinutesBefore. Since mockApi calls loadAppState() on every operation,
 * enabling a reminder was erased by the very next read — the setting never
 * survived long enough to be scheduled.
 *
 * Nothing failed loudly. The UI accepted the toggle, wrote it, and the value
 * was gone on the next tick. So the property worth asserting is not "a reminder
 * fires" but "what was saved is what comes back".
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { loadAppState, saveAppState, setActiveUserId } from '@/lib/storage';
import type { AppState, Todo } from '@/types/todo';

/** Matches BASE_STORAGE_KEY in storage.ts (no active user set in these tests). */
const STORAGE_KEY = 'kaizen-app-v3';

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 'task-1',
    text: 'Write the reminder test',
    status: 'todo',
    createdAt: 1_700_000_000_000,
    listId: 'list-daily',
    order: 0,
    quadrant: 'do',
    ...overrides,
  };
}

/** Saves a state containing one todo, reads it back, returns the todo. */
function roundTrip(todo: Todo): Todo {
  const state = loadAppState();
  const next: AppState = {
    ...state,
    todos: [{ ...todo, listId: state.activeListId }],
  };
  saveAppState(next);
  const reloaded = loadAppState();
  return reloaded.todos.find((t) => t.id === todo.id)!;
}

describe('storage round-trip', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setActiveUserId(null);
  });

  it('preserves reminder settings', () => {
    const result = roundTrip(makeTodo({ reminderEnabled: true, reminderMinutesBefore: 30 }));

    expect(result.reminderEnabled).toBe(true);
    expect(result.reminderMinutesBefore).toBe(30);
  });

  it('preserves a disabled reminder as false rather than dropping it', () => {
    // false and undefined mean different things: the user turned it off, versus
    // never having chosen. Coercing one to the other loses that.
    const result = roundTrip(makeTodo({ reminderEnabled: false, reminderMinutesBefore: 15 }));

    expect(result.reminderEnabled).toBe(false);
    expect(result.reminderMinutesBefore).toBe(15);
  });

  it('leaves reminder fields undefined when they were never set', () => {
    const result = roundTrip(makeTodo());

    expect(result.reminderEnabled).toBeUndefined();
    expect(result.reminderMinutesBefore).toBeUndefined();
  });

  it('survives repeated reads, which is how the original bug surfaced', () => {
    roundTrip(makeTodo({ reminderEnabled: true, reminderMinutesBefore: 60 }));

    // mockApi reloads on every operation; the value must not decay.
    let todo = loadAppState().todos.find((t) => t.id === 'task-1')!;
    for (let i = 0; i < 5; i++) {
      saveAppState(loadAppState());
      todo = loadAppState().todos.find((t) => t.id === 'task-1')!;
    }

    expect(todo.reminderEnabled).toBe(true);
    expect(todo.reminderMinutesBefore).toBe(60);
  });

  it('ignores values of the wrong type instead of trusting them', () => {
    // Hand-edited or migrated-from-elsewhere storage should not inject a string
    // where a boolean is expected.
    const state = loadAppState();
    saveAppState({
      ...state,
      todos: [{ ...makeTodo(), listId: state.activeListId }],
    });

    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    raw.todos[0].reminderEnabled = 'yes';
    raw.todos[0].reminderMinutesBefore = '30';
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));

    const result = loadAppState().todos.find((t) => t.id === 'task-1')!;
    expect(result.reminderEnabled).toBeUndefined();
    expect(result.reminderMinutesBefore).toBeUndefined();
  });

  it('preserves the other fields it rebuilds', () => {
    // migrateTodo lists every field explicitly, so any field it forgets is
    // silently lost the same way the reminder ones were. Guard the set.
    const result = roundTrip(makeTodo({
      note: 'a note',
      dueDate: '2026-09-20',
      dueTime: '14:30',
      category: 'Work',
      completedAt: 1_700_000_500_000,
      status: 'done',
    }));

    expect(result.note).toBe('a note');
    expect(result.dueDate).toBe('2026-09-20');
    expect(result.dueTime).toBe('14:30');
    expect(result.category).toBe('Work');
    expect(result.completedAt).toBe(1_700_000_500_000);
    expect(result.status).toBe('done');
  });
});
