/**
 * Weekly progress — showcase 972–986. Four stat tiles (streak, today, this week, all
 * time) and a completed-per-day bar chart for the last seven days, today's bar in
 * the brand colour. The dialog frame (title, week range) is the caller's.
 */
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { BTN_MD, topBarSecondary } from '@/components/shell/TopBar';
import type { Todo } from '@/types/todo';

interface StreakPanelProps {
  todos: Todo[];
  onClose: () => void;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The seven local days ending today, oldest first. */
export function lastSevenDays(now = new Date()): Date[] {
  return Array.from({ length: 7 }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - (6 - i)));
}

/** "Sep 23 – Sep 29" — the dialog's description. */
export function weekRangeLabel(now = new Date()): string {
  const days = lastSevenDays(now);
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(days[0])} – ${fmt(days[6])}`;
}

/** Consecutive days ending today (or yesterday, if today has none yet) with a completion. */
export function currentStreak(completedDays: Set<string>, now = new Date()): number {
  let streak = 0;
  for (let i = 0; i < 365; i += 1) {
    const key = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
    if (completedDays.has(key)) streak += 1;
    else if (i === 0) continue; // today not done yet doesn't break it
    else break;
  }
  return streak;
}

const BAR_MAX_PX = 90;

export function StreakPanel({ todos, onClose }: StreakPanelProps) {
  const { stats, bars } = useMemo(() => {
    const done = todos.filter((t) => t.status === 'done' && t.completedAt);
    const perDay = new Map<string, number>();
    for (const t of done) {
      const key = dateKey(new Date(t.completedAt!));
      perDay.set(key, (perDay.get(key) ?? 0) + 1);
    }
    const week = lastSevenDays();
    const weekBars = week.map((d, i) => ({
      key: dateKey(d),
      day: d.toLocaleDateString('en-US', { weekday: 'short' }),
      n: perDay.get(dateKey(d)) ?? 0,
      today: i === week.length - 1,
    }));
    const todayN = weekBars[weekBars.length - 1].n;
    return {
      bars: weekBars,
      stats: [
        { label: 'Streak', value: `${currentStreak(new Set(perDay.keys()))}d` },
        { label: 'Today', value: String(todayN) },
        { label: 'This week', value: String(weekBars.reduce((n, b) => n + b.n, 0)) },
        { label: 'All time', value: String(done.length) },
      ],
    };
  }, [todos]);

  const max = Math.max(...bars.map((b) => b.n), 1);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-[8px] border border-a-line px-3.5 py-3">
            <div className="text-a-faint">{s.label}</div>
            <div className="mt-1 font-mono text-[24px] leading-normal font-bold text-a-ink tabular-nums">{s.value}</div>
          </div>
        ))}
      </div>

      <div>
        <div className="mb-2.5 font-semibold text-a-ink">Completed per day</div>
        <div className="flex h-[140px] items-end gap-3 border-b border-a-line px-1">
          {bars.map((b) => (
            <div key={b.key} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <span className="font-mono text-[11px] text-a-muted tabular-nums">{b.n}</span>
              <div
                className={cn('w-full max-w-[44px] rounded-t-[4px]', b.today ? 'bg-a-accent' : 'bg-a-blue-line')}
                style={{ height: `${Math.max(6, (b.n / max) * BAR_MAX_PX)}px` }}
              />
            </div>
          ))}
        </div>
        <div className="flex gap-3 px-1 pt-1.5">
          {bars.map((b) => (
            <span key={b.key} className="flex-1 text-center text-[12px] text-a-faint">{b.day}</span>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <button type="button" onClick={onClose} className={cn(topBarSecondary, BTN_MD)}>Close</button>
      </div>
    </div>
  );
}
