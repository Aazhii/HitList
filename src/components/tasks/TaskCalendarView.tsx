/**
 * The calendar: a month grid with each task on its due date, and a tray of the
 * tasks that have none.
 *
 * Drag a task to another day to move its due date (its time stays), or onto the
 * tray to take the date off. Drag from the tray onto a day to give a task a
 * date. Click a task to open it; the + on a day adds a task due that day.
 *
 * The filters apply as everywhere else, so a calendar of "Work · open" is just
 * those tasks. Done tasks show only with Show completed.
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
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { QUADRANTS, type Todo } from '@/types/todo';
import type { TaskCompare } from '@/lib/quadrantBuckets';
import { localDateKey } from '@/lib/taskFilters';
import { getDueInfo } from '@/lib/dueInfo';
import {
  CALENDAR_DAY_PREFIX, NO_DATE, calendarDrop, isInMonth, monthOf, monthWeeks, shiftMonth, tasksByDay,
} from '@/lib/calendar';

export interface TaskCalendarViewProps {
  todos: Todo[];
  showDone: boolean;
  /** Order within a day after timed tasks, and in the tray. */
  compare: TaskCompare;
  onMove: (taskId: string, changes: Partial<Todo>) => void;
  onOpen: (todo: Todo) => void;
  onAddOnDate: (dateKey: string) => void;
  /** Today, for tests. */
  today?: Date;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function dateFromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const longDate = (key: string) =>
  dateFromKey(key).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

