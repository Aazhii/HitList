import React, { useState } from 'react';
import {
  Check,
  Circle,
  Loader2,
  Trash2,
  AlertCircle,
  Clock,
  CalendarClock,
  FileText,
  ChevronRight,
  Bell,
  BellOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { getCategoryConfig } from '@/types/todo';
import type { Todo, TodoStatus } from '@/types/todo';
import { isNotificationSupported, getReminderStatus } from '@/lib/notifications';

interface MatrixTaskCardProps {
  todo: Todo;
  isNext: boolean;
  onStatusChange: (id: string, status: TodoStatus) => void;
  onDelete: (id: string) => void;
  onOpen: (todo: Todo) => void;
  onToggleReminder?: (id: string, enabled: boolean) => void;
  index: number;
  notificationPermission?: NotificationPermission;
}

// ── Due-time helpers ────────────────────────────────────────────────────────

export interface DueInfo {
  label: string;
  isOverdue: boolean;
  isUrgentSoon: boolean; // within 2 hours
  isToday: boolean;
}

export function getDueInfo(dueDate?: string, dueTime?: string): DueInfo | null {
  if (!dueDate) return null;

  const now = new Date();
  let dueTs: Date;

  if (dueTime) {
    dueTs = new Date(`${dueDate}T${dueTime}:00`);
  } else {
    // End of day
    dueTs = new Date(`${dueDate}T23:59:59`);
  }

  const diffMs = dueTs.getTime() - now.getTime();
  const diffMins = diffMs / 60000;
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffMs < 0) {
    // Overdue
    const absMins = Math.abs(diffMins);
    if (absMins < 60) return { label: `${Math.round(absMins)}m overdue`, isOverdue: true, isUrgentSoon: false, isToday: false };
    const absHrs = Math.floor(absMins / 60);
    if (absHrs < 24) return { label: `${absHrs}h overdue`, isOverdue: true, isUrgentSoon: false, isToday: false };
    const absDays = Math.floor(absHrs / 24);
    return { label: `${absDays}d overdue`, isOverdue: true, isUrgentSoon: false, isToday: false };
  }

  if (diffMins <= 120 && dueTime) {
    // Urgent soon (within 2 hours, only when time is set)
    if (diffMins < 60) return { label: `${Math.round(diffMins)}m left`, isOverdue: false, isUrgentSoon: true, isToday: true };
    return { label: `${Math.floor(diffMins / 60)}h ${Math.round(diffMins % 60)}m left`, isOverdue: false, isUrgentSoon: true, isToday: true };
  }

  // Today
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const tomorrowMidnight = new Date(todayMidnight);
  tomorrowMidnight.setDate(tomorrowMidnight.getDate() + 1);

  if (dueTs < tomorrowMidnight) {
    if (dueTime) {
      return { label: `Today ${dueTs.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`, isOverdue: false, isUrgentSoon: false, isToday: true };
    }
    return { label: 'Due today', isOverdue: false, isUrgentSoon: false, isToday: true };
  }

  if (diffDays < 2) return { label: 'Due tomorrow', isOverdue: false, isUrgentSoon: false, isToday: false };
  if (diffDays <= 7) return { label: `Due in ${Math.ceil(diffDays)}d`, isOverdue: false, isUrgentSoon: false, isToday: false };

  const label = dueTs.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return { label, isOverdue: false, isUrgentSoon: false, isToday: false };
}

// ── Component ────────────────────────────────────────────────────────────────

const statusConfig: Record<TodoStatus, { icon: React.ReactNode; next: TodoStatus | null }> = {
  todo: { icon: <Circle className="size-4 text-muted-foreground" />, next: 'in-progress' },
  'in-progress': { icon: <Loader2 className="size-4 text-primary animate-spin" />, next: 'done' },
  done: { icon: <Check className="size-4 text-primary" />, next: null },
};

