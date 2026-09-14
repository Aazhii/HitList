/**
 * Turning "2026-09-20 at 14:30, 30 minutes before" into an absolute instant.
 *
 * This module is pure and has no Catalyst dependency, because it is the part
 * most likely to be quietly wrong and it needs to be testable on its own.
 *
 * The problem it solves: tasks store `DueDate` (YYYY-MM-DD) and `DueTime`
 * (HH:MM) with **no timezone**. The server runs in UTC. Naively parsing
 * `new Date('2026-09-20T14:30:00')` interprets those digits in whatever zone
 * the process happens to be in, so a reminder set for 2:30pm in Kolkata fires
 * at 8:00pm there when the server is in UTC.
 *
 * The fix is to resolve the timezone **once, at enqueue**, into an epoch
 * millisecond. Everything downstream compares integers, and the sweep never
 * has to think about zones at all.
 */

/** Minutes before the due time that a reminder fires, when unset. */
export const DEFAULT_REMINDER_MINUTES = 15;

/** A task with no explicit time is due at the end of its day. */
export const END_OF_DAY = '23:59';

/**
 * How far the named zone is ahead of UTC at a given instant, in milliseconds.
 *
 * Derived from Intl rather than a table, so it stays correct across DST rules
 * changing — which they do, by legislation, more often than people expect.
 */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));

  const get = (type: string): number => {
    const found = parts.find((p) => p.type === type);
    return found ? Number(found.value) : 0;
  };

  // Intl renders hour 24 for midnight under hour12:false in some engines.
  const hour = get('hour') % 24;

  const wallClockAsUtc = Date.UTC(
    get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'),
  );
  return wallClockAsUtc - instant;
}

/** True for a real calendar date in YYYY-MM-DD form. */
export function isValidDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y
    && probe.getUTCMonth() === m - 1
    && probe.getUTCDate() === d;
}

/** True for HH:MM in 24-hour form. */
export function isValidTime(timeStr: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(timeStr);
}

/**
 * Converts a wall-clock date and time in `timeZone` to an absolute epoch ms.
 *
 * Returns null rather than NaN for anything malformed — NaN propagates
 * silently through arithmetic and comparisons (`NaN < now` is false), so a bad
 * date would become a reminder that simply never fires, with nothing to show
 * for it.
 *
 * Two passes: the offset is looked up at a first approximation and then again
 * at the corrected instant, because the offset itself can differ across a DST
 * boundary. Without the second pass, times within an hour of a transition land
 * an hour out.
 */
export function zonedToEpoch(dateStr: string, timeStr: string, timeZone: string): number | null {
  if (!isValidDate(dateStr) || !isValidTime(timeStr)) return null;

  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);

  // Read the wall clock as though it were UTC, then step back by the zone's
  // offset to reach the real instant.
  const wallClockAsUtc = Date.UTC(y, mo - 1, d, h, mi, 0, 0);

  let epoch = wallClockAsUtc - zoneOffsetMs(wallClockAsUtc, timeZone);
  epoch = wallClockAsUtc - zoneOffsetMs(epoch, timeZone);

  return Number.isFinite(epoch) ? epoch : null;
}

/** A task, reduced to just what scheduling needs. */
export interface SchedulableTask {
  id: string;
  title: string;
  status: string;
  dueDate?: string;
  dueTime?: string;
  reminderEnabled?: boolean;
  reminderMinutesBefore?: number;
}

export interface ReminderPlan {
  /** Absolute instant the reminder should be delivered. */
  fireAt: number;
  /** Absolute instant the task is due. */
  dueAt: number;
  minutesBefore: number;
  /** Stable across edits that do not change when it fires. See dedupeKey(). */
  dedupeKey: string;
}

/**
 * Builds the dedupe key for a task reminder.
 *
 * It deliberately includes the due instant and the offset, so:
 *  - editing a task's title leaves the key unchanged, and no duplicate is
 *    enqueued for something already scheduled;
 *  - moving the due date changes the key, so the new reminder is a new row and
 *    the stale one can be cancelled without ambiguity.
 */
export function reminderDedupeKey(taskId: string, dueAt: number, minutesBefore: number): string {
  return `task:${taskId}:due:${dueAt}:off:${minutesBefore}`;
}

/**
 * Works out when a task's reminder should fire, or null when it should not.
 *
 * Null covers every legitimate "nothing to schedule" case — no reminder
 * requested, no due date, already done, unparseable date — so callers do not
 * have to re-derive that logic.
 *
 * Note what this does NOT do: skip reminders whose time has already passed.
 * That belongs to the caller, because the queue deliberately delivers overdue
 * entries rather than dropping them — a missed sweep should mean a late
 * reminder, not a lost one.
 */
export function planTaskReminder(
  task: SchedulableTask,
  timeZone: string,
): ReminderPlan | null {
  if (!task.reminderEnabled) return null;
  if (!task.dueDate) return null;
  if (task.status === 'done' || task.status === 'DONE') return null;

  const dueAt = zonedToEpoch(task.dueDate, task.dueTime || END_OF_DAY, timeZone);
  if (dueAt === null) return null;

  const minutesBefore = Number.isFinite(task.reminderMinutesBefore)
    ? Number(task.reminderMinutesBefore)
    : DEFAULT_REMINDER_MINUTES;

  const fireAt = dueAt - minutesBefore * 60_000;

  return {
    fireAt,
    dueAt,
    minutesBefore,
    dedupeKey: reminderDedupeKey(task.id, dueAt, minutesBefore),
  };
}

/**
 * The message a reminder carries, rendered once at enqueue.
 *
 * Rendering here rather than at delivery keeps the sweep cheap: a tick that
 * finds due rows does no formatting, and a tick that finds none does nothing
 * at all.
 */
export function renderReminder(task: SchedulableTask, minutesBefore: number): {
  title: string;
  body: string;
} {
  const when = minutesBefore >= 60 && minutesBefore % 60 === 0
    ? `${minutesBefore / 60} hour${minutesBefore === 60 ? '' : 's'}`
    : `${minutesBefore} minutes`;

  return {
    title: task.title,
    body: `Due in ${when}.`,
  };
}
