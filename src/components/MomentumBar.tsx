import { Flame, TrendingUp, ChevronRight } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { KaizenStats } from '@/types/todo';

interface MomentumBarProps {
  stats: KaizenStats;
  total: number;
  done: number;
  onViewHistory?: () => void;
}

export function MomentumBar({ stats, total, done, onViewHistory }: MomentumBarProps) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div
      role={onViewHistory ? 'button' : undefined}
      tabIndex={onViewHistory ? 0 : undefined}
      aria-label={onViewHistory ? "View today's completed tasks" : undefined}
      onClick={onViewHistory}
      onKeyDown={onViewHistory ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onViewHistory(); } } : undefined}
      className={cn(
        'rounded-2xl border border-border bg-card p-5 space-y-4 animate-fade-in',
        onViewHistory && 'cursor-pointer hover:border-primary/30 hover:bg-card/80 hover:shadow-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      )}
    >
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="size-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Today's momentum</span>
          {onViewHistory && (
            <span className="text-[10px] text-muted-foreground/60 font-normal hidden sm:inline">
              · tap to review
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {onViewHistory && (
            <ChevronRight className="size-3.5 text-muted-foreground/50 group-hover:text-primary transition-colors duration-200" />
          )}
          <Flame
            className={cn(
              'size-4 transition-colors duration-300',
              stats.streak > 0 ? 'text-primary' : 'text-muted-foreground/40'
            )}
          />
          <span
            className={cn(
              'text-sm font-semibold tabular-nums transition-colors duration-300',
              stats.streak > 0 ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            {stats.streak} day{stats.streak !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <Progress value={pct} className="h-2" />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {done} of {total} task{total !== 1 ? 's' : ''} done
          </span>
          <span className="font-medium tabular-nums">{pct}%</span>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex gap-4 pt-1 border-t border-border/60">
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">Today</span>
          <span className="text-lg font-bold text-foreground tabular-nums">{stats.todayCompleted}</span>
        </div>
        <div className="w-px bg-border/60" />
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">All time</span>
          <span className="text-lg font-bold text-foreground tabular-nums">{stats.totalCompleted}</span>
        </div>
        {pct === 100 && total > 0 && (
          <div className="ml-auto flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary animate-fade-in">
            ✦ All done!
          </div>
        )}
      </div>
    </div>
  );
}
