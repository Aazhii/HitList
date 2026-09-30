/**
 * NotificationBell.tsx
 * The header bell (showcase 1099–1103): a 360px panel under it — "Notifications", "Mark all read",
 * one row per reminder (a tone dot, the task, a grey line saying missed or upcoming), and a footer.
 * Opening it tints the bell.
 */

import { Bell, BellRing, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { NotificationRecord } from '@/types/todo';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeTime(ms: number): string {
  const diffMs = Date.now() - ms;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return `${Math.floor(diffHrs / 24)}d ago`;
}

/** "Missed · 2h ago", "Upcoming · due in 25 minutes". */
function describe(record: NotificationRecord): string {
  if (record.detail) return record.detail;
  if (record.type === 'missed') return `Missed · ${formatRelativeTime(record.triggeredAt)}`;
  return record.minutesBefore !== undefined
    ? `Upcoming · due in ${record.minutesBefore} minute${record.minutesBefore === 1 ? '' : 's'}`
    : 'Upcoming · due soon';
}

const ROW_ACTION = 'flex size-6 items-center justify-center rounded-[4px] text-a-faint transition-colors duration-[120ms] hover:bg-a-line-soft hover:text-a-ink';

// ── Notification row ─────────────────────────────────────────────────────────

interface NotifItemProps {
  record: NotificationRecord;
  onDismiss: (id: string) => void;
  onNavigate?: (taskId: string) => void;
}

function NotifItem({ record, onDismiss, onNavigate }: NotifItemProps) {
  const missed = record.type === 'missed';

  return (
    <div className="group relative flex gap-2.5 border-b border-a-line-soft px-4 py-3 transition-colors duration-[120ms] hover:bg-a-bg">
      <span
        className={cn('mt-[5px] size-2 flex-none rounded-full', missed ? 'bg-q-do-dot' : 'bg-[var(--a-dot-orange)]')}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{record.taskText}</div>
        <div className="mt-0.5 text-[12px] text-a-faint">{describe(record)}</div>
      </div>

      {/* Not in the prototype's rows; shown on hover so a reminder can be opened or cleared alone. */}
      <div className="flex flex-shrink-0 items-start gap-0.5 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 focus-within:opacity-100">
        {onNavigate && (
          <button type="button" onClick={() => onNavigate(record.taskId)} className={ROW_ACTION} aria-label="Go to task">
            <ChevronRight className="size-4" strokeWidth={1.75} />
          </button>
        )}
        <button type="button" onClick={() => onDismiss(record.id)} className={ROW_ACTION} aria-label="Dismiss notification">
          <X className="size-4" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

interface NotificationBellProps {
  notifications: NotificationRecord[];
  unreadCount: number;
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
  onNavigateToTask?: (taskId: string) => void;
  className?: string;
}

export function NotificationBell({
  notifications,
  unreadCount,
  onDismiss,
  onDismissAll,
  onNavigateToTask,
  className,
}: NotificationBellProps) {
  const active = notifications.filter((r) => !r.dismissed);
  // Missed first, then what is coming up: the order they need attention in.
  const ordered = [...active.filter((r) => r.type === 'missed'), ...active.filter((r) => r.type === 'upcoming')];
  const hasAny = ordered.length > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} active)` : ''}`}
          className={cn(
            'relative flex size-7 flex-shrink-0 items-center justify-center rounded-[4px] transition-colors duration-[120ms]',
            'text-a-muted hover:bg-a-row-hover hover:text-a-ink data-[state=open]:bg-a-blue-tint data-[state=open]:text-a-accent',
            className,
          )}
        >
          {hasAny ? <BellRing className="size-4" strokeWidth={1.75} /> : <Bell className="size-4" strokeWidth={1.75} />}
          {unreadCount > 0 && (
            <span
              // design-check-ignore: pill — a count badge is a pill.
              className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-q-do px-1 text-[11px] leading-none font-bold text-white"
              aria-hidden
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={12}
        aria-label="Notifications"
        className="w-[360px] gap-0 overflow-hidden rounded-[12px] p-0 text-[13px] shadow-[var(--a-shadow-xl)]"
      >
        <div className="flex items-center border-b border-a-line-soft px-4 py-3">
          <span className="text-[14px] font-semibold">Notifications</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onDismissAll}
            disabled={!hasAny}
            className="h-7 rounded-[3px] px-3 text-[11px] font-semibold text-a-muted transition-colors duration-[120ms] hover:bg-a-line-soft disabled:opacity-50"
          >
            Mark all read
          </button>
        </div>

        <div className="max-h-[420px] overflow-y-auto">
          {hasAny ? (
            ordered.map((r) => (
              <NotifItem key={r.id} record={r} onDismiss={onDismiss} onNavigate={onNavigateToTask} />
            ))
          ) : (
            <p className="border-b border-a-line-soft px-4 py-6 text-center text-a-faint">
              All clear. Turn on a reminder in a task's details and it shows up here.
            </p>
          )}
        </div>

        <p className="px-4 py-2.5 text-[12px] text-a-faint">Reminders appear here while HitList is open.</p>
      </PopoverContent>
    </Popover>
  );
}