export function MatrixTaskCard({
  todo,
  isNext,
  onStatusChange,
  onDelete,
  onOpen,
  onToggleReminder,
  index,
  notificationPermission,
}: MatrixTaskCardProps) {
  const [deleting, setDeleting] = useState(false);
  const config = statusConfig[todo.status];
  const isDone = todo.status === 'done';
  const categoryConfig = getCategoryConfig(todo.category);
  const dueInfo = !isDone ? getDueInfo(todo.dueDate, todo.dueTime) : null;
  const reminderStatus = !isDone && todo.dueDate ? getReminderStatus(todo) : null;
  const supported = isNotificationSupported();

  const handleAdvance = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (config.next) onStatusChange(todo.id, config.next);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleting(true);
    setTimeout(() => onDelete(todo.id), 280);
  };

  const handleReminderToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!supported || notificationPermission !== 'granted') return;
    onToggleReminder?.(todo.id, !todo.reminderEnabled);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(todo)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(todo)}
      style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'both' }}
      className={cn(
        'group relative flex flex-col gap-2 rounded-xl border p-3 cursor-pointer',
        'animate-slide-up transition-all duration-200',
        'hover:shadow-md hover:border-border/80',
        deleting && 'scale-95 opacity-0 transition-all duration-280',
        isDone
          ? 'border-border/40 bg-muted/20 opacity-60'
          : dueInfo?.isOverdue
          ? 'border-destructive/30 bg-destructive/[0.03] hover:border-destructive/50'
          : dueInfo?.isUrgentSoon
          ? 'border-amber-500/40 bg-amber-500/[0.03] hover:border-amber-500/60'
          : isNext
          ? 'border-primary/30 bg-card shadow-sm ring-1 ring-primary/10'
          : 'border-border bg-card'
      )}
      aria-label={`Open task: ${todo.text}`}
    >
      {/* Urgent-soon pulse ring */}
      {dueInfo?.isUrgentSoon && !isDone && (
        <span className="absolute -top-px -right-px size-2.5 rounded-full bg-amber-500 animate-pulse" />
      )}
      {dueInfo?.isOverdue && !isDone && (
        <span className="absolute -top-px -right-px size-2.5 rounded-full bg-destructive" />
      )}

      {/* Top row: status + text + actions */}
      <div className="flex items-start gap-2">
        {/* Status toggle */}
        <button
          onClick={handleAdvance}
          disabled={isDone}
          aria-label={config.next ? `Mark as ${config.next}` : 'Completed'}
          className={cn(
            'mt-0.5 flex-shrink-0 rounded-full transition-transform duration-150',
            !isDone && 'hover:scale-110 active:scale-95 cursor-pointer',
            isDone && 'cursor-default'
          )}
        >
          {config.icon}
        </button>

        {/* Text */}
        <div className="min-w-0 flex-1">
          {isNext && !isDone && (
            <span className="flex items-center gap-0.5 text-[10px] font-semibold text-primary mb-0.5">
              <ChevronRight className="size-2.5" />
              Next
            </span>
          )}
          <p
            className={cn(
              'text-xs font-medium leading-snug transition-colors duration-200',
              isDone ? 'text-muted-foreground line-through' : 'text-foreground'
            )}
          >
            {todo.text}
          </p>
        </div>

        {/* Action buttons (hover) */}
        <div className="flex flex-shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          {/* Reminder toggle — only when task has a due date and notifications are supported */}
          {!isDone && todo.dueDate && supported && notificationPermission === 'granted' && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleReminderToggle}
              aria-label={todo.reminderEnabled ? 'Disable reminder' : 'Enable reminder'}
              className={cn(
                'size-6 transition-colors duration-150',
                todo.reminderEnabled
                  ? 'text-primary hover:text-primary/70'
                  : 'text-muted-foreground hover:text-primary'
              )}
            >
              {todo.reminderEnabled ? <Bell className="size-3" /> : <BellOff className="size-3" />}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleDelete}
            aria-label="Delete task"
            className="size-6 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </div>

      {/* Bottom row: metadata */}
      <div className="flex flex-wrap items-center gap-1.5 pl-6">
        {/* Category */}
        {categoryConfig && (
          <span
            className={cn(
              'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium',
              categoryConfig.color
            )}
          >
            {categoryConfig.label}
          </span>
        )}

        {/* Due date chip */}
        {dueInfo && (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
              dueInfo.isOverdue
                ? 'bg-destructive/10 text-destructive'
                : dueInfo.isUrgentSoon
                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                : dueInfo.isToday
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                : 'bg-muted text-muted-foreground'
            )}
          >
            {dueInfo.isOverdue ? (
              <AlertCircle className="size-2.5" />
            ) : dueInfo.isUrgentSoon ? (
              <Clock className="size-2.5" />
            ) : (
              <CalendarClock className="size-2.5" />
            )}
            {dueInfo.label}
          </span>
        )}

        {/* Reminder status chip */}
        {!isDone && reminderStatus && reminderStatus !== 'no-reminder' && (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
              reminderStatus === 'overdue'
                ? 'bg-destructive/10 text-destructive'
                : reminderStatus === 'due-soon'
                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                : reminderStatus === 'upcoming'
                ? 'bg-primary/10 text-primary'
                : reminderStatus === 'denied'
                ? 'bg-muted text-muted-foreground'
                : 'bg-muted text-muted-foreground'
            )}
          >
            {reminderStatus === 'overdue' ? (
              <AlertCircle className="size-2.5" />
            ) : reminderStatus === 'due-soon' ? (
              <Bell className="size-2.5 animate-pulse" />
            ) : reminderStatus === 'upcoming' ? (
              <Bell className="size-2.5" />
            ) : (
              <BellOff className="size-2.5" />
            )}
            {reminderStatus === 'overdue'
              ? 'Overdue'
              : reminderStatus === 'due-soon'
              ? 'Due soon'
              : reminderStatus === 'upcoming'
              ? 'Reminder set'
              : reminderStatus === 'denied'
              ? 'Notifs blocked'
              : null}
          </span>
        )}

        {/* Note indicator */}
        {todo.note && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/60">
            <FileText className="size-2.5" />
          </span>
        )}
      </div>
    </div>
  );
}