export function TaskCalendarView({ todos, showDone, compare, onMove, onOpen, onAddOnDate, today }: TaskCalendarViewProps) {
  const now = today ?? new Date();
  const todayKey = localDateKey(now);
  const [month, setMonth] = useState(() => monthOf(now));
  const [activeId, setActiveId] = useState<string | null>(null);

  const weeks = useMemo(() => monthWeeks(month), [month]);
  const { byDay, undated } = useMemo(() => tasksByDay(todos, showDone, compare), [todos, showDone, compare]);

  const sensors = useSensors(
    // A small distance, so clicking a task opens it rather than starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const active = activeId ? todos.find((t) => t.id === activeId) : undefined;
  const monthLabel = new Date(month.year, month.month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const handleDragEnd = ({ active: dragged, over }: DragEndEvent) => {
    setActiveId(null);
    const drop = calendarDrop(String(dragged.id), over ? String(over.id) : null, todos);
    if (drop) onMove(drop.taskId, drop.changes);
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={({ active: dragged }) => setActiveId(String(dragged.id))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col gap-5 animate-fade-in xl:flex-row xl:items-start">
        <section className="min-w-0 flex-1" aria-label={`Calendar, ${monthLabel}`}>
          <header className="mb-3 flex items-center gap-2">
            <h2 className="font-display text-[20px] leading-tight text-a-ink">{monthLabel}</h2>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => setMonth(monthOf(now))}
                className="h-8 rounded-full px-3 text-[13px] font-semibold text-a-ink shadow-[inset_0_0_0_1px_var(--a-line)] transition-colors duration-150 hover:bg-a-row-hover"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => setMonth((m) => shiftMonth(m, -1))}
                className="flex size-8 items-center justify-center rounded-full text-a-muted transition-colors duration-150 hover:bg-a-row-hover hover:text-a-ink"
                aria-label="Previous month"
              >
                <ChevronLeft className="size-4" strokeWidth={2.5} />
              </button>
              <button
                type="button"
                onClick={() => setMonth((m) => shiftMonth(m, 1))}
                className="flex size-8 items-center justify-center rounded-full text-a-muted transition-colors duration-150 hover:bg-a-row-hover hover:text-a-ink"
                aria-label="Next month"
              >
                <ChevronRight className="size-4" strokeWidth={2.5} />
              </button>
            </div>
          </header>

          <div className="overflow-x-auto">
            <div className="min-w-[700px]">
              <div className="grid grid-cols-7 border-b border-a-line-soft pb-1.5" aria-hidden>
                {WEEKDAYS.map((d) => (
                  <div key={d} className="px-2 text-[12px] font-semibold text-a-faint">{d}</div>
                ))}
              </div>
              {weeks.map((week) => (
                <div key={week[0]} className="grid grid-cols-7">
                  {week.map((key) => (
                    <CalendarDay
                      key={key}
                      dateKey={key}
                      tasks={byDay.get(key) ?? []}
                      inMonth={isInMonth(key, month)}
                      isToday={key === todayKey}
                      now={now}
                      onOpen={onOpen}
                      onAddOnDate={onAddOnDate}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>

        <NoDateTray tasks={undated} now={now} onOpen={onOpen} />
      </div>

      <DragOverlay dropAnimation={null}>
        {active && (
          <div className="w-[180px] cursor-grabbing">
            <TaskChipBody todo={active} now={now} className="bg-a-bg shadow-lg" />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

interface CalendarDayProps {
  dateKey: string;
  tasks: Todo[];
  inMonth: boolean;
  isToday: boolean;
  now: Date;
  onOpen: (todo: Todo) => void;
  onAddOnDate: (dateKey: string) => void;
}

function CalendarDay({ dateKey, tasks, inMonth, isToday, now, onOpen, onAddOnDate }: CalendarDayProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `${CALENDAR_DAY_PREFIX}${dateKey}` });
  const label = longDate(dateKey);

  return (
    <div
      ref={setNodeRef}
      role="group"
      aria-label={label}
      className={cn(
        'group/day flex min-h-[112px] min-w-0 flex-col gap-1 border-b border-r border-a-line-soft p-1.5 transition-colors duration-150 first:border-l',
        !inMonth && 'bg-[color-mix(in_srgb,var(--a-ink)_2.5%,transparent)]',
        isOver && 'bg-a-row-hover shadow-[inset_0_0_0_1.5px_var(--a-accent)]',
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            'flex size-6 items-center justify-center rounded-full text-[12.5px] tabular-nums',
            isToday ? 'bg-a-accent font-bold text-a-bg' : inMonth ? 'text-a-ink' : 'text-a-faint',
          )}
          aria-current={isToday ? 'date' : undefined}
        >
          {Number(dateKey.slice(8))}
        </span>
        <button
          type="button"
          onClick={() => onAddOnDate(dateKey)}
          className="flex size-6 items-center justify-center rounded-full text-a-faint opacity-0 transition-opacity duration-150 group-hover/day:opacity-100 focus-visible:opacity-100 hover:text-a-ink"
          aria-label={`Add task on ${label}`}
        >
          <Plus className="size-3.5" strokeWidth={2.75} />
        </button>
      </div>
      {tasks.map((todo) => <TaskChip key={todo.id} todo={todo} now={now} onOpen={onOpen} />)}
    </div>
  );
}

function NoDateTray({ tasks, now, onOpen }: { tasks: Todo[]; now: Date; onOpen: (todo: Todo) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${CALENDAR_DAY_PREFIX}${NO_DATE}` });

  return (
    <aside
      aria-label="Tasks without a due date"
      className="w-full flex-shrink-0 xl:w-[240px]"
    >
      <h2 className="mb-3 flex items-baseline gap-2 font-display text-[16px] leading-tight text-a-ink">
        No due date
        <span className="font-sans text-[12.5px] font-bold tabular-nums text-a-muted">{tasks.length}</span>
      </h2>
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-[96px] flex-col gap-1 rounded-[14px] bg-[color-mix(in_srgb,var(--a-ink)_4%,transparent)] p-2 transition-[background-color,box-shadow] duration-150',
          isOver && 'bg-a-row-hover shadow-[inset_0_0_0_1.5px_var(--a-accent)]',
        )}
      >
        {tasks.map((todo) => <TaskChip key={todo.id} todo={todo} now={now} onOpen={onOpen} />)}
        {tasks.length === 0 && (
          <p className="px-2 py-5 text-center text-[12.5px] leading-relaxed text-a-faint">
            Every task has a date. Drop one here to take its date off.
          </p>
        )}
      </div>
    </aside>
  );
}

function TaskChip({ todo, now, onOpen }: { todo: Todo; now: Date; onOpen: (todo: Todo) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: todo.id });

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={() => onOpen(todo)}
      aria-roledescription="Draggable task"
      aria-label={`${todo.text}${todo.dueTime ? `, ${todo.dueTime}` : ''}${todo.status === 'done' ? ', done' : ''}`}
      className={cn('block w-full touch-none text-left', isDragging && 'opacity-40')}
    >
      <TaskChipBody todo={todo} now={now} />
    </button>
  );
}

function TaskChipBody({ todo, now, className }: { todo: Todo; now: Date; className?: string }) {
  const quadrant = QUADRANTS.find((q) => q.id === todo.quadrant) ?? QUADRANTS[0];
  const isDone = todo.status === 'done';
  const due = !isDone && todo.dueDate ? getDueInfo(todo.dueDate, todo.dueTime) : null;
  // getDueInfo reads the real clock; for a past day it agrees with `now` anyway.
  const overdue = !!due?.isOverdue && todo.dueDate! <= localDateKey(now);

  return (
    <span
      className={cn(
        'flex min-w-0 items-center gap-1.5 rounded-[8px] px-1.5 py-1 text-[12.5px] leading-tight transition-colors duration-150 hover:bg-a-row-hover',
        className,
      )}
    >
      <span className={cn('size-[7px] flex-shrink-0 rounded-full', quadrant.dotClass)} aria-hidden />
      {todo.dueTime && (
        <span className={cn('flex-shrink-0 tabular-nums', overdue ? 'font-semibold text-q-do' : 'text-a-faint')}>{todo.dueTime}</span>
      )}
      <span className={cn('min-w-0 truncate', isDone ? 'text-a-faint line-through' : overdue ? 'text-q-do' : 'text-a-ink')}>
        {todo.text}
      </span>
    </span>
  );
}
