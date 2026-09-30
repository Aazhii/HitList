import { useMemo, useState } from 'react';
import { CircleCheck, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { topBarSubtle } from '@/components/shell/TopBar';
import { getQuadrantConfig } from '@/types/todo';
import type { Todo } from '@/types/todo';
import type { ApiTask } from '@/lib/api';

interface TodayHistoryPanelProps {
  open: boolean;
  todos: Todo[];
  /** When provided (server online), use server-backed today-history instead of local computation. */
  serverHistory?: ApiTask[];
  onClose: () => void;
  /** Reverts a completion made by mistake; the task returns to its quadrant. */
  onUndo?: (id: string) => Promise<void> | void;
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

/** "9:12 AM" — the row's second line (showcase 1052). */
function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function TodayHistoryPanel({ open, todos, serverHistory, onClose, onUndo }: TodayHistoryPanelProps) {
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

  if (!open) return null;

  // Showcase 1048–1056: a 400px peek panel under the chrome — no scrim, the page stays live.
  return (
    <aside
      role="dialog"
      aria-label="Today's history"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      className="fixed top-[52px] right-0 bottom-0 z-40 flex w-[400px] max-w-full flex-col border-l border-a-line bg-a-surface text-[13px] leading-normal text-a-ink shadow-[var(--a-shadow-xl)] animate-in slide-in-from-right duration-[260ms]"
    >
      <header className="flex items-center gap-2 border-b border-a-line px-4 py-3">
        <h2 className="text-[18px] leading-[1.35] font-semibold">Today</h2>
        {/* design-check-ignore: pill — the DS Badge is a pill (showcase 1050). */}
        <span className="rounded-full border border-transparent bg-a-green-tint px-2 py-[3px] text-[11px] leading-none font-semibold text-a-green-ink">
          {todayDone.length} completed
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex size-7 items-center justify-center rounded-[4px] text-a-muted transition-colors duration-[120ms] hover:bg-a-line-soft hover:text-a-ink active:bg-a-line"
        >
          <X className="size-4" strokeWidth={1.75} />
        </button>
      </header>

      <div className="flex-1 overflow-auto px-4 py-2">
        {todayDone.length === 0 ? (
          <p className="py-10 text-center text-a-faint">Nothing completed yet. Finish a task and it will appear here.</p>
        ) : (
          todayDone.map((todo) => <TaskRow key={todo.id} todo={todo} onUndo={onUndo} />)
        )}
      </div>

      <footer className="border-t border-a-line px-4 py-3 text-a-faint">
        Undo moves a task back to the quadrant it came from.
      </footer>
    </aside>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TaskRow({ todo, onUndo }: {
  todo: Todo;
  onUndo?: (id: string) => Promise<void> | void;
}) {
  const qConfig = getQuadrantConfig(todo.quadrant);
  const [undoing, setUndoing] = useState(false);
  const completedTs = todo.completedAt ?? todo.createdAt;

  return (
    <div className="flex items-center gap-2.5 border-b border-a-line-soft py-3">
      <CircleCheck className="size-[18px] flex-shrink-0 text-a-dq-valid" strokeWidth={1.75} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{todo.text}</div>
        <div className="text-[12px] text-a-faint">{qConfig.label} · {formatTime(completedTs)}</div>
      </div>
      {onUndo && (
        <button
          type="button"
          disabled={undoing}
          onClick={async () => {
            setUndoing(true);
            try { await onUndo(todo.id); } finally { setUndoing(false); }
          }}
          aria-label={`Undo completing ${todo.text}`}
          title="Not done yet? Put it back in its quadrant"
          className={cn(topBarSubtle, 'disabled:opacity-50')}
        >
          {undoing ? 'Undoing…' : 'Undo'}
        </button>
      )}
    </div>
  );
}
