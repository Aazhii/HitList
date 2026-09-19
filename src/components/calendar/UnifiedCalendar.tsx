/**
 * One calendar for everything that has a date.
 *
 * A month grid carrying two kinds of thing at once: tasks by their due date, and
 * database records by whichever date column their database chose. This replaces
 * the two separate calendars — one on the tasks tab, one inside a database —
 * because a month is a month, and having to look in two places to see one week
 * was the problem.
 *
 * Everything is dragged the same way, and what a drop *means* is the caller's:
 * a task writes its due date, a record writes its database's date column.
 *
 * The grid arithmetic (monthWeeks, the day and tray drop targets) is shared with
 * nothing else now — it lives in lib/calendar.ts and is reused unchanged.
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { localDateKey } from '@/lib/taskFilters';
import {
  CALENDAR_DAY_PREFIX, NO_DATE, isInMonth, monthOf, monthWeeks, shiftMonth,
} from '@/lib/calendar';

/** A task or a record, reduced to what a month grid actually needs. */
export interface CalendarItem {
  kind: 'task' | 'record' | 'zoho';
  /** Task id, or record id. */
  id: string;
  title: string;
  /** YYYY-MM-DD, or '' for the no-date tray. */
  date: string;
  /** HH:MM; tasks only. */
  time?: string;
  /** Which list or database it came from — drives the colour dot and the chips. */
  sourceId: string;
  sourceName: string;
  /** A done task is dimmed and struck through. */
  done?: boolean;
}

export interface CalendarSource {
  kind: 'task' | 'record' | 'zoho';
  id: string;
  name: string;
  /** A tailwind class for the 7px dot, so lists keep their colours. */
  dotClass: string;
}

