/**
 * One task in the list view: a row on flat ground, not a card.
 *
 * Left to right: drag grip (on hover) → status → text → Next → reminder bell →
 * due chip → category chip → overflow menu (on hover). The text is its own
 * button that opens the detail panel, so the row never nests one interactive
 * element inside another.
 */
import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Bell, BellOff, FileText, GripVertical, MoreHorizontal, PanelRightOpen, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusBox } from '@/components/ui/status-box';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getCategoryConfig } from '@/types/todo';
import type { Todo, TodoStatus } from '@/types/todo';
import { DUE_TONE_CLASS, dueTone, getDueInfo } from '@/lib/dueInfo';
import { NEXT_STATUS } from '@/lib/taskStatus';
import { isNotificationSupported } from '@/lib/notifications';

export interface TaskRowProps {
  todo: Todo;
  index: number;
  isNext: boolean;
  /** Drag is off while filters are active: reordering a filtered subset would scramble the hidden tasks. */
  dragDisabled?: boolean;
  onStatusChange: (id: string, status: TodoStatus) => void;
  onDelete: (id: string) => void;
  onOpen: (todo: Todo) => void;
  onToggleReminder?: (id: string, enabled: boolean) => void;
  notificationPermission?: NotificationPermission;
  /** Opens the note a task was added from. */
  onOpenNote?: (noteId: string) => void;
}

const CHIP = 'inline-flex items-center rounded-full px-[11px] py-1 text-[12.5px] leading-none whitespace-nowrap';

const HOVER_BUTTON = cn(
  'flex size-5 items-center justify-center rounded-[7px] text-a-faint transition-[opacity,background-color,color] duration-150',
  'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100',
  'hover:bg-[color-mix(in_srgb,var(--a-ink)_9%,transparent)] hover:text-a-ink',
);

export function TaskRow({
  todo,
  index,
  isNext,
  dragDisabled = false,
  onStatusChange,
  onDelete,
  onOpen,
  onToggleReminder,
  notificationPermission,
  onOpenNote,
}: TaskRowProps) {
  const [deleting, setDeleting] = useState(false);
  const isDone = todo.status === 'done';
  const next = NEXT_STATUS[todo.status];
  const category = getCategoryConfig(todo.category);
  const due = isDone ? null : getDueInfo(todo.dueDate, todo.dueTime);
  const canToggleReminder =
    !isDone && !!todo.dueDate && !!onToggleReminder &&
    isNotificationSupported() && notificationPermission === 'granted';

  const canDrag = !isDone && !dragDisabled;
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({ id: todo.id, disabled: !canDrag });

  const handleDelete = () => {
    setDeleting(true);
    // Let the exit animation finish before the row leaves the list.
    setTimeout(() => onDelete(todo.id), 300);
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        animationDelay: `${index * 60}ms`,
        animationFillMode: 'both',
      }}
      className={cn(
        'group relative flex items-start gap-[11px] rounded-[14px] px-3 py-2.5 animate-slide-up',
        'transition-[background-color,box-shadow,opacity,scale] duration-300',
        isDragging
          ? 'z-10 bg-a-bg shadow-[var(--a-shadow-md)]'
          : isNext && !isDone
            ? 'bg-a-bg shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--a-accent)_35%,transparent)]'
            : 'hover:bg-a-row-hover',
        deleting && 'scale-[0.98] opacity-0',
      )}
    >
      {canDrag ? (
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Reorder “${todo.text}”`}
          className={cn(HOVER_BUTTON, 'mt-0.5 flex-shrink-0 cursor-grab active:cursor-grabbing')}
        >
          <GripVertical className="size-3.5" strokeWidth={2.75} />
        </button>
      ) : (
        <span className="size-5 flex-shrink-0" aria-hidden />
      )}

      <span className="mt-[2px] flex flex-shrink-0">
        <StatusBox
          state={todo.status}
          label={todo.text}
          disabled={!next}
          onClick={() => { if (next) onStatusChange(todo.id, next); }}
          className={cn(!next && 'cursor-default')}
        />
      </span>

      <button
        type="button"
        onClick={() => onOpen(todo)}
        className={cn(
          'min-w-0 flex-1 text-left text-[15.5px] leading-[1.5] break-words',
          isDone ? 'text-a-faint line-through decoration-[1.5px]' : 'text-a-ink',
        )}
      >
        {todo.text}
      </button>

      <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2 self-center">
        {isNext && !isDone && (
          <span className="text-[11.5px] font-bold uppercase tracking-[0.06em] text-a-accent-700">Next</span>
        )}

        {todo.reminderEnabled && todo.dueDate && !isDone && (
          <span title="Reminder set" className="flex text-a-accent-700">
            <Bell className="size-3.5" strokeWidth={2.75} aria-hidden />
            <span className="sr-only">Reminder set</span>
          </span>
        )}

        {due && <span className={cn(CHIP, DUE_TONE_CLASS[dueTone(due)])}>{due.label}</span>}

        {todo.sourceNoteId && onOpenNote && (
          <button
            type="button"
            onClick={() => onOpenNote(todo.sourceNoteId!)}
            title="Open the note this came from"
            aria-label={`Open the note “${todo.text}” came from`}
            className={cn(CHIP, 'gap-1 text-a-muted shadow-[inset_0_0_0_1px_var(--a-line)] transition-colors duration-150 hover:text-a-ink')}
          >
            <FileText className="size-3" strokeWidth={2.75} aria-hidden /> Note
          </button>
        )}

        {category && (
          <span className={cn(CHIP, 'text-a-muted shadow-[inset_0_0_0_1px_var(--a-line)]')}>
            {category.label}
          </span>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={HOVER_BUTTON} aria-label={`Options for “${todo.text}”`}>
              <MoreHorizontal className="size-3.5" strokeWidth={2.75} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => onOpen(todo)}>
              <PanelRightOpen className="size-3.5" /> Open details
            </DropdownMenuItem>
            {canToggleReminder && (
              <DropdownMenuItem onClick={() => onToggleReminder!(todo.id, !todo.reminderEnabled)}>
                {todo.reminderEnabled ? <BellOff className="size-3.5" /> : <Bell className="size-3.5" />}
                {todo.reminderEnabled ? 'Turn reminder off' : 'Turn reminder on'}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={handleDelete}>
              <Trash2 className="size-3.5" /> Delete task
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
