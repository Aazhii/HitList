import React, { useState } from 'react';
import { FileText, Trash2 } from 'lucide-react';
import { RepeatMark } from '@/components/RepeatMark';
import { cn } from '@/lib/utils';
import { StatusIcon } from '@/components/ui/status-icon';
import { getCategoryConfig, getQuadrantConfig } from '@/types/todo';
import type { Todo, TodoStatus } from '@/types/todo';
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
  /**
   * 'board' is the Board lane card (showcase 282–293): title and one 12px meta row,
   * no status glyph, no hover controls. Status and delete are in the detail panel.
   */
  variant?: 'matrix' | 'board';
}

// DS Tag: 11px / 500, 3px 8px, 6px radius.
const CHIP = 'inline-flex items-center gap-1.5 rounded-[4px] border border-transparent px-2 py-[3px] text-[11px] font-medium whitespace-nowrap';

const CARD_ACTION = cn(
  'flex size-[22px] items-center justify-center rounded-[6px] text-a-faint transition-[opacity,background-color,color] duration-[120ms]',
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
  index,
  onOpenNote,
  fieldDefs,
  fieldValues,
  variant = 'matrix',
}: MatrixTaskCardProps) {
  const board = variant === 'board';
  const [deleting, setDeleting] = useState(false);
  const isDone = todo.status === 'done';
  const next = NEXT_STATUS[todo.status];
  const categoryConfig = getCategoryConfig(todo.category);
  const dueInfo = !isDone ? getDueInfo(todo.dueDate, todo.dueTime) : null;
  const fromNote = !!todo.sourceNoteId && !!onOpenNote;
  const hasFieldChips = !!fieldDefs && !!fieldValues
    && fieldDefs.some((f) => f.showOnCard && fieldValues[f.id] !== undefined);
  const hasMeta = !!categoryConfig || !!dueInfo || !!todo.note || fromNote || hasFieldChips;

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleting(true);
    setTimeout(() => onDelete(todo.id), 300);
  };

  if (board) {
    // Showcase 282–293: title, then one 12px row — quadrant dot, due, Tag. No status
    // glyph and no hover controls; status and delete live in the detail panel.
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(todo)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(todo); }
        }}
        className={cn(
          'flex cursor-pointer flex-col gap-2 rounded-[8px] border border-a-line bg-a-surface px-3 py-[calc(10px+var(--a-density))]',
          'transition-shadow duration-[120ms] hover:shadow-[var(--a-shadow-md)]',
          isDone && 'opacity-60',
        )}
        aria-label={`Open task: ${todo.text}`}
      >
        <div className={cn('text-[13px] font-medium leading-[1.4]', isDone ? 'text-a-faint line-through' : 'text-a-ink')}>
          {todo.text}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className={cn('size-2 flex-shrink-0 rounded-full', getQuadrantConfig(todo.quadrant).dotClass)} aria-hidden />
          {dueInfo && <span className={cn('whitespace-nowrap', DUE_TONE_CLASS[dueTone(dueInfo)])}>{dueInfo.label}<RepeatMark recurrence={todo.recurrence} /></span>}
          {categoryConfig && (
            <span className={cn(CHIP, 'border-a-line text-a-muted')}>
              <span className={cn('size-2 flex-shrink-0 rounded-[3px]', categoryConfig.swatchClass)} aria-hidden />
              {categoryConfig.label}
            </span>
          )}
          {fieldDefs && <FieldChips fields={fieldDefs} values={fieldValues} chipClass={CHIP} />}
          {fromNote && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpenNote!(todo.sourceNoteId!); }}
              title="Open the note this came from"
              aria-label={`Open the note “${todo.text}” came from`}
              className="inline-flex items-center gap-1 text-a-accent-600"
            >
              <FileText className="size-3" strokeWidth={1.75} aria-hidden /> Note
            </button>
          )}
        </div>
      </div>
    );
  }

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
        'group relative flex cursor-pointer flex-col gap-1.5 rounded-[8px] px-3.5 py-2.5 animate-slide-up',
        'bg-a-bg',
        'transition-[box-shadow,opacity,scale] duration-[260ms] hover:shadow-[var(--a-shadow-sm)]',
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
          <StatusIcon
            status={todo.status}
            label={todo.text}
            disabled={!next}
            onClick={(e) => {
              e.stopPropagation();
              if (next) onStatusChange(todo.id, next);
            }}
          />
        </span>

        <p
          className={cn(
            'min-w-0 flex-1 text-[13px] font-medium leading-[1.4] break-words',
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
          <button type="button" onClick={handleDelete} aria-label="Delete task" className={cn(CARD_ACTION, 'hover:text-q-do')}>
            <Trash2 className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {hasMeta && (
        // Indented to sit under the text, past the 19px status box and its gap.
        <div className="flex flex-wrap items-center gap-1.5 pl-[30px]">
          {dueInfo && (
            <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", DUE_TONE_CLASS[dueTone(dueInfo)])}>
              {dueInfo.label}<RepeatMark recurrence={todo.recurrence} />
            </span>
          )}

          {categoryConfig && (
            <span className={cn(CHIP, 'border-a-line text-a-muted')}>
              <span className={cn('size-2 flex-shrink-0 rounded-[3px]', categoryConfig.swatchClass)} aria-hidden />
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
              className={cn(CHIP, 'border-a-line text-a-muted transition-colors duration-[120ms] hover:text-a-ink')}
            >
              <FileText className="size-3" strokeWidth={1.75} aria-hidden /> Note
            </button>
          )}

          {todo.note && (
            <span className="inline-flex items-center text-a-faint" title="Has a note">
              <FileText className="size-3.5" strokeWidth={1.75} aria-hidden />
              <span className="sr-only">Has a note</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
