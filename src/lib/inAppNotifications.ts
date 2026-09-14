/**
 * inAppNotifications.ts
 * Pure functions for detecting upcoming/missed tasks and persisting
 * in-app notification records to localStorage.
 *
 * Deduplication: records are keyed by `${taskId}:${type}`.
 * A new record is only created when a task *transitions* into a window,
 * not on every poll tick.
 */

import type { Todo, NotificationRecord, InAppNotificationType } from '@/types/todo';

const STORAGE_KEY = 'kaizen_inapp_notifications';

// ── Persistence ──────────────────────────────────────────────────────────────

export function loadNotifications(): NotificationRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as NotificationRecord[];
  } catch {
    return [];
  }
}

export function saveNotifications(records: NotificationRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Silently ignore storage errors
  }
}

export function clearNotifications(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// ── Detection helpers ────────────────────────────────────────────────────────

function getDueTimestampMs(todo: Todo): number | null {
  if (!todo.dueDate) return null;
  if (todo.dueTime) {
    return new Date(`${todo.dueDate}T${todo.dueTime}:00`).getTime();
  }
  return new Date(`${todo.dueDate}T23:59:00`).getTime();
}

/**
 * Returns true if the task is within its reminder window (upcoming).
 * A task is "upcoming" if:
 *   - reminderEnabled is true
 *   - has a dueDate
 *   - not done
 *   - due timestamp is in the future
 *   - time until due ≤ reminderMinutesBefore (default 15)
 */
function isUpcoming(todo: Todo, nowMs: number): boolean {
  if (!todo.reminderEnabled || !todo.dueDate || todo.status === 'done') return false;
  const dueMs = getDueTimestampMs(todo);
  if (dueMs === null) return false;
  const diffMs = dueMs - nowMs;
  if (diffMs <= 0) return false; // already past
  const windowMs = (todo.reminderMinutesBefore ?? 15) * 60 * 1000;
  return diffMs <= windowMs;
}

/**
 * Returns true if the task is missed (overdue and reminder-enabled).
 * A task is "missed" if:
 *   - reminderEnabled is true
 *   - has a dueDate
 *   - not done
 *   - due timestamp is in the past
 */
function isMissed(todo: Todo, nowMs: number): boolean {
  if (!todo.reminderEnabled || !todo.dueDate || todo.status === 'done') return false;
  const dueMs = getDueTimestampMs(todo);
  if (dueMs === null) return false;
  return dueMs < nowMs;
}

// ── Core detection ───────────────────────────────────────────────────────────

export interface DetectionResult {
  /** New records that were just created (not previously tracked) */
  newRecords: NotificationRecord[];
  /** Full updated list of all records */
  allRecords: NotificationRecord[];
}

/**
 * Scan the task list against existing records and produce new NotificationRecords
 * for tasks that have newly entered an upcoming or missed window.
 * Existing records are preserved; dismissed records are not re-created.
 */
export function detectAndUpdate(
  todos: Todo[],
  existing: NotificationRecord[]
): DetectionResult {
  const nowMs = Date.now();

  // Build a set of existing keys so we don't duplicate
  const existingKeys = new Set(existing.map((r) => `${r.taskId}:${r.type}`));

  const newRecords: NotificationRecord[] = [];

  for (const todo of todos) {
    // Check upcoming
    const upcomingKey = `${todo.id}:upcoming`;
    if (isUpcoming(todo, nowMs) && !existingKeys.has(upcomingKey)) {
      const dueMs = getDueTimestampMs(todo)!;
      const diffMins = Math.round((dueMs - nowMs) / 60000);
      newRecords.push({
        id: crypto.randomUUID(),
        taskId: todo.id,
        taskText: todo.text,
        quadrant: todo.quadrant,
        type: 'upcoming',
        triggeredAt: nowMs,
        dismissed: false,
        minutesBefore: diffMins,
        seenInToast: false,
      });
      existingKeys.add(upcomingKey);
    }

    // Check missed
    const missedKey = `${todo.id}:missed`;
    if (isMissed(todo, nowMs) && !existingKeys.has(missedKey)) {
      newRecords.push({
        id: crypto.randomUUID(),
        taskId: todo.id,
        taskText: todo.text,
        quadrant: todo.quadrant,
        type: 'missed',
        triggeredAt: nowMs,
        dismissed: false,
        seenInToast: false,
      });
      existingKeys.add(missedKey);
    }
  }

  // Remove records for tasks that are now done or no longer reminder-enabled
  const doneOrDisabledIds = new Set(
    todos
      .filter((t) => t.status === 'done' || !t.reminderEnabled)
      .map((t) => t.id)
  );

  const filtered = existing.filter((r) => !doneOrDisabledIds.has(r.taskId));
  const allRecords = [...filtered, ...newRecords];

  return { newRecords, allRecords };
}

// ── Dismiss helpers ──────────────────────────────────────────────────────────

export function dismissRecord(
  records: NotificationRecord[],
  id: string
): NotificationRecord[] {
  return records.map((r) => (r.id === id ? { ...r, dismissed: true } : r));
}

export function dismissAll(records: NotificationRecord[]): NotificationRecord[] {
  return records.map((r) => ({ ...r, dismissed: true }));
}

export function markSeenInToast(
  records: NotificationRecord[],
  ids: string[]
): NotificationRecord[] {
  const idSet = new Set(ids);
  return records.map((r) => (idSet.has(r.id) ? { ...r, seenInToast: true } : r));
}

// ── Seed demo records ────────────────────────────────────────────────────────

