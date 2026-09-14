/**
 * notifications.ts
 * Client-side Notification API wrapper with setTimeout-based scheduling.
 * All timeouts are re-registered on every app mount — never persisted to localStorage.
 */

import type { Todo } from '@/types/todo';

// ── Constants ────────────────────────────────────────────────────────────────

export const REMINDER_OPTIONS = [
  { value: 5,  label: '5 min before' },
  { value: 15, label: '15 min before' },
  { value: 30, label: '30 min before' },
  { value: 60, label: '1 hour before' },
] as const;

export type ReminderMinutes = typeof REMINDER_OPTIONS[number]['value'];

export const DEFAULT_REMINDER_MINUTES: ReminderMinutes = 15;

// ── Internal state ───────────────────────────────────────────────────────────

/**
 * taskId → the live timer and the inputs it was scheduled from.
 *
 * The signature is what makes reconciliation possible. Previously
 * scheduleAllReminders() cancelled every timer and rebuilt them all, and the
 * effect that calls it re-runs whenever the todos array identity changes —
 * which is every keystroke-driven state update. A reminder due inside that
 * churn window could be destroyed microseconds before it was meant to fire.
 * Now a reminder whose inputs have not changed is left strictly alone.
 */
interface ScheduledReminder {
  handle: ReturnType<typeof setTimeout>;
  signature: string;
}

const scheduledTimeouts = new Map<string, ScheduledReminder>();

/** Everything that determines when — and whether — a reminder fires. */
function reminderSignature(todo: Todo): string {
  return [
    todo.reminderEnabled ? '1' : '0',
    todo.reminderMinutesBefore ?? DEFAULT_REMINDER_MINUTES,
    todo.dueDate ?? '',
    todo.dueTime ?? '',
    todo.status,
    todo.text,
  ].join('|');
}

// ── Browser support ──────────────────────────────────────────────────────────

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getPermission(): NotificationPermission {
  if (!isNotificationSupported()) return 'denied';
  return Notification.permission;
}

/**
 * Request notification permission. Must be called from a user gesture (click).
 * Returns the resulting permission state.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch {
    return 'denied';
  }
}

// ── Scheduling ───────────────────────────────────────────────────────────────

/** Compute the due timestamp for a task (ms since epoch), or null if no due date. */
function getDueTimestamp(todo: Todo): number | null {
  if (!todo.dueDate) return null;
  if (todo.dueTime) {
    return new Date(`${todo.dueDate}T${todo.dueTime}:00`).getTime();
  }
  // No specific time — use end of day
  return new Date(`${todo.dueDate}T23:59:00`).getTime();
}

/** Fire a browser notification for a task. */
function fireNotification(todo: Todo, minutesBefore: number): void {
  if (!isNotificationSupported() || Notification.permission !== 'granted') return;

  const body =
    minutesBefore === 0
      ? 'This task is due now!'
      : `Due in ${minutesBefore < 60 ? `${minutesBefore} min` : '1 hour'}`;

  try {
    const n = new Notification(`⏰ ${todo.text}`, {
      body,
      icon: '/favicon.ico',
      tag: `kaizen-reminder-${todo.id}`,
      requireInteraction: minutesBefore === 0,
    });
    // Auto-close after 8 seconds for non-critical reminders
    if (minutesBefore > 0) {
      setTimeout(() => n.close(), 8000);
    }
  } catch {
    // Silently ignore — e.g. notification blocked mid-session
  }
}

/**
 * Schedule a reminder for a single task.
 * Cancels any existing reminder for the same task first.
 */
export function scheduleReminder(todo: Todo): void {
  // Cancel existing
  cancelReminder(todo.id);

  // Guard: must be enabled, have a due date, not done
  if (!todo.reminderEnabled || !todo.dueDate || todo.status === 'done') return;
  if (!isNotificationSupported() || Notification.permission !== 'granted') return;

  const minutesBefore = todo.reminderMinutesBefore ?? DEFAULT_REMINDER_MINUTES;
  const dueTs = getDueTimestamp(todo);
  if (dueTs === null) return;

  const fireAt = dueTs - minutesBefore * 60 * 1000;
  const delay = fireAt - Date.now();

  // Don't schedule if the reminder time is already past (but still fire if due is in the future)
  if (delay < 0) return;

  // setTimeout is unreliable beyond ~24.8 days — skip those
  const MAX_DELAY_MS = 24 * 60 * 60 * 1000; // 24 hours
  if (delay > MAX_DELAY_MS) return;

  const handle = setTimeout(() => {
    scheduledTimeouts.delete(todo.id);
    fireNotification(todo, minutesBefore);
  }, delay);

  scheduledTimeouts.set(todo.id, { handle, signature: reminderSignature(todo) });
}

/** Cancel a scheduled reminder for a task. */
export function cancelReminder(taskId: string): void {
  const entry = scheduledTimeouts.get(taskId);
  if (entry !== undefined) {
    clearTimeout(entry.handle);
    scheduledTimeouts.delete(taskId);
  }
}

/** Cancel all scheduled reminders. */
export function cancelAllReminders(): void {
  for (const { handle } of scheduledTimeouts.values()) {
    clearTimeout(handle);
  }
  scheduledTimeouts.clear();
}

/**
 * Schedule reminders for all tasks.
 * Cancels all existing reminders first, then re-registers.
 * Call this on mount and whenever the tasks array changes.
 */
/**
 * Brings the live timers in line with `todos`, touching only what changed.
 *
 * This used to cancel every timer and re-create them all. The effect that calls
 * it re-runs on any change to the todos array identity, so reminders were being
 * destroyed and rebuilt constantly — and one falling due inside that window
 * could be cancelled just before it fired. Reconciling means an unchanged
 * reminder keeps the timer it already has.
 */
export function scheduleAllReminders(todos: Todo[]): void {
  if (!isNotificationSupported() || Notification.permission !== 'granted') {
    cancelAllReminders();
    return;
  }

  const seen = new Set<string>();

  for (const todo of todos) {
    seen.add(todo.id);
    const existing = scheduledTimeouts.get(todo.id);
    const signature = reminderSignature(todo);

    // Unchanged — leave its timer running.
    if (existing && existing.signature === signature) continue;

    // Changed: drop the stale timer before scheduling the new one.
    if (existing) cancelReminder(todo.id);
    scheduleReminder(todo);
  }

  // Anything no longer in the list has been deleted; drop its timer.
  for (const taskId of [...scheduledTimeouts.keys()]) {
    if (!seen.has(taskId)) cancelReminder(taskId);
  }
}

// ── In-app urgency helpers ───────────────────────────────────────────────────

export type ReminderStatus =
  | 'upcoming'    // reminder set, due > 15 min away
  | 'due-soon'    // due within 15 min
  | 'overdue'     // past due
  | 'no-reminder' // no reminder set or no due date
  | 'denied'      // permission denied
  | 'unsupported' // browser doesn't support notifications

export function getReminderStatus(todo: Todo): ReminderStatus {
  if (!isNotificationSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';

  if (!todo.reminderEnabled || !todo.dueDate) return 'no-reminder';

  const dueTs = getDueTimestamp(todo);
  if (dueTs === null) return 'no-reminder';

  const diffMs = dueTs - Date.now();
  const diffMins = diffMs / 60000;

  if (diffMs < 0) return 'overdue';
  if (diffMins <= 15) return 'due-soon';
  return 'upcoming';
}
