import { Flame } from 'lucide-react';
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
 * Today's momentum, pinned at the foot of the sidebar — showcase 89-104.
 *
 * A white card on the sidebar's grey ground: label + flame streak, a 6px track,
 * the count and percentage, then two subtle buttons. The arithmetic, the props
 * and the whole-element button (click, Enter and Space) are unchanged; only the
 * presentation matches the design now.
 */
export function MomentumBar({ stats, total, done, onViewHistory, onViewProgress }: MomentumBarProps) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const hasStreak = stats.streak > 0;

  return (
    <div className="animate-fade-in rounded-[6px] border border-a-line bg-a-surface p-3">
      <div
        role={onViewHistory ? 'button' : undefined}
        tabIndex={onViewHistory ? 0 : undefined}
        aria-label={onViewHistory ? "View today's completed tasks" : undefined}
        onClick={onViewHistory}
        onKeyDown={onViewHistory ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onViewHistory(); } } : undefined}
        className={cn(onViewHistory && 'cursor-pointer')}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] text-a-muted">Today's momentum</span>
          {/* DS --amber-600, the showcase's streak colour (line 94). */}
          <span className={cn('flex items-center gap-1 text-[13px] font-semibold', hasStreak ? 'text-a-amber' : 'text-a-faint')}>
            <Flame className="size-3.5 self-center" strokeWidth={1.75} aria-hidden />
            <span className="tabular-nums">{stats.streak} day{stats.streak !== 1 ? 's' : ''}</span>
          </span>
        </div>

        <div
          role="progressbar"
          aria-label="Tasks done in this list"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-a-surface-2"
        >
          <div className="h-full rounded-full bg-a-accent transition-[width] duration-[260ms]" style={{ width: `${pct}%` }} />
        </div>

        <div className="mt-2 flex items-center justify-between text-[12px] text-a-faint">
          <span>{done} of {total} task{total !== 1 ? 's' : ''} done</span>
          <span className="font-mono tabular-nums text-a-muted">{pct}%</span>
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-1.5">
        {onViewHistory && (
          <button
            type="button"
            onClick={onViewHistory}
            className="flex h-7 items-center whitespace-nowrap rounded-[6px] bg-a-bg px-2.5 text-[13px] text-a-muted transition-colors duration-[120ms] hover:bg-a-surface-2 hover:text-a-ink"
          >
            Today
          </button>
        )}
        {onViewProgress && (
          <button
            type="button"
            onClick={onViewProgress}
            className="flex h-7 items-center whitespace-nowrap rounded-[6px] bg-a-bg px-2.5 text-[13px] text-a-muted transition-colors duration-[120ms] hover:bg-a-surface-2 hover:text-a-ink"
          >
            Weekly progress
          </button>
        )}
      </div>
    </div>
  );
}
