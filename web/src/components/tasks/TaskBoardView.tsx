/**
 * The board: the table's tasks in columns, one per value of a field — each
 * option of a select or multi-select, or Checked / Not checked for a checkbox —
 * then one for tasks with no value. Dragging a card to another column changes
 * the field.
 *
 * The columns come from the filter's group-by field, so a board is saved in a
 * view like any other grouping. Without one, the board asks which field to use,
 * or to create one.
 *
 * A multi-select task has a card in the column of each of its options, so a
 * card's drag id carries its column: moving it takes that one option off and
 * puts the new one on, leaving the task's other options alone.
 *
 * Cards are the matrix's own, so a task looks the same on the board. Within a
 * column, cards keep the filter's sort; a board column has no manual order.
 */
import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { Check, ChevronDown, Columns3, Plus, SlidersHorizontal } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { MatrixTaskCard } from '@/components/MatrixTaskCard';
import type { Todo, TodoStatus } from '@/types/todo';
import type { TaskCompare } from '@/lib/quadrantBuckets';
import { FIELD_EMPTY, FIELD_SET, groupByField, isGroupableField, type TaskGroup } from '@/lib/taskFilters';
import { FIELD_KIND_LABELS } from '@/types/fields';
import { OPTION_DOT_CLASS } from '@/lib/fieldValues';
import type { FieldDef, FieldValue, TaskFieldValues } from '@/types/fields';

export const BOARD_COLUMN_PREFIX = 'board-column:';
const CARD_SEPARATOR = '::';

/** A card's drag id: the column it is in, and its task. */
export const boardCardId = (columnKey: string, taskId: string) => `${columnKey}${CARD_SEPARATOR}${taskId}`;

export function parseBoardCardId(id: string): { columnKey: string; taskId: string } | null {
  const i = id.indexOf(CARD_SEPARATOR);
  if (i <= 0) return null;
  return { columnKey: id.slice(0, i), taskId: id.slice(i + CARD_SEPARATOR.length) };
}

/**
 * What dropping a card on a column changes, or null when nothing should: not a
 * column, its own column, an option that no longer exists, or a move that leaves
 * the value as it was.
 */
export function boardDrop(
  cardId: string,
  overId: string | null,
  field: FieldDef,
  values: TaskFieldValues,
): { taskId: string; value: FieldValue | null } | null {
  const card = parseBoardCardId(cardId);
  if (!card || !overId || !overId.startsWith(BOARD_COLUMN_PREFIX)) return null;
  const target = overId.slice(BOARD_COLUMN_PREFIX.length);
  const { taskId, columnKey: from } = card;
  if (target === from) return null;

  const current = values[taskId]?.[field.id];
  const isOption = (id: unknown) => typeof id === 'string' && field.options.some((o) => o.id === id);

  switch (field.kind) {
    case 'checkbox':
      if (target === FIELD_SET) return current === true ? null : { taskId, value: true };
      if (target === FIELD_EMPTY) return current === true ? { taskId, value: null } : null;
      return null;

    case 'select': {
      if (target !== FIELD_EMPTY && !isOption(target)) return null;
      const currentColumn = isOption(current) ? (current as string) : FIELD_EMPTY;
      if (target === currentColumn) return null;
      return { taskId, value: target === FIELD_EMPTY ? null : target };
    }

    case 'multi': {
      if (target !== FIELD_EMPTY && !isOption(target)) return null;
      const had = (Array.isArray(current) ? current : []).filter(isOption);
      const chosen = new Set(had);
      if (from !== FIELD_EMPTY) chosen.delete(from);
      if (target !== FIELD_EMPTY) chosen.add(target);
      // In the field's option order, so the stored list is stable.
      const ordered = (ids: Iterable<string>) => {
        const set = new Set(ids);
        return field.options.map((o) => o.id).filter((id) => set.has(id));
      };
      const next = ordered(chosen);
      if (next.join() === ordered(had).join()) return null;
      return { taskId, value: next.length ? next : null };
    }

    default:
      return null;
  }
}

interface CardHandlers {
  nextId: string | null;
  onStatusChange: (id: string, status: TodoStatus) => void;
  onDelete: (id: string) => void;
  onOpen: (todo: Todo) => void;
  onToggleReminder?: (id: string, enabled: boolean) => void;
  notificationPermission?: NotificationPermission;
  onOpenNote?: (noteId: string) => void;
}

