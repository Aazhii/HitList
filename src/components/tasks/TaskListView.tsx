/**
 * The tasks list view: rows on flat ground, grouped by quadrant.
 *
 * The same tasks as the matrix, bucketed by the same function, so switching
 * between List and Matrix never changes what is shown or in what order.
 *
 * Grouped by a select field instead when the filter asks for it: one group per
 * option, and dragging is off, since manual order belongs to quadrants.
 *
 * Tasks can be dragged to reorder within a quadrant, or into another quadrant.
 * Each quadrant group is also a drop target in its own right, so an empty
 * quadrant can receive a task. Done tasks do not move.
 */
import { useMemo } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { QUADRANTS } from '@/types/todo';
import type { Quadrant, QuadrantConfig, Todo, TodoStatus } from '@/types/todo';
import { bucketByQuadrant, compareTasks } from '@/lib/quadrantBuckets';
import { groupByField, type TaskGroup } from '@/lib/taskFilters';
import { OPTION_DOT_CLASS } from '@/lib/fieldValues';
import type { TaskCompare } from '@/lib/quadrantBuckets';
import type { FieldDef, TaskFieldValues } from '@/types/fields';
import { computeReorder, quadrantDropId, type ReorderChange } from '@/lib/reorder';
import { TaskRow } from '@/components/tasks/TaskRow';

interface TaskListViewProps {
  todos: Todo[];
  showDone: boolean;
  /** Order within each quadrant; the manual order when absent. */
  compare?: TaskCompare;
  nextId: string | null;
  /** True while filters narrow the list. Reordering a filtered subset would scramble what is hidden. */
  dragDisabled?: boolean;
  onStatusChange: (id: string, status: TodoStatus) => void;
  onDelete: (id: string) => void;
  onOpen: (todo: Todo) => void;
  onAddToQuadrant: (quadrant: Quadrant) => void;
  onReorder: (changes: ReorderChange[]) => void;
  onToggleReminder?: (id: string, enabled: boolean) => void;
  notificationPermission?: NotificationPermission;
  /** Opens the note a task was added from. */
  onOpenNote?: (noteId: string) => void;
  fieldDefs?: FieldDef[];
  fieldValues?: TaskFieldValues;
  /** A select field to group by instead of quadrants. */
  groupField?: FieldDef | null;
  /** Order within a field group, where tasks from every quadrant mix. */
  groupCompare?: TaskCompare;
}

export function TaskListView({
  todos,
  showDone,
  compare,
  nextId,
  dragDisabled = false,
  onStatusChange,
  onDelete,
  onOpen,
  onAddToQuadrant,
  onReorder,
  onToggleReminder,
  notificationPermission,
  onOpenNote,
  fieldDefs,
  fieldValues,
  groupField,
  groupCompare,
}: TaskListViewProps) {
  const buckets = useMemo(() => bucketByQuadrant(todos, showDone, compare), [todos, showDone, compare]);
  const fieldGroups = useMemo(
    () => (groupField ? groupByField(todos, showDone, groupCompare ?? compare ?? compareTasks, groupField, fieldValues ?? {}) : null),
    [todos, showDone, groupCompare, compare, groupField, fieldValues],
  );

  const sensors = useSensors(
    // A small distance, so a click on the grip is not mistaken for a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    // The same buckets that were rendered, so the arithmetic matches the screen.
    const changes = computeReorder(buckets, String(active.id), String(over.id));
    if (changes.length > 0) onReorder(changes);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={handleDragEnd}
    >
      <div className="mx-auto w-full max-w-[880px] space-y-7 animate-fade-in">
        {fieldGroups && fieldGroups.map((group) => (
          <FieldGroup
            key={group.key}
            fieldId={groupField!.id}
            group={group}
            nextId={nextId}
            onStatusChange={onStatusChange}
            onDelete={onDelete}
            onOpen={onOpen}
            onToggleReminder={onToggleReminder}
            notificationPermission={notificationPermission}
            onOpenNote={onOpenNote}
            fieldDefs={fieldDefs}
            fieldValues={fieldValues}
          />
        ))}
        {!fieldGroups && QUADRANTS.map((q) => (
          <QuadrantGroup
            key={q.id}
            quadrant={q}
            tasks={buckets.get(q.id) ?? []}
            nextId={nextId}
            dragDisabled={dragDisabled}
            onStatusChange={onStatusChange}
            onDelete={onDelete}
            onOpen={onOpen}
            onAddToQuadrant={onAddToQuadrant}
            onToggleReminder={onToggleReminder}
            notificationPermission={notificationPermission}
            onOpenNote={onOpenNote}
            fieldDefs={fieldDefs}
            fieldValues={fieldValues}
          />
        ))}
      </div>
    </DndContext>
  );
}

type GroupRowProps = Pick<TaskListViewProps,
  'nextId' | 'onStatusChange' | 'onDelete' | 'onOpen' | 'onToggleReminder' |
  'notificationPermission' | 'onOpenNote' | 'fieldDefs' | 'fieldValues'>;

