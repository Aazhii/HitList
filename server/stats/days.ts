/**
 * Calendar days in the user's timezone, for "completed today" and the streak.
 *
 * Both used to be worked out with `new Date()` on the server, which runs in UTC
 * in production. For a user in Asia/Kolkata that put the day boundary at 05:30
 * local time: a task finished at 01:00 counted towards the previous day, and
 * could break a streak that had actually been kept.
 */

/** The calendar day `instant` falls on in `timeZone`, as YYYY-MM-DD. */
export function dayKeyInZone(instant: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * The YYYY-MM-DD `days` calendar days away. Pure date arithmetic, so a DST
 * transition cannot make a "day" 23 or 25 hours long.
 */
export function shiftDayKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Consecutive days with at least one completion, ending today — or yesterday,
 * so a streak is not shown as broken before the user has had today to keep
 * it. Capped at a year, as it always was.
 */
export function streakDays(completedAt: readonly number[], timeZone: string, now: number): number {
  const days = new Set(completedAt.filter((t) => t > 0).map((t) => dayKeyInZone(t, timeZone)));
  let cursor = dayKeyInZone(now, timeZone);
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    if (days.has(cursor)) {
      streak++;
      cursor = shiftDayKey(cursor, -1);
    } else if (i === 0) {
      cursor = shiftDayKey(cursor, -1);
    } else {
      break;
    }
  }
  return streak;
}
