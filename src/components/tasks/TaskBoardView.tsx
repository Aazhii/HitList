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
import { Columns3, Plus } from 'lucide-react';
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
}

export function TaskBoardView({
  todos, showDone, compare, groupField, fieldDefs, fieldValues, fieldsOnline, fieldsLoading,
  onGroupFieldChange, onManageFields, onSetFieldValue, ...cardHandlers
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
          <p className="flex flex-1 items-center justify-center px-3 py-6 text-center text-[13px] text-a-faint">
            Drop a task here
          </p>
        )}
      </div>
    </section>
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
  if (fieldsLoading) return null;

  return (
    <div className="mx-auto flex max-w-[480px] flex-col items-center py-16 text-center animate-fade-in">
      <Columns3 className="mb-3 size-6 text-a-faint" strokeWidth={2.25} aria-hidden />
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
            className="mt-4 flex items-center gap-1.5 rounded-full bg-a-accent px-4 py-2 text-[13.5px] font-semibold text-a-bg transition-colors duration-150 hover:bg-a-accent-600"
          >
            <Plus className="size-3.5" strokeWidth={2.75} aria-hidden />
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
                className="rounded-full px-3.5 py-1.5 text-[13.5px] font-semibold text-a-ink shadow-[inset_0_0_0_1px_var(--a-line)] transition-colors duration-150 hover:bg-a-row-hover"
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
