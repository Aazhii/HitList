/**
 * When does a recurring rule fire next?
 *
 * Pure, and deliberately separate from anything Catalyst-shaped: this is the
 * part most likely to be quietly wrong, and quietly wrong here means a rule
 * that fires at 3am, or on the wrong day, or twice, or never — none of which
 * announce themselves.
 *
 * Everything returns an absolute epoch, computed through the owner's timezone
 * exactly once. See server/notifications/schedule.ts for why: the wall clock a
 * user chose ("every weekday at 09:00") is meaningless without a zone, the
 * server runs in UTC, and arithmetic on local times across a DST boundary is
 * where this kind of code goes wrong.
 *
 * Two decisions worth stating, because both are defensible either way:
 *
 *   - "Next" is strictly AFTER the instant you pass in, never equal to it.
 *     Otherwise a rule that has just fired computes the same instant again and
 *     fires forever in a loop. This is the bug the old Java scheduler had.
 *   - A monthly rule on a day the month does not have CLAMPS to the last day
 *     rather than skipping. A rule set for the 31st should fire on 28 February,
 *     not go quiet for a month.
 */
import { zonedToEpoch, isValidTime } from '../notifications/schedule.ts';

export type RecurrenceFrequency = 'daily' | 'weekdays' | 'weekly' | 'monthly';

export interface Recurrence {
  frequency: RecurrenceFrequency;
  /** HH:MM in the owner's local time. */
  time: string;
  /** 0=Sun … 6=Sat, for 'weekly'. */
  dayOfWeek?: number;
  /** 1–31, for 'monthly'. Clamped to the month's last day. */
  dayOfMonth?: number;
}

/** How many days ahead we are willing to search before giving up. */
const MAX_SEARCH_DAYS = 400;

/** The calendar date, in the given zone, of an absolute instant. */
function zonedDateParts(instant: number, timeZone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(instant));

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** Days in a month, 1-indexed month. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function dateString(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Day of the week (0=Sun) for a calendar date, with no zone involved. */
function weekdayOf(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** True when the weekday is Monday to Friday. */
function isWeekday(day: number): boolean {
  return day >= 1 && day <= 5;
}

/**
 * Does this calendar date match the recurrence?
 *
 * Monthly is the interesting one: a date matches if it is the requested day, or
 * if it is the last day of a month too short to contain it.
 */
function dateMatches(r: Recurrence, y: number, m: number, d: number): boolean {
  switch (r.frequency) {
    case 'daily':
      return true;

    case 'weekdays':
      return isWeekday(weekdayOf(y, m, d));

    case 'weekly': {
      const want = r.dayOfWeek;
      // An unspecified day would otherwise match nothing and the rule would
      // never fire. Treat it as "the same weekday it was created on" is not
      // available here, so fall back to Monday — a visible, explicable choice.
      if (want === undefined || want < 0 || want > 6) return weekdayOf(y, m, d) === 1;
      return weekdayOf(y, m, d) === want;
    }

    case 'monthly': {
      const want = r.dayOfMonth ?? 1;
      const last = daysInMonth(y, m);
      // Clamp rather than skip: the 31st of February is the 28th.
      return d === Math.min(Math.max(want, 1), last);
    }
  }
}

/**
 * The next instant this recurrence fires, strictly after `after`.
 *
 * Returns null for a recurrence that cannot produce one — an invalid time, or
 * a pattern that matches no date within the search window. Null rather than a
 * guess: a rule that silently fires at midnight because its time was malformed
 * is worse than one that visibly does not fire.
 */
export function nextRecurrence(
  r: Recurrence,
  timeZone: string,
  after: number,
): number | null {
  if (!isValidTime(r.time)) return null;

  // Start from the calendar date `after` falls on IN THE OWNER'S ZONE, not the
  // server's. At 23:30 UTC it is already tomorrow in Kolkata, and a daily rule
  // should schedule for tomorrow's local date.
  const { y, m, d } = zonedDateParts(after, timeZone);

  for (let offset = 0; offset <= MAX_SEARCH_DAYS; offset++) {
    // Step through calendar days via UTC arithmetic, which has no DST to trip
    // over; the zone is applied only when converting the final wall clock.
    const probe = new Date(Date.UTC(y, m - 1, d + offset));
    const py = probe.getUTCFullYear();
    const pm = probe.getUTCMonth() + 1;
    const pd = probe.getUTCDate();

    if (!dateMatches(r, py, pm, pd)) continue;

    const epoch = zonedToEpoch(dateString(py, pm, pd), r.time, timeZone);
    if (epoch === null) continue;

    // Strictly after, so a rule that has just fired advances instead of
    // re-selecting the instant it fired at.
    if (epoch > after) return epoch;
  }

  return null;
}

/**
 * A stable key for one firing of a recurring rule.
 *
 * Built from the instant rather than from a counter, so re-planning the same
 * firing — after a restart, a retried tick, or a rule edit that does not move
 * the schedule — produces the same key and enqueues nothing new.
 */
export function recurrenceDedupeKey(ruleId: string, fireAt: number): string {
  return `rule:${ruleId}:at:${fireAt}`;
}
