import React, { useState } from 'react';
import { AlertCircle, Bell, BellOff, FileText, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusBox } from '@/components/ui/status-box';
import { getCategoryConfig } from '@/types/todo';
import type { Todo, TodoStatus } from '@/types/todo';
import { isNotificationSupported, getReminderStatus } from '@/lib/notifications';
import { DUE_TONE_CLASS, dueTone, getDueInfo } from '@/lib/dueInfo';
import { NEXT_STATUS } from '@/lib/taskStatus';
import { FieldChips } from '@/components/fields/FieldChips';
import type { FieldDef, FieldValue } from '@/types/fields';

// Moved to lib/dueInfo.ts so the list view shares them. Re-exported so existing
// imports from this module keep working.
export { getDueInfo } from '@/lib/dueInfo';
export type { DueInfo } from '@/lib/dueInfo';

interface MatrixTaskCardProps {
  todo: Todo;
  isNext: boolean;
  onStatusChange: (id: string, status: TodoStatus) => void;
  onDelete: (id: string) => void;
  onOpen: (todo: Todo) => void;
  onToggleReminder?: (id: string, enabled: boolean) => void;
  index: number;
  notificationPermission?: NotificationPermission;
  /** Opens the note a task was added from. */
  onOpenNote?: (noteId: string) => void;
  /** Custom fields, and this task's values; fields marked "Show on card" become chips. */
  fieldDefs?: FieldDef[];
  fieldValues?: Record<string, FieldValue>;
}

const CHIP = 'inline-flex items-center gap-1 rounded-full px-2.5 py-[3px] text-[12px] leading-none whitespace-nowrap';

const CARD_ACTION = cn(
  'flex size-[22px] items-center justify-center rounded-[7px] text-a-faint transition-[opacity,background-color,color] duration-150',
  'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
  'hover:bg-[color-mix(in_srgb,var(--a-ink)_9%,transparent)] hover:text-a-ink',
);

/**
 * A task inside a matrix quadrant: a cream card on the quadrant's tint.
 *
 * Uses the same StatusBox as the list row and the note to-do, so a task looks
 * identical wherever it appears.
 */
