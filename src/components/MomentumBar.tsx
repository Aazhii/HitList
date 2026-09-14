import { Flame, BarChart2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KaizenStats } from '@/types/todo';

interface MomentumBarProps {
  stats: KaizenStats;
  total: number;
  done: number;
  onViewHistory?: () => void;
  /** Opens the weekly progress panel. Rendered as its own button, beside — not inside — the momentum button. */
  onViewProgress?: () => void;
}

/**
 * Today's momentum, pinned at the foot of the tasks context column.
 *
 * It used to be a full-width card at the top of the page. The arithmetic, the
 * props and the whole-element button (click, Enter and Space) are unchanged;
 * only the presentation moved.
 */
export function MomentumBar({ stats, total, done, onViewHistory, onViewProgress }: MomentumBarProps) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const hasStreak = stats.streak > 0;

  return (
    <div className="animate-fade-in">
      <div
        role={onViewHistory ? 'button' : undefined}
        tabIndex={onViewHistory ? 0 : undefined}
        aria-label={onViewHistory ? "View today's completed tasks" : undefined}
        onClick={onViewHistory}
        onKeyDown={onViewHistory ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onViewHistory(); } } : undefined}
        className={cn(
          'rounded-[14px] px-3 pt-3 pb-2.5',
          onViewHistory && 'cursor-pointer transition-colors duration-150 hover:bg-a-row-hover',
        )}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13px] text-a-muted">Today's momentum</span>
          <span className={cn('flex items-center gap-1 text-[13px] font-semibold', hasStreak ? 'text-a-accent-700' : 'text-a-faint')}>
            <Flame className="size-3.5 self-center" strokeWidth={2.75} aria-hidden />
            <span className="tabular-nums">{stats.streak} day{stats.streak !== 1 ? 's' : ''}</span>
          </span>
        </div>

        <div
          role="progressbar"
          aria-label="Tasks done in this list"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="mt-2.5 h-[7px] overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--a-ink)_10%,transparent)]"
        >
          <div className="h-full rounded-full bg-a-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>

        <div className="mt-2 flex items-center justify-between text-[12.5px] text-a-faint">
          <span>{done} of {total} task{total !== 1 ? 's' : ''} done</span>
          <span className="font-semibold tabular-nums text-a-muted">{pct}%</span>
        </div>

        <div className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-a-faint">
          <span>Today</span>
          <span className="font-semibold tabular-nums text-a-ink">{stats.todayCompleted}</span>
          <span aria-hidden>·</span>
          <span>All time</span>
          <span className="font-semibold tabular-nums text-a-ink">{stats.totalCompleted}</span>
          {pct === 100 && total > 0 && (
            <span className="ml-auto font-semibold text-a-sage-ink animate-fade-in">✦ All done!</span>
          )}
        </div>
      </div>

      {onViewProgress && (
        <button
          type="button"
          onClick={onViewProgress}
          className="mx-3 mt-0.5 flex items-center gap-1.5 rounded-full py-1 text-[12.5px] text-a-faint transition-colors duration-150 hover:text-a-ink"
        >
          <BarChart2 className="size-3.5" strokeWidth={2.75} aria-hidden />
          Weekly progress
        </button>
      )}
    </div>
  );
}
