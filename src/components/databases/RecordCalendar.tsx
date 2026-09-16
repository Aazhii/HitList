/**
 * A database's records on a month grid, by one of its date fields.
 *
 * A record has no due date of its own, so the database says which date field
 * the calendar reads. Everything else is the tasks calendar: the same month
 * grid (monthWeeks), the same drop rules (calendarDrop), the same no-date tray.
 * Dragging a record to a day writes that day into the chosen field; dropping it
 * on the tray clears it.
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
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { localDateKey } from '@/lib/taskFilters';
import {
  CALENDAR_DAY_PREFIX, NO_DATE, isInMonth, monthOf, monthWeeks, recordsByDay, shiftMonth,
} from '@/lib/calendar';
import type { ApiDatabaseRow } from '@/lib/api';
import type { FieldDef, TaskFieldValues } from '@/types/fields';

export interface RecordCalendarProps {
  rows: ApiDatabaseRow[];
  fields: FieldDef[];
  /** recordId → fieldId → value. */
  values: TaskFieldValues;
  /** The date field the calendar reads, or null until the database picks one. */
  dateField: FieldDef | null;
  onDateFieldChange: (fieldId: string) => void;
  onManageFields: () => void;
  /** Writes a YYYY-MM-DD day into the date field, or clears it. */
  onSetDate: (recordId: string, fieldId: string, day: string | null) => void;
  /** Adds a record already on that day. */
  onAdd?: (title: string, day: string) => void;
  /** Today, for tests. */
  today?: Date;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_CHIPS = 3;

const byOrder = (a: ApiDatabaseRow, b: ApiDatabaseRow) => a.rowOrder - b.rowOrder || a.createdAt - b.createdAt;

function dateFromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const longDate = (key: string) =>
  dateFromKey(key).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

export function RecordCalendar({
  rows, fields, values, dateField, onDateFieldChange, onManageFields, onSetDate, onAdd, today,
}: RecordCalendarProps) {
  const now = today ?? new Date();
  const todayKey = localDateKey(now);
  const [month, setMonth] = useState(() => monthOf(now));
  const [activeId, setActiveId] = useState<string | null>(null);

  const dateFields = fields.filter((f) => f.kind === 'date');

  const weeks = useMemo(() => monthWeeks(month), [month]);
  const { byDay, undated } = useMemo(
    () => (dateField
      ? recordsByDay(rows, dateField.id, values, byOrder)
      : { byDay: new Map<string, ApiDatabaseRow[]>(), undated: [] as ApiDatabaseRow[] }),
    [rows, dateField, values],
  );

  const sensors = useSensors(
    // A small distance, so a click on a record is not mistaken for a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  if (!dateField) {
    return (
      <CalendarSetup
        dateFields={dateFields}
        onDateFieldChange={onDateFieldChange}
        onManageFields={onManageFields}
      />
    );
  }

  const active = activeId ? rows.find((r) => r.id === activeId) : undefined;
  const monthLabel = new Date(month.year, month.month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const handleDragEnd = ({ active: dragged, over }: DragEndEvent) => {
    setActiveId(null);
    const overId = over ? String(over.id) : null;
    if (!overId || !overId.startsWith(CALENDAR_DAY_PREFIX)) return;

    const recordId = String(dragged.id);
    const target = overId.slice(CALENDAR_DAY_PREFIX.length);
    const current = values[recordId]?.[dateField.id];
    const currentDay = typeof current === 'string' ? current : '';

    if (target === NO_DATE) {
      if (currentDay) onSetDate(recordId, dateField.id, null);
      return;
    }
    if (target !== currentDay) onSetDate(recordId, dateField.id, target);
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
          <header className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="font-display text-[20px] leading-tight text-a-ink">{monthLabel}</h2>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-8 items-center gap-1.5 rounded-full px-3 text-[13.5px] text-a-muted shadow-[inset_0_0_0_1px_var(--a-line)] transition-colors duration-150 hover:text-a-ink"
                  aria-label={`Dates from ${dateField.name}`}
                >
                  <CalendarDays className="size-3.5" strokeWidth={2.5} aria-hidden />
                  Dates: <span className="font-semibold text-a-ink">{dateField.name}</span>
                  <ChevronDown className="size-3" strokeWidth={2.75} aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {dateFields.map((f) => (
                  <DropdownMenuItem key={f.id} onClick={() => onDateFieldChange(f.id)}>
                    <Check className={cn('size-3.5', f.id !== dateField.id && 'opacity-0')} aria-hidden />
                    {f.name}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onManageFields}>
                  <Plus className="size-3.5" aria-hidden /> Create a date column…
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onDateFieldChange('')}>
                  Choose later
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

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
                      records={byDay.get(key) ?? []}
                      inMonth={isInMonth(key, month)}
                      isToday={key === todayKey}
                      onAdd={onAdd}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>

        <NoDateTray records={undated} fieldName={dateField.name} />
      </div>

      <DragOverlay dropAnimation={null}>
        {active && (
          <div className="w-[180px] cursor-grabbing">
            <RecordChipBody title={active.title} className="bg-a-bg shadow-lg" />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

interface CalendarDayProps {
  dateKey: string;
  records: ApiDatabaseRow[];
  inMonth: boolean;
  isToday: boolean;
  onAdd?: (title: string, day: string) => void;
}

function CalendarDay({ dateKey, records, inMonth, isToday, onAdd }: CalendarDayProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `${CALENDAR_DAY_PREFIX}${dateKey}` });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const label = longDate(dateKey);

  const commit = () => {
    const trimmed = title.trim();
    if (trimmed && onAdd) onAdd(trimmed, dateKey);
    setTitle('');
    setAdding(false);
  };

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
        {onAdd && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex size-6 items-center justify-center rounded-full text-a-faint opacity-0 transition-opacity duration-150 group-hover/day:opacity-100 focus-visible:opacity-100 hover:text-a-ink"
            aria-label={`Add record on ${label}`}
          >
            <Plus className="size-3.5" strokeWidth={2.75} />
          </button>
        )}
      </div>

      {records.slice(0, MAX_CHIPS).map((record) => (
        <RecordChip key={record.id} record={record} />
      ))}
      {records.length > MAX_CHIPS && (
        <span className="px-1.5 text-[12px] font-semibold text-a-muted">
          +{records.length - MAX_CHIPS} more
        </span>
      )}

      {adding && (
        <input
          autoFocus
          value={title}
          maxLength={255}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { setTitle(''); setAdding(false); }
          }}
          placeholder="What is it?"
          aria-label={`New record on ${label}`}
          className="mt-0.5 h-7 w-full rounded-[8px] bg-a-bg px-1.5 text-[12.5px] text-a-ink shadow-[inset_0_0_0_1px_var(--a-line)] outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--a-accent)]"
        />
      )}
    </div>
  );
}