/** One option's tasks when grouping by a field. Not a drop target: a drag cannot set a field. */
function FieldGroup({
  fieldId, group, nextId, onStatusChange, onDelete, onOpen, onToggleReminder,
  notificationPermission, onOpenNote, fieldDefs, fieldValues,
}: GroupRowProps & { fieldId: string; group: TaskGroup }) {
  const openCount = group.tasks.filter((t) => t.status !== 'done').length;
  const headingId = `field-group-${fieldId}-${group.key}`;

  return (
    <section aria-labelledby={headingId}>
      <header className="mb-1.5 flex items-center gap-2.5 px-1">
        <span
          className={cn('size-[9px] flex-shrink-0 rounded-full', group.color ? OPTION_DOT_CLASS[group.color] : 'shadow-[inset_0_0_0_1.5px_var(--a-line)]')}
          aria-hidden
        />
        <h2 id={headingId} className="font-display text-[17px] leading-tight text-a-ink">{group.label}</h2>
        <span className="text-[12.5px] font-bold tabular-nums text-a-muted">
          {openCount}
          <span className="sr-only"> open</span>
        </span>
        <span className="h-px flex-1 bg-a-line-soft" aria-hidden />
      </header>

      <SortableContext items={group.tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        {group.tasks.map((todo, i) => (
          <TaskRow
            key={todo.id}
            todo={todo}
            index={i}
            isNext={todo.id === nextId}
            dragDisabled
            onStatusChange={onStatusChange}
            onDelete={onDelete}
            onOpen={onOpen}
            onToggleReminder={onToggleReminder}
            notificationPermission={notificationPermission}
            onOpenNote={onOpenNote}
            fieldDefs={fieldDefs}
            fieldValues={fieldValues?.[todo.id]}
          />
        ))}
      </SortableContext>
      {group.tasks.length === 0 && (
        <p className="px-3 py-2 text-[13.5px] text-a-faint">No tasks</p>
      )}
    </section>
  );
}

interface QuadrantGroupProps extends Omit<TaskListViewProps, 'todos' | 'showDone' | 'onReorder' | 'compare' | 'groupField' | 'groupCompare'> {
  quadrant: QuadrantConfig;
  tasks: Todo[];
}

function QuadrantGroup({
  quadrant: q,
  tasks,
  nextId,
  dragDisabled,
  onStatusChange,
  onDelete,
  onOpen,
  onAddToQuadrant,
  onToggleReminder,
  notificationPermission,
  onOpenNote,
  fieldDefs,
  fieldValues,
}: QuadrantGroupProps) {
  const { setNodeRef, isOver } = useDroppable({ id: quadrantDropId(q.id), disabled: dragDisabled });
  const openCount = tasks.filter((t) => t.status !== 'done').length;
  const headingId = `quadrant-group-${q.id}`;

  return (
    <section aria-labelledby={headingId}>
      <header className="mb-1.5 flex items-center gap-2.5 px-1">
        <span className={cn('size-[9px] flex-shrink-0 rounded-full', q.dotClass)} aria-hidden />
        <h2 id={headingId} className={cn('font-display text-[17px] leading-tight', q.inkClass)}>{q.label}</h2>
        <span className="hidden text-[12.5px] text-a-faint sm:inline">{q.subtitle}</span>
        <span className={cn('text-[12.5px] font-bold tabular-nums', q.inkClass)}>
          {openCount}
          <span className="sr-only"> open</span>
        </span>
        <span className="h-px flex-1 bg-a-line-soft" aria-hidden />
      </header>

      <div
        ref={setNodeRef}
        className={cn('rounded-[16px] transition-colors duration-150', isOver && 'bg-a-row-hover')}
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((todo, i) => (
            <TaskRow
              key={todo.id}
              todo={todo}
              index={i}
              isNext={todo.id === nextId}
              dragDisabled={dragDisabled}
              onStatusChange={onStatusChange}
              onDelete={onDelete}
              onOpen={onOpen}
              onToggleReminder={onToggleReminder}
              notificationPermission={notificationPermission}
              onOpenNote={onOpenNote}
              fieldDefs={fieldDefs}
              fieldValues={fieldValues?.[todo.id]}
            />
          ))}
        </SortableContext>

        <button
          type="button"
          onClick={() => onAddToQuadrant(q.id)}
          aria-label={`Add task to ${q.label}`}
          className="flex w-full items-center gap-[11px] rounded-[14px] px-3 py-2 text-left text-[13.5px] text-a-faint transition-colors duration-150 hover:bg-a-row-hover hover:text-a-ink"
        >
          <span className="flex size-5 flex-shrink-0 items-center justify-center" aria-hidden>
            <Plus className="size-3.5" strokeWidth={2.75} />
          </span>
          {tasks.length === 0 ? 'Nothing here yet — add a task' : 'Add task'}
        </button>
      </div>
    </section>
  );
}
