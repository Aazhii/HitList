/**
 * One task in the list view: a row on flat ground, not a card.
 *
 * Left to right: drag grip (on hover) → status → text → Next → due chip →
 * category chip → overflow menu (on hover). The text is its own
 * button that opens the detail panel, so the row never nests one interactive
 * element inside another.
 */
import { AssigneeChip } from '@/components/tasks/AssigneeChip';
import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FileText, GripVertical, MoreHorizontal, PanelRightOpen, Trash2 } from 'lucide-react';
import { RepeatMark } from '@/components/RepeatMark';
import { cn } from '@/lib/utils';
import { StatusIcon } from '@/components/ui/status-icon';
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
import { WaitingBadge } from '@/components/tasks/WaitingBadge';
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

// DS Tag: 11px / 500, 3px 8px, 6px radius.
const CHIP = 'inline-flex items-center gap-1.5 rounded-[4px] border border-transparent px-2 py-[3px] text-[11px] font-medium whitespace-nowrap';

// Overlaid on the row's right edge, not in the flow: the design's due column is
// flush right (showcase 238) and this appears only on hover.
const HOVER_BUTTON = cn(
  'absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-[4px] bg-a-surface text-a-faint transition-[opacity,background-color,color] duration-[120ms]',
  'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100',
  'hover:bg-a-line-soft hover:text-a-ink',
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
        'group relative flex min-h-[calc(44px+2*var(--a-density))] items-center gap-2.5 border-b border-a-line-soft px-3 animate-slide-up last:border-b-0',
        'transition-[background-color,box-shadow,opacity,scale] duration-[260ms]',
        isDragging ? 'z-10 bg-a-bg shadow-[var(--a-shadow-md)]' : 'hover:bg-a-bg',
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
          className="flex flex-shrink-0 cursor-grab items-center justify-center text-a-line-strong active:cursor-grabbing"
        >
          <GripVertical className="size-3.5" strokeWidth={1.75} />
        </button>
      ) : (
        <span className="size-3.5 flex-shrink-0" aria-hidden />
      )}

      <StatusIcon
        status={todo.status}
        label={todo.text}
        disabled={!next}
        onClick={() => { if (next) onStatusChange(todo.id, next); }}
      />

      <button
        type="button"
        onClick={() => onOpen(todo)}
        className={cn(
          'min-w-0 flex-1 truncate text-left text-[13px] font-medium',
          isDone ? 'text-a-faint line-through decoration-[1.5px]' : 'text-a-ink',
        )}
      >
        {todo.text}
      </button>

      {isNext && !isDone && (
        // design-check-ignore: pill — the DS Badge is a pill (showcase 235).
        <span className="flex-shrink-0 rounded-full border border-transparent bg-a-blue-tint px-2 py-[3px] text-[11px] font-semibold leading-none text-a-accent-700">
          Next up
        </span>
      )}

      <AssigneeChip userId={todo.assigneeUserId} name={todo.assigneeName} className="flex-shrink-0" />

      {todo.sourceNoteId && onOpenNote && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenNote(todo.sourceNoteId!); }}
          title="Open the note this came from"
          aria-label={`Open the note “${todo.text}” came from`}
          className="flex flex-shrink-0 items-center gap-1 text-[12px] text-a-accent-600"
        >
          <FileText className="size-3" strokeWidth={1.75} aria-hidden /> Note
        </button>
      )}

      {category && (
        <span className={cn(CHIP, 'flex-shrink-0 border-a-line text-a-muted')}>
          <span className={cn('size-2 flex-shrink-0 rounded-[3px]', category.swatchClass)} aria-hidden />
          {category.label}
        </span>
      )}

      {todo.status !== 'done' && <WaitingBadge taskId={todo.id} className="flex-shrink-0" />}
      {fieldDefs && <FieldChips fields={fieldDefs} values={fieldValues} chipClass={CHIP} />}

      {/* Fixed 120px, right-aligned — showcase 238. */}
      <span className={cn('w-[120px] flex-shrink-0 whitespace-nowrap text-right text-[12px]', due ? DUE_TONE_CLASS[dueTone(due)] : '')}>
        {due?.label}{due && <RepeatMark recurrence={todo.recurrence} />}
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