function NoDateTray({ records, fieldName }: { records: ApiDatabaseRow[]; fieldName: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${CALENDAR_DAY_PREFIX}${NO_DATE}` });

  return (
    <aside aria-label={`Records with no ${fieldName}`} className="w-full flex-shrink-0 xl:w-[240px]">
      <h2 className="mb-3 flex items-baseline gap-2 font-display text-[16px] leading-tight text-a-ink">
        No {fieldName}
        <span className="font-sans text-[12.5px] font-bold tabular-nums text-a-muted">{records.length}</span>
      </h2>
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-[96px] flex-col gap-1 rounded-[14px] bg-[color-mix(in_srgb,var(--a-ink)_4%,transparent)] p-2 transition-[background-color,box-shadow] duration-150',
          isOver && 'bg-a-row-hover shadow-[inset_0_0_0_1.5px_var(--a-accent)]',
        )}
      >
        {records.map((record) => <RecordChip key={record.id} record={record} />)}
        {records.length === 0 && (
          <p className="px-2 py-5 text-center text-[12.5px] leading-relaxed text-a-faint">
            Every record has a date. Drop one here to take its date off.
          </p>
        )}
      </div>
    </aside>
  );
}

function RecordChip({ record }: { record: ApiDatabaseRow }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: record.id });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-roledescription="Draggable record"
      aria-label={record.title}
      className={cn('block w-full cursor-grab touch-none text-left outline-none', isDragging && 'opacity-40')}
    >
      <RecordChipBody title={record.title} />
    </div>
  );
}

function RecordChipBody({ title, className }: { title: string; className?: string }) {
  return (
    <span
      title={title}
      className={cn(
        'flex min-w-0 items-center gap-1.5 rounded-[8px] px-1.5 py-1 text-[12.5px] leading-tight text-a-ink transition-colors duration-150 hover:bg-a-row-hover',
        className,
      )}
    >
      <span className="size-[7px] flex-shrink-0 rounded-full bg-a-accent" aria-hidden />
      <span className="min-w-0 truncate">{title}</span>
    </span>
  );
}

interface CalendarSetupProps {
  dateFields: FieldDef[];
  onDateFieldChange: (fieldId: string) => void;
  onManageFields: () => void;
}

/** Shown until the database has a date column for its calendar to read. */
function CalendarSetup({ dateFields, onDateFieldChange, onManageFields }: CalendarSetupProps) {
  return (
    <div className="mx-auto flex max-w-[480px] flex-col items-center py-16 text-center animate-fade-in">
      <CalendarDays className="mb-3 size-6 text-a-faint" strokeWidth={2.25} aria-hidden />
      <p className="font-display text-[20px] text-a-ink">Choose the dates</p>

      {dateFields.length === 0 ? (
        <>
          <p className="mt-2 text-[14px] leading-relaxed text-a-muted">
            A record has no due date of its own, so the calendar reads one of this database's Date
            columns. There isn't one yet.
          </p>
          <button
            type="button"
            onClick={onManageFields}
            className="mt-4 flex items-center gap-1.5 rounded-full bg-a-accent px-4 py-2 text-[13.5px] font-semibold text-a-bg transition-colors duration-150 hover:bg-a-accent-600"
          >
            <Plus className="size-3.5" strokeWidth={2.75} aria-hidden />
            Create a date column
          </button>
        </>
      ) : (
        <>
          <p className="mt-2 text-[14px] leading-relaxed text-a-muted">
            Pick the date column the calendar should read. Dragging a record to another day writes
            that day into it.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {dateFields.map((field) => (
              <button
                key={field.id}
                type="button"
                onClick={() => onDateFieldChange(field.id)}
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
