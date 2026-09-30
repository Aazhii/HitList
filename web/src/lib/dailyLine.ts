/**
 * The once-a-day line on Today (P5.2): yesterday's result in one sentence. Plain and quiet by design —
 * a daily tool that cheers loudly gets muted, and a rest day is not a failure, so an empty yesterday
 * says nothing about it.
 */
import type { Todo } from '@/types/todo';

/** The local calendar day of `ms`, as YYYY-MM-DD. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** How many tasks were finished on the local day before `now`. */
export function finishedYesterday(todos: readonly Todo[], now: number): number {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  const key = dayKey(d.getTime());
  return todos.filter((t) => t.status === 'done' && t.completedAt !== undefined && dayKey(t.completedAt) === key).length;
}

/** "Yesterday you finished 3 tasks.", or null when there is nothing to say about it. */
export function yesterdaySentence(finished: number): string | null {
  if (finished <= 0) return null;
  return `Yesterday you finished ${finished} ${finished === 1 ? 'task' : 'tasks'}.`;
}

/** Whether the line shows: switched on, and not already dismissed today. */
export function shouldShowDailyLine(enabled: boolean, seenDay: string, now: number): boolean {
  return enabled && seenDay !== dayKey(now);
}