export interface UnifiedCalendarProps {
  items: CalendarItem[];
  sources: CalendarSource[];
  /** Source ids that are switched off; everything else shows. */
  hiddenSources: string[];
  onToggleSource: (sourceId: string) => void;
  /** A drop: `date` is '' when dropped on the no-date tray. */
  onMove: (item: CalendarItem, date: string) => void;
  onOpen: (item: CalendarItem) => void;
  /** The + on a day. The caller asks what to create. */
  onAddOnDate: (dateKey: string, anchor: HTMLElement) => void;
  loading?: boolean;
  /** Today, for tests. */
  today?: Date;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** Chips per day before the rest go behind "+N more". */
const MAX_CHIPS = 3;

function dateFromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const longDate = (key: string) =>
  dateFromKey(key).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

/** Timed items first, in time order, then the rest; done last. */
function withinDay(a: CalendarItem, b: CalendarItem): number {
  const done = (a.done ? 1 : 0) - (b.done ? 1 : 0);
  if (done !== 0) return done;
  if (a.time && b.time && a.time !== b.time) return a.time < b.time ? -1 : 1;
  if (!!a.time !== !!b.time) return a.time ? -1 : 1;
  return a.title.localeCompare(b.title);
}

export function UnifiedCalendar({
  items, sources, hiddenSources, onToggleSource, onMove, onOpen, onAddOnDate, loading, today,
}: UnifiedCalendarProps) {
  const now = today ?? new Date();
  const todayKey = localDateKey(now);
  const [month, setMonth] = useState(() => monthOf(now));
  const [activeId, setActiveId] = useState<string | null>(null);

  const weeks = useMemo(() => monthWeeks(month), [month]);
  const dotBySource = useMemo(
    () => new Map(sources.map((s) => [s.id, s.dotClass])),
    [sources],
  );

  const { byDay, undated } = useMemo(() => {
    const hidden = new Set(hiddenSources);
    const shown = items.filter((i) => !hidden.has(i.sourceId));
    const map = new Map<string, CalendarItem[]>();
    const tray: CalendarItem[] = [];

    for (const item of shown) {
      if (!item.date) { tray.push(item); continue; }
      const day = map.get(item.date);
      if (day) day.push(item); else map.set(item.date, [item]);
    }
    for (const day of map.values()) day.sort(withinDay);
    tray.sort(withinDay);
    return { byDay: map, undated: tray };
  }, [items, hiddenSources]);

  const sensors = useSensors(
    // A small distance, so clicking an item opens it rather than starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const active = activeId ? items.find((i) => `${i.kind}:${i.id}` === activeId) : undefined;
  const monthLabel = new Date(month.year, month.month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const handleDragEnd = ({ active: dragged, over }: DragEndEvent) => {
    setActiveId(null);
    const overId = over ? String(over.id) : null;
    if (!overId || !overId.startsWith(CALENDAR_DAY_PREFIX)) return;

    const item = items.find((i) => `${i.kind}:${i.id}` === String(dragged.id));
    if (!item) return;

    const target = overId.slice(CALENDAR_DAY_PREFIX.length);
    const date = target === NO_DATE ? '' : target;
    if (date === item.date) return;
    onMove(item, date);
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
            {loading && <span className="text-[12.5px] text-a-faint">Loading…</span>}

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

          {sources.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="What the calendar shows">
              {sources.map((source) => {
                const on = !hiddenSources.includes(source.id);
                return (
                  <button
                    key={source.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onToggleSource(source.id)}
                    className={cn(
                      'flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] transition-colors duration-150',
                      on
                        ? 'text-a-ink shadow-[inset_0_0_0_1px_var(--a-line)]'
                        : 'text-a-faint shadow-[inset_0_0_0_1px_var(--a-line-soft)]',
                    )}
                  >
                    <span className={cn('size-[7px] rounded-full', on ? source.dotClass : 'bg-a-faint/40')} aria-hidden />
                    {source.name}
                  </button>
                );
              })}
            </div>
          )}

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
                      items={byDay.get(key) ?? []}
                      inMonth={isInMonth(key, month)}
                      isToday={key === todayKey}
                      dotBySource={dotBySource}
                      onOpen={onOpen}
                      onAddOnDate={onAddOnDate}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>

        <NoDateTray items={undated} dotBySource={dotBySource} onOpen={onOpen} />
      </div>

      <DragOverlay dropAnimation={null}>
        {active && (
          <div className="w-[180px] cursor-grabbing">
            <ItemChipBody item={active} dotBySource={dotBySource} className="bg-a-bg shadow-lg" />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

interface CalendarDayProps {
  dateKey: string;
  items: CalendarItem[];
  inMonth: boolean;
  isToday: boolean;
  dotBySource: Map<string, string>;
  onOpen: (item: CalendarItem) => void;
  onAddOnDate: (dateKey: string, anchor: HTMLElement) => void;
}

function CalendarDay({ dateKey, items, inMonth, isToday, dotBySource, onOpen, onAddOnDate }: CalendarDayProps) {
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
          onClick={(e) => onAddOnDate(dateKey, e.currentTarget)}
          className="flex size-6 items-center justify-center rounded-full text-a-faint opacity-0 transition-opacity duration-150 group-hover/day:opacity-100 focus-visible:opacity-100 hover:text-a-ink"
          aria-label={`Add on ${label}`}
        >
          <Plus className="size-3.5" strokeWidth={2.75} />
        </button>
      </div>

      {items.slice(0, MAX_CHIPS).map((item) => (
        <ItemChip key={`${item.kind}:${item.id}`} item={item} dotBySource={dotBySource} onOpen={onOpen} />
      ))}

      {items.length > MAX_CHIPS && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="rounded-[8px] px-1.5 py-0.5 text-left text-[12px] font-semibold text-a-muted transition-colors duration-150 hover:bg-a-row-hover hover:text-a-ink"
              aria-label={`Show all ${items.length} on ${label}`}
            >
              +{items.length - MAX_CHIPS} more
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[260px] p-2">
            <p className="px-1.5 pb-1.5 text-[12px] font-semibold text-a-muted">{label}</p>
            {/* Click to open. Dragging stays on the grid: a drag inside a popover
                fights the popover's own dismissal. */}
            {items.map((item) => (
              <button
                key={`${item.kind}:${item.id}`}
                type="button"
                onClick={() => onOpen(item)}
                className="block w-full text-left"
                aria-label={`${item.title}${item.time ? `, ${item.time}` : ''}`}
              >
                <ItemChipBody item={item} dotBySource={dotBySource} />
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function NoDateTray({
  items, dotBySource, onOpen,
}: { items: CalendarItem[]; dotBySource: Map<string, string>; onOpen: (item: CalendarItem) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${CALENDAR_DAY_PREFIX}${NO_DATE}` });

  return (
    <aside aria-label="Without a date" className="w-full flex-shrink-0 xl:w-[240px]">
      <h2 className="mb-3 flex items-baseline gap-2 font-display text-[16px] leading-tight text-a-ink">
        No date
        <span className="font-sans text-[12.5px] font-bold tabular-nums text-a-muted">{items.length}</span>
      </h2>
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-[96px] flex-col gap-1 rounded-[14px] bg-[color-mix(in_srgb,var(--a-ink)_4%,transparent)] p-2 transition-[background-color,box-shadow] duration-150',
          isOver && 'bg-a-row-hover shadow-[inset_0_0_0_1.5px_var(--a-accent)]',
        )}
      >
        {items.map((item) => (
          <ItemChip key={`${item.kind}:${item.id}`} item={item} dotBySource={dotBySource} onOpen={onOpen} />
        ))}
        {items.length === 0 && (
          <p className="px-2 py-5 text-center text-[12.5px] leading-relaxed text-a-faint">
            Everything has a date. Drop something here to take its date off.
          </p>
        )}
      </div>
    </aside>
  );
}

function ItemChip({
  item, dotBySource, onOpen,
}: { item: CalendarItem; dotBySource: Map<string, string>; onOpen: (item: CalendarItem) => void }) {
  if (item.kind === 'zoho') {
    return <ReadOnlyItemChip item={item as CalendarItem & { kind: 'zoho' }} dotBySource={dotBySource} onOpen={onOpen} />;
  }
  return <DraggableItemChip item={item as CalendarItem & { kind: 'task' | 'record' }} dotBySource={dotBySource} onOpen={onOpen} />;
}

function DraggableItemChip({
  item, dotBySource, onOpen,
}: { item: CalendarItem & { kind: 'task' | 'record' }; dotBySource: Map<string, string>; onOpen: (item: CalendarItem) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `${item.kind}:${item.id}` });

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={() => onOpen(item)}
      aria-roledescription={item.kind === 'task' ? 'Draggable task' : 'Draggable record'}
      aria-label={`${item.title}${item.time ? `, ${item.time}` : ''}${item.done ? ', done' : ''} — ${item.sourceName}`}
      className={cn('block w-full touch-none text-left', isDragging && 'opacity-40')}
    >
      <ItemChipBody item={item} dotBySource={dotBySource} />
    </button>
  );
}

function ReadOnlyItemChip({
  item, dotBySource, onOpen,
}: { item: CalendarItem & { kind: 'zoho' }; dotBySource: Map<string, string>; onOpen: (item: CalendarItem) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      aria-roledescription="Read-only Zoho Calendar event"
      aria-label={`${item.title}${item.time ? `, ${item.time}` : ''} — ${item.sourceName}`}
      className="block w-full cursor-default text-left"
    >
      <ItemChipBody item={item} dotBySource={dotBySource} />
    </button>
  );
}

function ItemChipBody({
  item, dotBySource, className,
}: { item: CalendarItem; dotBySource: Map<string, string>; className?: string }) {
  return (
    <span
      title={`${item.title} — ${item.sourceName}`}
      className={cn(
        'flex min-w-0 items-center gap-1.5 rounded-[8px] px-1.5 py-1 text-[12.5px] leading-tight transition-colors duration-150 hover:bg-a-row-hover',
        className,
      )}
    >
      <span
        className={cn('size-[7px] flex-shrink-0 rounded-full', dotBySource.get(item.sourceId) ?? 'bg-a-accent')}
        aria-hidden
      />
      {item.time && <span className="flex-shrink-0 tabular-nums text-a-faint">{item.time}</span>}
      <span className={cn('min-w-0 truncate', item.done ? 'text-a-faint line-through' : 'text-a-ink')}>
        {item.title}
      </span>
    </span>
  );
}
