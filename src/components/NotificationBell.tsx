/**
 * NotificationBell.tsx
 * Header bell icon with unread badge. Opens a dropdown listing
 * active in-app notifications grouped by missed/upcoming.
 */

import React from 'react';
import { Bell, BellRing, X, CheckCheck, AlertCircle, Clock, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { NotificationRecord } from '@/types/todo';
import { QUADRANTS } from '@/types/todo';

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

function getQuadrantLabel(quadrant: string): string {
  return QUADRANTS.find((q) => q.id === quadrant)?.label ?? quadrant;
}

// ── Notification item ────────────────────────────────────────────────────────

interface NotifItemProps {
  record: NotificationRecord;
  onDismiss: (id: string) => void;
  onNavigate?: (taskId: string) => void;
}

function NotifItem({ record, onDismiss, onNavigate }: NotifItemProps) {
  const isMissed = record.type === 'missed';

  return (
    <div
      className={cn(
        'group relative flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors duration-150',
        isMissed
          ? 'bg-destructive/5 hover:bg-destructive/8'
          : 'bg-amber-500/5 hover:bg-amber-500/8'
      )}
    >
      {/* Icon */}
      <div
        className={cn(
          'mt-0.5 flex size-7 flex-shrink-0 items-center justify-center rounded-lg',
          isMissed ? 'bg-destructive/15' : 'bg-amber-500/15'
        )}
      >
        {isMissed ? (
          <AlertCircle className={cn('size-3.5', 'text-destructive')} />
        ) : (
          <Clock className="size-3.5 text-amber-600 dark:text-amber-400" />
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground leading-snug line-clamp-2">
          {record.taskText}
        </p>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          <span
            className={cn(
              'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
              isMissed
                ? 'bg-destructive/15 text-destructive'
                : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
            )}
          >
            {isMissed
              ? 'Missed'
              : record.minutesBefore !== undefined
              ? `Due in ~${record.minutesBefore}m`
              : 'Due soon'}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {getQuadrantLabel(record.quadrant)}
          </span>
          <span className="text-[10px] text-muted-foreground/60">
            {formatRelativeTime(record.triggeredAt)}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        {onNavigate && (
          <button
            onClick={() => onNavigate(record.taskId)}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150"
            aria-label="Go to task"
          >
            <ChevronRight className="size-3.5" />
          </button>
        )}
        <button
          onClick={() => onDismiss(record.id)}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150"
          aria-label="Dismiss notification"
        >
          <X className="size-3.5" />
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
  const missed = active.filter((r) => r.type === 'missed');
  const upcoming = active.filter((r) => r.type === 'upcoming');
  const hasAny = active.length > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} active)` : ''}`}
          className={cn(
            'size-8 rounded-lg transition-colors duration-150 relative',
            hasAny
              ? 'text-amber-600 dark:text-amber-400 bg-amber-500/10 hover:bg-amber-500/15'
              : 'text-muted-foreground hover:text-foreground',
            className
          )}
        >
          {hasAny ? <BellRing className="size-4" /> : <Bell className="size-4" />}
          {unreadCount > 0 && (
            <span
              className={cn(
                'absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full text-[9px] font-bold leading-none',
                missed.length > 0
                  ? 'bg-destructive text-destructive-foreground'
                  : 'bg-amber-500 text-white'
              )}
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-80 p-0 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <BellRing className="size-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-foreground">Reminders</span>
            {unreadCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {unreadCount}
              </span>
            )}
          </div>
          {hasAny && (
            <button
              onClick={onDismissAll}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors duration-150"
            >
              <CheckCheck className="size-3" />
              Dismiss all
            </button>
          )}
        </div>

        {/* Notification list */}
        <div className="max-h-80 overflow-y-auto">
          {!hasAny ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 px-4 text-center">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                <Bell className="size-4 text-muted-foreground" />
              </div>
              <p className="text-xs font-medium text-foreground">All clear</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                No active reminders. Enable reminders on tasks with due dates to get notified.
              </p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {/* Missed section */}
              {missed.length > 0 && (
                <div className="space-y-1">
                  <p className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-widest text-destructive/70">
                    Missed · {missed.length}
                  </p>
                  {missed.map((r) => (
                    <NotifItem
                      key={r.id}
                      record={r}
                      onDismiss={onDismiss}
                      onNavigate={onNavigateToTask}
                    />
                  ))}
                </div>
              )}

              {/* Upcoming section */}
              {upcoming.length > 0 && (
                <div className="space-y-1">
                  <p className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-widest text-amber-600/70 dark:text-amber-400/70">
                    Upcoming · {upcoming.length}
                  </p>
                  {upcoming.map((r) => (
                    <NotifItem
                      key={r.id}
                      record={r}
                      onDismiss={onDismiss}
                      onNavigate={onNavigateToTask}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer hint */}
        {hasAny && (
          <div className="border-t border-border px-4 py-2">
            <p className="text-[10px] text-muted-foreground/60">
              Enable reminders per-task in the task detail panel
            </p>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
