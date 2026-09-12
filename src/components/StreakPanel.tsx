import { useMemo } from 'react';
import { Flame, Trophy, CheckCircle2, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Todo } from '@/types/todo';
import { getCategoryConfig } from '@/types/todo';

interface StreakPanelProps {
  todos: Todo[];
  listName: string;
}

function getLocalDateStr(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getTodayStr(): string {
  return getLocalDateStr(Date.now());
}

function getDayLabel(dateStr: string): string {
  const today = getTodayStr();
  const d = new Date(dateStr + 'T00:00:00');
  if (dateStr === today) return 'Today';
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = getLocalDateStr(yesterday.getTime());
  if (dateStr === yStr) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

interface DayData {
  dateStr: string;
  count: number;
  completions: Todo[];
}

export function StreakPanel({ todos, listName }: StreakPanelProps) {
  const doneTodos = useMemo(
    () => todos.filter((t) => t.status === 'done' && t.completedAt),
    [todos]
  );

  // Build last-14-days data
  const days = useMemo((): DayData[] => {
    const result: DayData[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = getLocalDateStr(d.getTime());
      const completions = doneTodos.filter(
        (t) => getLocalDateStr(t.completedAt!) === dateStr
      );
      result.push({ dateStr, count: completions.length, completions });
    }
    return result;
  }, [doneTodos]);

  // Current streak (consecutive days ending today with at least 1 completion)
  const currentStreak = useMemo(() => {
    const today = getTodayStr();
    let streak = 0;
    // Walk backwards from today
    for (let i = 0; i < 365; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = getLocalDateStr(d.getTime());
      const hasCompletion = doneTodos.some((t) => getLocalDateStr(t.completedAt!) === dateStr);
      if (hasCompletion) {
        streak++;
      } else if (dateStr === today) {
        // Today with no completions — streak not broken yet, just 0 for today
        continue;
      } else {
        break;
      }
    }
    return streak;
  }, [doneTodos]);

  // Longest streak
  const longestStreak = useMemo(() => {
    if (doneTodos.length === 0) return 0;
    const dateSet = new Set(doneTodos.map((t) => getLocalDateStr(t.completedAt!)));
    const sortedDates = Array.from(dateSet).sort();
    let longest = 0;
    let current = 1;
    for (let i = 1; i < sortedDates.length; i++) {
      const prev = new Date(sortedDates[i - 1] + 'T00:00:00');
      const curr = new Date(sortedDates[i] + 'T00:00:00');
      const diffDays = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        current++;
        longest = Math.max(longest, current);
      } else {
        current = 1;
      }
    }
    return Math.max(longest, current);
  }, [doneTodos]);

  const totalDone = doneTodos.length;
  const maxCount = Math.max(...days.map((d) => d.count), 1);

  // Recent completions (last 5, newest first)
  const recentCompletions = useMemo(
    () =>
      [...doneTodos]
        .filter((t) => t.completedAt)
        .sort((a, b) => b.completedAt! - a.completedAt!)
        .slice(0, 5),
    [doneTodos]
  );

  if (totalDone === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 animate-fade-in">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="size-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Progress</span>
        </div>
        <div className="flex flex-col items-center py-6 text-center">
          <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-primary/10">
            <Flame className="size-5 text-primary/50" />
          </div>
          <p className="text-sm font-medium text-foreground">No completions yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Complete your first task in {listName} to start your streak.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="size-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Progress</span>
        </div>
        <span className="text-xs text-muted-foreground">{listName}</span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col items-center rounded-xl bg-muted/40 px-3 py-2.5">
          <div className="flex items-center gap-1 mb-0.5">
            <Flame
              className={cn(
                'size-3.5',
                currentStreak > 0 ? 'text-primary' : 'text-muted-foreground/40'
              )}
            />
            <span
              className={cn(
                'text-xl font-bold tabular-nums',
                currentStreak > 0 ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {currentStreak}
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground text-center leading-tight">
            Day streak
          </span>
        </div>

        <div className="flex flex-col items-center rounded-xl bg-muted/40 px-3 py-2.5">
          <div className="flex items-center gap-1 mb-0.5">
            <Trophy className="size-3.5 text-amber-500" />
            <span className="text-xl font-bold tabular-nums text-foreground">{longestStreak}</span>
          </div>
          <span className="text-[10px] text-muted-foreground text-center leading-tight">
            Best streak
          </span>
        </div>

        <div className="flex flex-col items-center rounded-xl bg-muted/40 px-3 py-2.5">
          <div className="flex items-center gap-1 mb-0.5">
            <CheckCircle2 className="size-3.5 text-primary" />
            <span className="text-xl font-bold tabular-nums text-foreground">{totalDone}</span>
          </div>
          <span className="text-[10px] text-muted-foreground text-center leading-tight">
            Total done
          </span>
        </div>
      </div>

      {/* 14-day activity chart */}
      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">
          Last 14 days
        </p>
        <div className="flex items-end gap-1 h-10">
          {days.map((day) => {
            const heightPct = day.count === 0 ? 0 : Math.max(15, (day.count / maxCount) * 100);
            const isToday = day.dateStr === getTodayStr();
            return (
              <div
                key={day.dateStr}
                className="flex-1 flex flex-col items-center justify-end gap-0.5 group relative"
                title={`${getDayLabel(day.dateStr)}: ${day.count} completed`}
              >
                <div
                  className={cn(
                    'w-full rounded-sm transition-all duration-300',
                    day.count === 0
                      ? 'bg-muted/60 h-1'
                      : isToday
                      ? 'bg-primary'
                      : 'bg-primary/50 group-hover:bg-primary/70'
                  )}
                  style={{ height: day.count === 0 ? '4px' : `${heightPct}%` }}
                />
                {isToday && (
                  <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />
                )}
              </div>
            );
          })}
        </div>
        <div className="flex justify-between mt-4 text-[9px] text-muted-foreground/60">
          <span>14d ago</span>
          <span>Today</span>
        </div>
      </div>

      {/* Recent completions timeline */}
      {recentCompletions.length > 0 && (
        <div>
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2.5">
            Recent completions
          </p>
          <div className="space-y-2">
            {recentCompletions.map((todo, i) => {
              const catConfig = getCategoryConfig(todo.category);
              return (
                <div
                  key={todo.id}
                  className="flex items-start gap-2.5 animate-slide-up"
                  style={{ animationDelay: `${i * 40}ms`, animationFillMode: 'both' }}
                >
                  {/* Timeline dot + line */}
                  <div className="flex flex-col items-center flex-shrink-0 mt-1">
                    <div className="size-1.5 rounded-full bg-primary/60" />
                    {i < recentCompletions.length - 1 && (
                      <div className="w-px flex-1 bg-border/60 mt-1" style={{ minHeight: '16px' }} />
                    )}
                  </div>

                  <div className="flex-1 min-w-0 pb-1">
                    <p className="text-xs font-medium text-foreground leading-snug truncate">
                      {todo.text}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {catConfig && (
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-1.5 py-0 text-[9px] font-medium',
                            catConfig.color
                          )}
                        >
                          {catConfig.label}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground/70">
                        {getDayLabel(getLocalDateStr(todo.completedAt!))} · {formatTime(todo.completedAt!)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