export interface TaskBoardViewProps extends CardHandlers {
  todos: Todo[];
  showDone: boolean;
  /** Card order within a column; tasks from every quadrant are compared. */
  compare: TaskCompare;
  groupField: FieldDef | null;
  fieldDefs: FieldDef[];
  fieldValues: TaskFieldValues;
  fieldsOnline: boolean;
  fieldsLoading: boolean;
  onGroupFieldChange: (fieldId: string) => void;
  onManageFields: () => void;
  onSetFieldValue: (taskId: string, fieldId: string, value: FieldValue | null) => void;
  /** Creates a task already in that column. Without it, columns have no "+ Add". */
  onAddTask?: (title: string, columnKey: string) => void;
}

export function TaskBoardView({
  todos, showDone, compare, groupField, fieldDefs, fieldValues, fieldsOnline, fieldsLoading,
  onGroupFieldChange, onManageFields, onSetFieldValue, onAddTask, ...cardHandlers
}: TaskBoardViewProps) {
  const [activeCardId, setActiveCardId] = useState<string | null>(null);

  const columns = useMemo(
    () => (groupField ? groupByField(todos, showDone, compare, groupField, fieldValues, { includeEmpty: true }) : []),
    [todos, showDone, compare, groupField, fieldValues],
  );

  const sensors = useSensors(
    // A small distance, so a click on a card is not mistaken for a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  if (!groupField) {
    return (
      <BoardSetup
        groupableFields={fieldDefs.filter(isGroupableField)}
        otherFields={fieldDefs.filter((d) => !isGroupableField(d))}
        fieldsOnline={fieldsOnline}
        fieldsLoading={fieldsLoading}
        onGroupFieldChange={onGroupFieldChange}
        onManageFields={onManageFields}
      />
    );
  }

  const activeTaskId = activeCardId ? parseBoardCardId(activeCardId)?.taskId : undefined;
  const active = activeTaskId ? todos.find((t) => t.id === activeTaskId) : undefined;

  const handleDragEnd = ({ active: dragged, over }: DragEndEvent) => {
    setActiveCardId(null);
    const change = boardDrop(String(dragged.id), over ? String(over.id) : null, groupField, fieldValues);
    if (change) onSetFieldValue(change.taskId, groupField.id, change.value);
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={({ active: dragged }) => setActiveCardId(String(dragged.id))}
      onDragCancel={() => setActiveCardId(null)}
      onDragEnd={handleDragEnd}
    >
      <div className="animate-fade-in">
        <BoardToolbar
          field={groupField}
          groupableFields={fieldDefs.filter(isGroupableField)}
          onGroupFieldChange={onGroupFieldChange}
          onManageFields={onManageFields}
        />

        <div className="relative">
          <div className="w-full overflow-x-auto pb-3">
            <div className="flex min-w-max items-start gap-4">
              {columns.map((column) => (
                <BoardColumn
                  key={column.key}
                  fieldId={groupField.id}
                  column={column}
                  fieldDefs={fieldDefs}
                  fieldValues={fieldValues}
                  onAddTask={onAddTask}
                  {...cardHandlers}
                />
              ))}
              <button
                type="button"
                onClick={onManageFields}
                className="w-[200px] flex-shrink-0 rounded-[8px] border border-dashed border-a-line-strong bg-transparent p-3 text-left text-[14px] text-a-muted transition-colors duration-[120ms] hover:bg-a-row-hover hover:text-a-ink"
              >
                + Add a {groupField.name} option
              </button>
            </div>
          </div>
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {active && (
          <div className="w-[272px] rotate-[1.5deg] cursor-grabbing shadow-lg">
            <MatrixTaskCard
              variant="board"
              todo={active}
              index={0}
              isNext={active.id === cardHandlers.nextId}
              onStatusChange={cardHandlers.onStatusChange}
              onDelete={cardHandlers.onDelete}
              onOpen={cardHandlers.onOpen}
              fieldDefs={fieldDefs}
              fieldValues={fieldValues[active.id]}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

interface BoardToolbarProps {
  field: FieldDef;
  groupableFields: FieldDef[];
  onGroupFieldChange: (fieldId: string) => void;
  onManageFields: () => void;
}

/** Group-by bar — showcase 265–271: label, field picker, Manage fields, helper text. */
function BoardToolbar({ field, groupableFields, onGroupFieldChange, onManageFields }: BoardToolbarProps) {
  return (
    <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
      <span className="text-[14px] text-a-muted">Group by</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-7 w-40 items-center justify-between gap-1.5 rounded-[4px] px-2 text-[12px] text-a-ink shadow-[inset_0_0_0_1px_var(--a-line)] transition-colors duration-[120ms] hover:bg-a-row-hover"
            aria-label={`Columns from ${field.name}`}
          >
            <span className="truncate">{field.name}</span>
            <ChevronDown className="size-3.5 flex-shrink-0 text-a-faint" strokeWidth={1.75} aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-56"
          // "Create a field…" opens another popover (FieldsManagerDialog);
          // see RecordTable's FieldHeader for why this prevents it closing itself.
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {groupableFields.map((f) => (
            <DropdownMenuItem key={f.id} onClick={() => onGroupFieldChange(f.id)}>
              <Check className={cn('size-3.5', f.id !== field.id && 'opacity-0')} aria-hidden />
              {f.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onManageFields}>
            <Plus className="size-3.5" aria-hidden /> Create a field…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onGroupFieldChange('')}>
            Choose later
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        onClick={onManageFields}
        className="flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-[12px] text-a-muted transition-colors duration-[120ms] hover:bg-a-row-hover hover:text-a-ink"
      >
        <SlidersHorizontal className="size-3.5" strokeWidth={1.75} aria-hidden />
        Manage fields
      </button>
      <div className="flex-1" />
      <span className="text-[12px] text-a-faint">
        Drag a card to another column to change its {field.name}. Undo is offered for 5 seconds.
      </span>
    </div>
  );
}

interface BoardColumnProps extends CardHandlers {
  fieldId: string;
  column: TaskGroup;
  fieldDefs: FieldDef[];
  fieldValues: TaskFieldValues;
  onAddTask?: (title: string, columnKey: string) => void;
}

function BoardColumn({ fieldId, column, fieldDefs, fieldValues, onAddTask, ...handlers }: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `${BOARD_COLUMN_PREFIX}${column.key}` });
  const [composing, setComposing] = useState(false);
  const headingId = `board-${fieldId}-${column.key}`;
  const taskCount = column.tasks.length;

  // Showcase 272–296: a --gray-100 lane, 8px radius, 8px padding and gap; header
  // dot + name + mono count + "+"; the empty lane is a dashed drop target.
  return (
    <section
      aria-labelledby={headingId}
      className="flex w-[292px] flex-shrink-0 flex-col gap-2 rounded-[8px] bg-a-line-soft p-2"
    >
      <header className="flex items-center gap-2 px-1.5 py-1">
        <span
          className={cn('size-2 flex-shrink-0 rounded-full', column.color ? OPTION_DOT_CLASS[column.color] : 'shadow-[inset_0_0_0_1.5px_var(--a-line-strong)]')}
          aria-hidden
        />
        <h2 id={headingId} className="min-w-0 truncate text-[14px] font-semibold leading-tight text-a-ink">{column.label}</h2>
        <span className="font-mono text-[11px] tabular-nums text-a-faint">
          {taskCount}
          <span className="sr-only"> tasks</span>
        </span>
        <div className="flex-1" />
        {onAddTask && (
          <button
            type="button"
            onClick={() => setComposing(true)}
            aria-label={`Add task to ${column.label}`}
            className="flex size-7 items-center justify-center rounded-[4px] text-a-muted transition-colors duration-[120ms] hover:bg-a-row-hover hover:text-a-ink"
          >
            <Plus className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        )}
      </header>

      <div
        ref={setNodeRef}
        className={cn(
          'flex flex-col gap-2 rounded-[8px] transition-[background-color,box-shadow] duration-[120ms]',
          isOver && 'bg-a-row-hover shadow-[inset_0_0_0_1.5px_var(--a-accent)]',
        )}
      >
        {column.tasks.map((todo, i) => (
          <DraggableCard
            key={todo.id}
            columnKey={column.key}
            todo={todo}
            index={i}
            fieldDefs={fieldDefs}
            fieldValues={fieldValues}
            {...handlers}
          />
        ))}
        {column.tasks.length === 0 && (
          <div className="rounded-[8px] border border-dashed border-a-line-strong px-3 py-5 text-center text-[12px] leading-normal text-a-faint">
            Drop a task here.<br />Empty columns stay, so you can move work into them.
          </div>
        )}
      </div>

      {onAddTask && composing && (
        <ColumnComposer columnLabel={column.label} onDone={() => setComposing(false)} onAdd={(title) => onAddTask(title, column.key)} />
      )}
    </section>
  );
}

/** The header "+" opens this: type a title, Enter creates it in that column. */
function ColumnComposer({ columnLabel, onAdd, onDone }: { columnLabel: string; onAdd: (title: string) => void; onDone: () => void }) {
  const [title, setTitle] = useState('');

  const commit = () => {
    const trimmed = title.trim();
    if (trimmed) onAdd(trimmed);
    setTitle('');
    onDone();
  };

  return (
    <input
      autoFocus
      value={title}
      maxLength={200}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { setTitle(''); onDone(); }
      }}
      placeholder="What needs to be done?"
      aria-label={`New task in ${columnLabel}`}
      className="h-9 w-full rounded-[8px] bg-a-surface px-2.5 text-[14px] text-a-ink shadow-[inset_0_0_0_1px_var(--a-line)] outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--a-accent)]"
    />
  );
}

interface DraggableCardProps extends CardHandlers {
  columnKey: string;
  todo: Todo;
  index: number;
  fieldDefs: FieldDef[];
  fieldValues: TaskFieldValues;
}

function DraggableCard({ columnKey, todo, index, fieldDefs, fieldValues, ...handlers }: DraggableCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: boardCardId(columnKey, todo.id) });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-roledescription="Draggable task"
      className={cn('cursor-grab touch-none rounded-[8px] outline-none focus-visible:ring-2 focus-visible:ring-a-accent', isDragging && 'opacity-40')}
    >
      <MatrixTaskCard
        variant="board"
        todo={todo}
        index={index}
        isNext={todo.id === handlers.nextId}
        onStatusChange={handlers.onStatusChange}
        onDelete={handlers.onDelete}
        onOpen={handlers.onOpen}
        onToggleReminder={handlers.onToggleReminder}
        notificationPermission={handlers.notificationPermission}
        onOpenNote={handlers.onOpenNote}
        fieldDefs={fieldDefs}
        fieldValues={fieldValues[todo.id]}
      />
    </div>
  );
}

