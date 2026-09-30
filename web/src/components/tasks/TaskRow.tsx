/**
 * One task in the list view: a row on flat ground, not a card.
 *
 * Left to right: drag grip (on hover) → status → text → Next → due chip →
 * category chip → overflow menu (on hover). The text is its own
 * button that opens the detail panel, so the row never nests one interactive
 * element inside another.
 */
import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FileText, GripVertical, MoreHorizontal, PanelRightOpen, Trash2 } from 'lucide-react';
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
import { FieldChips } from '@/components/fields/FieldChips';
import type { FieldDef, FieldValue } from '@/types/fields';

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
  /** Custom fields, and this task's values; fields marked "Show on card" become chips. */
  fieldDefs?: FieldDef[];
  fieldValues?: Record<string, FieldValue>;
}

const CHIP = 'inline-flex items-center rounded-[3px] px-[11px] py-1 text-[12px] leading-none whitespace-nowrap';

const HOVER_BUTTON = cn(
  'flex size-5 flex-shrink-0 items-center justify-center rounded-[6px] text-a-faint transition-[opacity,background-color,color] duration-[120ms]',
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
  onOpenNote,
  fieldDefs,
  fieldValues,
}: TaskRowProps) {
  const [deleting, setDeleting] = useState(false);
  const isDone = todo.status === 'done';
  const next = NEXT_STATUS[todo.status];
  const category = getCategoryConfig(todo.category);
  const due = isDone ? null : getDueInfo(todo.dueDate, todo.dueTime);

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
        'group relative flex min-h-11 items-center gap-2.5 border-b border-a-line-soft px-3 animate-slide-up last:border-b-0',
        'transition-[background-color,box-shadow,opacity,scale] duration-[260ms]',
        isDragging
          ? 'z-10 bg-a-bg shadow-[var(--a-shadow-md)]'
          : isNext && !isDone
            ? 'bg-a-bg shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--a-accent)_35%,transparent)]'
            : 'hover:bg-a-row-hover',
        deleting && 'scale-[0.98] opacity-0',
      )}
    >
      {/* Always visible, --gray-300 — showcase 231. Not a hover-reveal: the
          design shows the grip on every row, all the time. */}
      {canDrag ? (
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Reorder “${todo.text}”`}
          className="flex flex-shrink-0 cursor-grab items-center justify-center text-a-line active:cursor-grabbing"
        >
          <GripVertical className="size-3.5" strokeWidth={1.75} />
        </button>
      ) : (
        <span className="size-3.5 flex-shrink-0" aria-hidden />
      )}

      <StatusBox
        state={todo.status}
        label={todo.text}
        disabled={!next}
        onClick={() => { if (next) onStatusChange(todo.id, next); }}
        className={cn('flex-shrink-0', !next && 'cursor-default')}
      />

      <button
        type="button"
        onClick={() => onOpen(todo)}
        className={cn(
          'min-w-0 flex-1 truncate text-left text-[14px] font-medium',
          isDone ? 'text-a-faint line-through decoration-[1.5px]' : 'text-a-ink',
        )}
      >
        {todo.text}
      </button>

      {isNext && !isDone && (
        <span className="flex-shrink-0 rounded-[3px] bg-a-accent-tint px-2 py-[3px] text-[11px] font-bold text-a-accent-700">
          Next up
        </span>
      )}

      {todo.sourceNoteId && onOpenNote && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenNote(todo.sourceNoteId!); }}
          title="Open the note this came from"
          aria-label={`Open the note “${todo.text}” came from`}
          className="flex flex-shrink-0 items-center gap-1 text-[12px] text-a-accent-700"
        >
          <FileText className="size-3" strokeWidth={1.75} aria-hidden /> Note
        </button>
      )}

      {category && (
        <span className={cn(CHIP, 'flex-shrink-0 text-a-muted shadow-[inset_0_0_0_1px_var(--a-line)]')}>
          {category.label}
        </span>
      )}

      {fieldDefs && <FieldChips fields={fieldDefs} values={fieldValues} chipClass={CHIP} />}

      {/* Fixed 120px, right-aligned — showcase 238. */}
      <span className={cn('w-[120px] flex-shrink-0 whitespace-nowrap text-right text-[12px]', due ? DUE_TONE_CLASS[dueTone(due)] : '')}>
        {due?.label}
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={HOVER_BUTTON} aria-label={`Options for “${todo.text}”`}>
            <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => onOpen(todo)}>
            <PanelRightOpen className="size-3.5" /> Open details
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={handleDelete}>
            <Trash2 className="size-3.5" /> Delete task
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