export function MatrixTaskCard({
  todo,
  isNext,
  onStatusChange,
  onDelete,
  onOpen,
  onToggleReminder,
  index,
  notificationPermission,
  onOpenNote,
  fieldDefs,
  fieldValues,
}: MatrixTaskCardProps) {
  const [deleting, setDeleting] = useState(false);
  const isDone = todo.status === 'done';
  const next = NEXT_STATUS[todo.status];
  const categoryConfig = getCategoryConfig(todo.category);
  const dueInfo = !isDone ? getDueInfo(todo.dueDate, todo.dueTime) : null;
  const reminderStatus = !isDone && todo.dueDate ? getReminderStatus(todo) : null;
  const supported = isNotificationSupported();
  const showReminderChip = !isDone && !!reminderStatus && reminderStatus !== 'no-reminder';
  const fromNote = !!todo.sourceNoteId && !!onOpenNote;
  const hasFieldChips = !!fieldDefs && !!fieldValues
    && fieldDefs.some((f) => f.showOnCard && fieldValues[f.id] !== undefined);
  const hasMeta = !!categoryConfig || !!dueInfo || showReminderChip || !!todo.note || fromNote || hasFieldChips;

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleting(true);
    setTimeout(() => onDelete(todo.id), 300);
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
      onKeyDown={(e) => {
        // Only the card itself: Enter on a button inside it belongs to that button.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(todo);
        }
      }}
      style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'both' }}
      className={cn(
        'group relative flex cursor-pointer flex-col gap-1.5 rounded-[14px] bg-a-bg px-3.5 py-2.5 animate-slide-up',
        'transition-[box-shadow,opacity,scale] duration-300 hover:shadow-[var(--a-shadow-sm)]',
        isDone && 'opacity-60',
        !isDone && dueInfo?.isOverdue
          ? 'shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--a-q-do)_40%,transparent)]'
          : !isDone && isNext && 'shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--a-accent)_35%,transparent)]',
        deleting && 'scale-95 opacity-0',
      )}
      aria-label={`Open task: ${todo.text}`}
    >
      <div className="flex items-start gap-[11px]">
        <span className="mt-[1px] flex flex-shrink-0">
          <StatusBox
            state={todo.status}
            label={todo.text}
            disabled={!next}
            onClick={(e) => {
              e.stopPropagation();
              if (next) onStatusChange(todo.id, next);
            }}
            className={cn(!next && 'cursor-default')}
          />
        </span>

        <p
          className={cn(
            'min-w-0 flex-1 text-[14.5px] leading-[1.45] break-words',
            isDone ? 'text-a-faint line-through decoration-[1.5px]' : 'text-a-ink',
          )}
        >
          {todo.text}
        </p>

        {isNext && !isDone && (
          <span className="mt-[3px] flex-shrink-0 text-[11px] font-bold uppercase tracking-[0.06em] text-a-accent-700">
            Next
          </span>
        )}

        <div className="flex flex-shrink-0 items-center gap-0.5">
          {!isDone && todo.dueDate && supported && notificationPermission === 'granted' && (
            <button
              type="button"
              onClick={handleReminderToggle}
              aria-label={todo.reminderEnabled ? 'Disable reminder' : 'Enable reminder'}
              className={cn(CARD_ACTION, todo.reminderEnabled && 'text-a-accent-700')}
            >
              {todo.reminderEnabled
                ? <Bell className="size-3.5" strokeWidth={2.75} />
                : <BellOff className="size-3.5" strokeWidth={2.75} />}
            </button>
          )}
          <button type="button" onClick={handleDelete} aria-label="Delete task" className={cn(CARD_ACTION, 'hover:text-q-do')}>
            <Trash2 className="size-3.5" strokeWidth={2.75} />
          </button>
        </div>
      </div>

      {hasMeta && (
        // Indented to sit under the text, past the 19px status box and its gap.
        <div className="flex flex-wrap items-center gap-1.5 pl-[30px]">
          {categoryConfig && (
            <span className={cn(CHIP, 'text-a-muted shadow-[inset_0_0_0_1px_var(--a-line)]')}>
              {categoryConfig.label}
            </span>
          )}

          {fieldDefs && <FieldChips fields={fieldDefs} values={fieldValues} chipClass={CHIP} />}

          {fromNote && (
            <button
              type="button"
              onClick={() => onOpenNote!(todo.sourceNoteId!)}
              title="Open the note this came from"
              aria-label={`Open the note “${todo.text}” came from`}
              className={cn(CHIP, 'text-a-muted shadow-[inset_0_0_0_1px_var(--a-line)] transition-colors duration-150 hover:text-a-ink')}
            >
              <FileText className="size-3" strokeWidth={2.75} aria-hidden /> Note
            </button>
          )}

          {dueInfo && (
            <span className={cn(CHIP, DUE_TONE_CLASS[dueTone(dueInfo)])}>
              {dueInfo.isOverdue && <AlertCircle className="size-3" strokeWidth={2.75} aria-hidden />}
              {dueInfo.label}
            </span>
          )}

          {showReminderChip && (
            <span
              className={cn(
                CHIP,
                reminderStatus === 'overdue' || reminderStatus === 'due-soon'
                  ? DUE_TONE_CLASS.urgent
                  : reminderStatus === 'upcoming'
                    ? 'bg-a-accent-tint text-a-accent-700'
                    : DUE_TONE_CLASS.plain,
              )}
            >
              {reminderStatus === 'denied'
                ? <BellOff className="size-3" strokeWidth={2.75} aria-hidden />
                : <Bell className="size-3" strokeWidth={2.75} aria-hidden />}
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

          {todo.note && (
            <span className="inline-flex items-center text-a-faint" title="Has a note">
              <FileText className="size-3.5" strokeWidth={2.75} aria-hidden />
              <span className="sr-only">Has a note</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