/** Three placeholder columns while the fields that define them load (showcase 161–173's shape). */
function BoardSkeleton() {
  return (
    <div className="flex items-start gap-4 overflow-hidden" role="status" aria-label="Loading board">
      {[2, 3, 1].map((cards, i) => (
        <div key={i} className="flex w-[292px] flex-shrink-0 flex-col gap-2 rounded-[8px] bg-a-line-soft p-2">
          <div className="h-7 px-1.5 py-1"><div className="h-full w-24 animate-pulse rounded-[4px] bg-a-line" /></div>
          {Array.from({ length: cards }).map((_, j) => (
            <div key={j} className="h-[72px] animate-pulse rounded-[8px] border border-a-line bg-a-surface" />
          ))}
        </div>
      ))}
    </div>
  );
}

interface BoardSetupProps {
  /** Fields that can make columns. */
  groupableFields: FieldDef[];
  /** Fields that cannot — named, so it is clear why they are not offered. */
  otherFields: FieldDef[];
  fieldsOnline: boolean;
  fieldsLoading: boolean;
  onGroupFieldChange: (fieldId: string) => void;
  onManageFields: () => void;
}

/** Shown until the board has a field to make columns from. */
function BoardSetup({ groupableFields, otherFields, fieldsOnline, fieldsLoading, onGroupFieldChange, onManageFields }: BoardSetupProps) {
  if (fieldsLoading) return <BoardSkeleton />;

  return (
    <div className="mx-auto flex max-w-[480px] flex-col items-center py-16 text-center animate-fade-in">
      <Columns3 className="mb-3 size-6 text-a-faint" strokeWidth={1.75} aria-hidden />
      <p className="font-display text-[20px] text-a-ink">Choose the columns</p>

      {!fieldsOnline ? (
        <p className="mt-2 text-[14px] leading-relaxed text-a-muted">
          The board makes its columns from a custom field, and fields need the server.
          It's unreachable right now.
        </p>
      ) : groupableFields.length === 0 ? (
        <>
          <p className="mt-2 text-[14px] leading-relaxed text-a-muted">
            Columns come from a Select or Multi-select field (one column per option) or a Checkbox
            field (Checked and Not checked).
            {otherFields.length > 0 && (
              <> {otherFields.map((d) => `${d.name} (${FIELD_KIND_LABELS[d.kind]})`).join(', ')} can't make columns.</>
            )}
          </p>
          <button
            type="button"
            onClick={onManageFields}
            className="mt-4 flex items-center gap-1.5 rounded-[6px] bg-a-accent px-4 py-2 text-[14px] font-semibold text-a-surface transition-colors duration-[120ms] hover:bg-a-accent-600"
          >
            <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
            Create a field
          </button>
        </>
      ) : (
        <>
          <p className="mt-2 text-[14px] leading-relaxed text-a-muted">
            Pick a field. Each of its values becomes a column, and dragging a task between columns changes it.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {groupableFields.map((field) => (
              <button
                key={field.id}
                type="button"
                onClick={() => onGroupFieldChange(field.id)}
                className="rounded-[6px] px-3.5 py-1.5 text-[14px] font-semibold text-a-ink shadow-[inset_0_0_0_1px_var(--a-line)] transition-colors duration-[120ms] hover:bg-a-row-hover"
              >
                {field.name}
                <span className="ml-1.5 font-normal text-a-faint">{FIELD_KIND_LABELS[field.kind]}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
