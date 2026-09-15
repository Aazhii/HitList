/**
 * The board layout: a column per option of a select field, then one for tasks
 * with no value. Dragging a card to another column sets the field to that
 * option; dropping it in the last column clears it.
 *
 * The columns come from the filter's group-by field, so a board is saved in a
 * view like any other grouping. Without one, the board asks which select field
 * to use — or to create one.
 *
 * Cards are the matrix's own, so a task looks the same on the board. A drag is
 * the only way the board writes anything; within a column, cards keep the
 * filter's sort, since a board column has no manual order of its own.
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
import { Columns3, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MatrixTaskCard } from '@/components/MatrixTaskCard';
import type { Todo, TodoStatus } from '@/types/todo';
import type { TaskCompare } from '@/lib/quadrantBuckets';
import { FIELD_EMPTY, groupByField, type TaskGroup } from '@/lib/taskFilters';
import { OPTION_DOT_CLASS } from '@/lib/fieldValues';
import type { FieldDef, FieldValue, TaskFieldValues } from '@/types/fields';

export const BOARD_COLUMN_PREFIX = 'board-column:';

/**
 * What dropping a task on a column changes, or null when nothing should: not a
 * column, the column it is already in, or an option that no longer exists.
 */
export function boardDrop(
  taskId: string,
  overId: string | null,
  field: FieldDef,
  values: TaskFieldValues,
): { taskId: string; value: string | null } | null {
  if (!overId || !overId.startsWith(BOARD_COLUMN_PREFIX)) return null;
  const target = overId.slice(BOARD_COLUMN_PREFIX.length);
  const isOption = (id: unknown) => typeof id === 'string' && field.options.some((o) => o.id === id);

  const current = values[taskId]?.[field.id];
  const currentColumn = isOption(current) ? (current as string) : FIELD_EMPTY;
  if (target === currentColumn) return null;
  if (target !== FIELD_EMPTY && !isOption(target)) return null;
  return { taskId, value: target === FIELD_EMPTY ? null : target };
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
}

export function TaskBoardView({
  todos, showDone, compare, groupField, fieldDefs, fieldValues, fieldsOnline, fieldsLoading,
  onGroupFieldChange, onManageFields, onSetFieldValue, ...cardHandlers
}: TaskBoardViewProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

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
        selectFields={fieldDefs.filter((d) => d.kind === 'select')}
        fieldsOnline={fieldsOnline}
        fieldsLoading={fieldsLoading}
        onGroupFieldChange={onGroupFieldChange}
        onManageFields={onManageFields}
      />
    );
  }

  const active = activeId ? todos.find((t) => t.id === activeId) : undefined;

  const handleDragEnd = ({ active: dragged, over }: DragEndEvent) => {
    setActiveId(null);
    const change = boardDrop(String(dragged.id), over ? String(over.id) : null, groupField, fieldValues);
    if (change) onSetFieldValue(change.taskId, groupField.id, change.value);
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={({ active: dragged }) => setActiveId(String(dragged.id))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={handleDragEnd}
    >
      <div className="w-full overflow-x-auto pb-3 animate-fade-in">
        <div className="flex min-w-max items-start gap-4">
          {columns.map((column) => (
            <BoardColumn
              key={column.key}
              fieldId={groupField.id}
              column={column}
              fieldDefs={fieldDefs}
              fieldValues={fieldValues}
              {...cardHandlers}
            />
          ))}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {active && (
          <div className="w-[272px] rotate-[1.5deg] cursor-grabbing shadow-lg">
            <MatrixTaskCard
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

interface BoardColumnProps extends CardHandlers {
  fieldId: string;
  column: TaskGroup;
  fieldDefs: FieldDef[];
  fieldValues: TaskFieldValues;
}

function BoardColumn({ fieldId, column, fieldDefs, fieldValues, ...handlers }: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `${BOARD_COLUMN_PREFIX}${column.key}` });
  const headingId = `board-${fieldId}-${column.key}`;
  const openCount = column.tasks.filter((t) => t.status !== 'done').length;

  return (
    <section
      aria-labelledby={headingId}
      className="flex w-[292px] flex-shrink-0 flex-col rounded-[18px] bg-[color-mix(in_srgb,var(--a-ink)_4%,transparent)] p-2.5"
    >
      <header className="mb-2 flex items-center gap-2 px-1.5 pt-0.5">
        <span
          className={cn('size-[9px] flex-shrink-0 rounded-full', column.color ? OPTION_DOT_CLASS[column.color] : 'shadow-[inset_0_0_0_1.5px_var(--a-line)]')}
          aria-hidden
        />
        <h2 id={headingId} className="min-w-0 truncate font-display text-[16px] leading-tight text-a-ink">{column.label}</h2>
        <span className="text-[12.5px] font-bold tabular-nums text-a-muted">
          {openCount}
          <span className="sr-only"> open</span>
        </span>
      </header>

      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-[96px] flex-col gap-2 rounded-[14px] p-0.5 transition-[background-color,box-shadow] duration-150',
          isOver && 'bg-a-row-hover shadow-[inset_0_0_0_1.5px_var(--a-accent)]',
        )}
      >
        {column.tasks.map((todo, i) => (
          <DraggableCard key={todo.id} todo={todo} index={i} fieldDefs={fieldDefs} fieldValues={fieldValues} {...handlers} />
        ))}
        {column.tasks.length === 0 && (
          <p className="flex flex-1 items-center justify-center px-3 py-6 text-center text-[13px] text-a-faint">
            Drop a task here
          </p>
        )}
      </div>
    </section>
  );
}

