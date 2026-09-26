/**
 * Turning a delivered notification into the record the bell renders.
 *
 * Pure, and separate from the hook, because the interesting decisions are here
 * and they are worth testing without a React tree.
 *
 * The bell's `NotificationRecord` predates the server inbox: it was produced by
 * recomputing "upcoming" and "missed" from the task list on every poll. The
 * server sends something different — a record of a delivery that actually
 * happened — so the two have to be reconciled rather than simply renamed.
 */
import type { Todo, NotificationRecord, InAppNotificationType } from '@/types/todo';
import type { ApiNotification } from '@/lib/api';

/**
 * Reads the task id a notification points at.
 *
 * Prefers the payload, which is what the server writes deliberately, and falls
 * back to SourceId, which is the same value for a task reminder but would be a
 * rule id for an automation.
 */
export function taskIdOf(entry: ApiNotification): string {
  const fromPayload = entry.payload?.['taskId'];
  if (typeof fromPayload === 'string' && fromPayload) return fromPayload;
  return entry.sourceType === 'TASK' ? entry.sourceId : '';
}

/**
 * Classifies a delivered notification as upcoming or missed.
 *
 * Derived from the due instant carried in the payload rather than recomputed
 * from the task, because the task may since have been edited — and what the
 * bell should say is what was true when the notification fired.
 *
 * A notification with no due instant is 'upcoming': it was delivered ahead of
 * something, which is the only reason a reminder exists.
 */
export function classify(entry: ApiNotification, now: number): InAppNotificationType {
  const dueAt = entry.payload?.['dueAt'];
  if (typeof dueAt !== 'number' || !Number.isFinite(dueAt)) return 'upcoming';
  return dueAt < now ? 'missed' : 'upcoming';
}

/**
 * Maps a delivered notification onto the bell's record shape.
 *
 * `todos` supplies the quadrant, which the bell shows as a label. The server
 * does not carry it: it is a property of the task now, not of the delivery,
 * and a task moved between quadrants should show where it currently sits.
 *
 * `toasted` is the set of ids already shown as a toast in this session. The
 * server has no concept of that — a toast is a property of this browser tab,
 * not of the notification — so it is tracked locally and passed in.
 */
export function toRecord(
  entry: ApiNotification,
  todos: Todo[],
  toasted: ReadonlySet<string>,
  now: number,
): NotificationRecord {
  const taskId = taskIdOf(entry);
  const todo = taskId ? todos.find((t) => t.id === taskId) : undefined;
  const minutesBefore = entry.payload?.['minutesBefore'];

  return {
    id: entry.id,
    taskId,
    // The title is the task's text as it read when the notification fired. The
    // current text is better when we have it, so the bell does not show a name
    // the user has since changed.
    taskText: todo?.text ?? entry.title,
    // 'schedule' when the task is gone: a notification for a deleted task can
    // still be worth reading, and the label has to say something.
    quadrant: todo?.quadrant ?? 'schedule',
    type: classify(entry, now),
    triggeredAt: entry.createdAt,
    // Read on the server is what "dismissed" means in the bell: both mean the
    // user has dealt with it.
    dismissed: entry.readAt > 0,
    ...(typeof minutesBefore === 'number' ? { minutesBefore } : {}),
    seenInToast: entry.readAt > 0 || toasted.has(entry.id),
  };
}

/** Maps a page of delivered notifications, newest first. */
export function toRecords(
  entries: ApiNotification[],
  todos: Todo[],
  toasted: ReadonlySet<string>,
  now = Date.now(),
): NotificationRecord[] {
  return entries.map((e) => toRecord(e, todos, toasted, now));
}
