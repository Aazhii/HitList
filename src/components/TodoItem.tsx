import React, { useState } from 'react';
import { Check, Circle, Loader2, Trash2, ChevronRight, Pencil, CalendarClock, AlertCircle, GripVertical } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { getCategoryConfig } from '@/types/todo';
import type { Todo, TodoStatus } from '@/types/todo';

interface TodoItemProps {
  todo: Todo;
  isNext: boolean;
  onStatusChange: (id: string, status: TodoStatus) => void;
  onDelete: (id: string) => void;
  onEdit: (todo: Todo) => void;
  index: number;
  isDragDisabled?: boolean;
}

const statusConfig: Record<TodoStatus, { icon: React.ReactNode; label: string; next: TodoStatus | null }> = {
  todo: {
    icon: <Circle className="size-5 text-muted-foreground" />,
    label: 'To do',
    next: 'in-progress',
  },
  'in-progress': {
    icon: <Loader2 className="size-5 text-primary animate-spin" />,
    label: 'In progress',
    next: 'done',
  },
  done: {
    icon: <Check className="size-5 text-primary" />,
    label: 'Done',
    next: null,
  },
};

function getTodayMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDueDate(dueDate: string): { label: string; isOverdue: boolean; isToday: boolean } {
  const due = new Date(dueDate + 'T00:00:00');
  const today = getTodayMidnight();
  const diffMs = due.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return { label: `${Math.abs(diffDays)}d overdue`, isOverdue: true, isToday: false };
  if (diffDays === 0) return { label: 'Due today', isOverdue: false, isToday: true };
  if (diffDays === 1) return { label: 'Due tomorrow', isOverdue: false, isToday: false };
  if (diffDays <= 7) return { label: `Due in ${diffDays}d`, isOverdue: false, isToday: false };
  const label = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return { label, isOverdue: false, isToday: false };
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function TodoItem({ todo, isNext, onStatusChange, onDelete, onEdit, index, isDragDisabled }: TodoItemProps) {
  const [deleting, setDeleting] = useState(false);
  const config = statusConfig[todo.status];
  const isDone = todo.status === 'done';

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: todo.id, disabled: isDragDisabled || isDone });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const categoryConfig = getCategoryConfig(todo.category);
  const dueDateInfo = todo.dueDate && !isDone ? formatDueDate(todo.dueDate) : null;

  const handleAdvance = () => {
    if (config.next) {
      onStatusChange(todo.id, config.next);
    }
  };

  const handleDelete = () => {
    setDeleting(true);
    setTimeout(() => onDelete(todo.id), 300);
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: style?.transform,
        transition: style?.transition,
        animationDelay: `${index * 60}ms`,
        animationFillMode: 'both',
      }}
      className={cn(
        'group relative flex items-start gap-3 rounded-2xl border p-4 transition-all duration-300',
        'animate-slide-up',
        isDragging
          ? 'border-primary/40 bg-card shadow-lg ring-2 ring-primary/20 opacity-90 z-50'
          : isDone
          ? 'border-border/50 bg-muted/20 opacity-70'
          : isNext
          ? 'border-primary/30 bg-card shadow-sm ring-1 ring-primary/10'
          : 'border-border bg-card hover:border-border/80 hover:shadow-sm',
        deleting && 'scale-95 opacity-0'
      )}
    >
      {/* Drag handle */}
      {!isDone && !isDragDisabled && (
        <button
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          className={cn(
            'mt-0.5 flex-shrink-0 flex items-center justify-center size-5 rounded cursor-grab active:cursor-grabbing',
            'text-muted-foreground/30 hover:text-muted-foreground/70 transition-colors duration-150',
            'opacity-0 group-hover:opacity-100'
          )}
          tabIndex={-1}
        >
          <GripVertical className="size-4" />
        </button>
      )}
      {/* Spacer when drag handle hidden */}
      {(isDone || isDragDisabled) && <div className="size-5 flex-shrink-0" />}

      {/* Status toggle button */}
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

      {/* Content */}
      <div className="min-w-0 flex-1 space-y-1.5">
        {/* Next step indicator */}
        {isNext && !isDone && (
          <span className="flex items-center gap-1 text-xs font-semibold text-primary">
            <ChevronRight className="size-3" />
            Next step
          </span>
        )}

        {/* Task text */}
        <p
          className={cn(
            'text-sm font-medium leading-snug transition-colors duration-200',
            isDone ? 'text-muted-foreground line-through' : 'text-foreground'
          )}
        >
          {todo.text}
        </p>

        {/* Note */}
        {todo.note && (
          <p className="text-xs text-muted-foreground leading-relaxed">{todo.note}</p>
        )}

        {/* Metadata row: category + due date + timestamp */}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {/* Category badge */}
          {categoryConfig && (
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
                categoryConfig.color
              )}
            >
              {categoryConfig.label}
            </span>
          )}

          {/* Due date chip */}
          {dueDateInfo && (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                dueDateInfo.isOverdue
                  ? 'bg-destructive/10 text-destructive'
                  : dueDateInfo.isToday
                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              {dueDateInfo.isOverdue ? (
                <AlertCircle className="size-3" />
              ) : (
                <CalendarClock className="size-3" />
              )}
              {dueDateInfo.label}
            </span>
          )}

          {/* Timestamp */}
          <span className="text-xs text-muted-foreground/70">
            {isDone
              ? `Completed · ${formatRelative(todo.completedAt!)}`
              : todo.status === 'in-progress'
              ? 'In progress…'
              : `Added ${formatRelative(todo.createdAt)}`}
          </span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        {!isDone && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onEdit(todo)}
            aria-label="Edit task"
            className="text-muted-foreground hover:text-foreground"
          >
            <Pencil className="size-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleDelete}
          aria-label="Delete task"
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}