interface DraggableCardProps extends CardHandlers {
  todo: Todo;
  index: number;
  fieldDefs: FieldDef[];
  fieldValues: TaskFieldValues;
}

function DraggableCard({ todo, index, fieldDefs, fieldValues, ...handlers }: DraggableCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: todo.id });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-roledescription="Draggable task"
      className={cn('cursor-grab touch-none rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-a-accent', isDragging && 'opacity-40')}
    >
      <MatrixTaskCard
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

interface BoardSetupProps {
  selectFields: FieldDef[];
  fieldsOnline: boolean;
  fieldsLoading: boolean;
  onGroupFieldChange: (fieldId: string) => void;
  onManageFields: () => void;
}

/** Shown until the board has a select field to make columns from. */
function BoardSetup({ selectFields, fieldsOnline, fieldsLoading, onGroupFieldChange, onManageFields }: BoardSetupProps) {
  if (fieldsLoading) return null;

  return (
    <div className="mx-auto flex max-w-[460px] flex-col items-center py-16 text-center animate-fade-in">
      <Columns3 className="mb-3 size-6 text-a-faint" strokeWidth={2.25} aria-hidden />
      <p className="font-display text-[20px] text-a-ink">Choose the columns</p>

      {!fieldsOnline ? (
        <p className="mt-2 text-[14px] leading-relaxed text-a-muted">
          The board makes a column for each option of a select field, and fields need the server.
          It's unreachable right now.
        </p>
      ) : selectFields.length === 0 ? (
        <>
          <p className="mt-2 text-[14px] leading-relaxed text-a-muted">
            The board makes a column for each option of a select field — like Stage or Effort. You don't have one yet.
          </p>
          <button
            type="button"
            onClick={onManageFields}
            className="mt-4 flex items-center gap-1.5 rounded-full bg-a-accent px-4 py-2 text-[13.5px] font-semibold text-a-bg transition-colors duration-150 hover:bg-a-accent-600"
          >
            <Plus className="size-3.5" strokeWidth={2.75} aria-hidden />
            Create a select field
          </button>
        </>
      ) : (
        <>
          <p className="mt-2 text-[14px] leading-relaxed text-a-muted">
            Pick a select field. Each of its options becomes a column, and dragging a task between columns changes it.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {selectFields.map((field) => (
              <button
                key={field.id}
                type="button"
                onClick={() => onGroupFieldChange(field.id)}
                className="rounded-full px-3.5 py-1.5 text-[13.5px] font-semibold text-a-ink shadow-[inset_0_0_0_1px_var(--a-line)] transition-colors duration-150 hover:bg-a-row-hover"
              >
                {field.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
