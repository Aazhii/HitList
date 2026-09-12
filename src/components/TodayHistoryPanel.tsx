import { useMemo } from 'react';
import { CheckCircle2, Clock, Sparkles, TrendingUp } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getQuadrantConfig, getCategoryConfig } from '@/types/todo';
import type { Todo } from '@/types/todo';
import type { ApiTask } from '@/lib/api';
import { X } from 'lucide-react';

interface TodayHistoryPanelProps {
  open: boolean;
  todos: Todo[];
  /** When provided (server online), use server-backed today-history instead of local computation. */
  serverHistory?: ApiTask[];
  onClose: () => void;
}

function isTodayTimestamp(ts: number): boolean {
  const d = new Date(ts);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatRelative(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return formatTime(ts);
}

const QUADRANT_ICON: Record<string, string> = {
  do: '🔥',
  schedule: '📅',
  delegate: '🤝',
  eliminate: '🗑️',
};

export function TodayHistoryPanel({ open, todos, serverHistory, onClose }: TodayHistoryPanelProps) {
  // When server history is available, convert ApiTask[] → Todo[] shape for display
  const serverTodayDone = useMemo<Todo[] | null>(() => {
    if (!serverHistory) return null;
    return serverHistory
      .map((t): Todo => ({
        id: t.id,
        text: t.title,
        status: 'done',
        quadrant: t.quadrant.toLowerCase() as Todo['quadrant'],
        createdAt: new Date(t.createdAt).getTime(),
        completedAt: t.completedAt ? new Date(t.completedAt).getTime() : undefined,
        note: t.note ?? undefined,
        dueDate: t.dueDate ?? undefined,
        dueTime: t.dueTime ?? undefined,
        category: t.category ?? undefined,
        listId: t.listId ?? '',
        order: t.taskOrder,
        reminderEnabled: t.reminderEnabled,
        reminderMinutesBefore: t.reminderMinutesBefore ?? undefined,
      }))
      .sort((a, b) => {
        const aTs = a.completedAt ?? a.createdAt;
        const bTs = b.completedAt ?? b.createdAt;
        return bTs - aTs;
      });
  }, [serverHistory]);

  const localTodayDone = useMemo(() => {
    return todos
      .filter((t) => {
        if (t.status !== 'done') return false;
        // Primary: use completedAt timestamp if present
        if (t.completedAt) return isTodayTimestamp(t.completedAt);
        // Graceful fallback for older tasks without completedAt:
        // treat tasks created today that are done as completed today
        return isTodayTimestamp(t.createdAt);
      })
      .sort((a, b) => {
        const aTs = a.completedAt ?? a.createdAt;
        const bTs = b.completedAt ?? b.createdAt;
        return bTs - aTs; // most recent first
      });
  }, [todos]);

  // Prefer server history when available (more accurate completedAt from server)
  const todayDone = serverTodayDone ?? localTodayDone;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full sm:max-w-md flex flex-col p-0 gap-0 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10">
              <TrendingUp className="size-4 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground leading-tight">
                Today's Wins
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {todayDone.length === 0
                  ? 'No tasks completed yet'
                  : `${todayDone.length} task${todayDone.length !== 1 ? 's' : ''} completed today`}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="size-8 rounded-lg text-muted-foreground hover:text-foreground"
            aria-label="Close panel"
          >
            <X className="size-4" />
          </Button>
        </div>

        {/* Body */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-6 py-5 space-y-3">
            {todayDone.length === 0 ? (
              <EmptyState />
            ) : (
              <>
                {todayDone.map((todo, i) => (
                  <TaskRow key={todo.id} todo={todo} index={i} />
                ))}

                {/* Footer summary */}
                <div className="pt-4 border-t border-border/60 flex items-center gap-2">
                  <Sparkles className="size-3.5 text-primary flex-shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    Great work — keep the momentum going!
                  </p>
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TaskRow({ todo, index }: { todo: Todo; index: number }) {
  const qConfig = getQuadrantConfig(todo.quadrant);
  const catConfig = getCategoryConfig(todo.category);
  const completedTs = todo.completedAt ?? todo.createdAt;

  return (
    <div
      className={cn(
        'group relative rounded-xl border border-border bg-background p-4',
        'hover:border-border/80 hover:shadow-sm transition-all duration-200',
        'animate-fade-in',
      )}
      style={{ animationDelay: `${index * 40}ms`, animationFillMode: 'both' }}
    >
      <div className="flex items-start gap-3">
        {/* Check icon */}
        <div className="flex-shrink-0 mt-0.5">
          <CheckCircle2 className="size-4 text-primary" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-2">
          {/* Task title */}
          <p className="text-sm font-medium text-foreground leading-snug line-clamp-2">
            {todo.text}
          </p>

          {/* Meta row */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Quadrant badge */}
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                qConfig.badgeClass,
              )}
            >
              <span>{QUADRANT_ICON[todo.quadrant]}</span>
              {qConfig.label}
            </span>

            {/* Category badge */}
            {catConfig && (
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
                  catConfig.color,
                )}
              >
                {catConfig.label}
              </span>
            )}
          </div>

          {/* Completion time */}
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Clock className="size-3 flex-shrink-0" />
            <span>
              Completed at {formatTime(completedTs)}
              <span className="ml-1 opacity-70">· {formatRelative(completedTs)}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-muted/50">
        <CheckCircle2 className="size-7 text-muted-foreground/40" />
      </div>
      <div className="space-y-1.5">
        <h3 className="text-sm font-semibold text-foreground">Nothing completed yet</h3>
        <p className="text-xs text-muted-foreground max-w-[220px] leading-relaxed">
          Finish your first task today and it'll appear here. Small steps, big progress.
        </p>
      </div>
    </div>
  );
}
