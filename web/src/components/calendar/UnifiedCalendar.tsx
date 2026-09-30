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
  /** Source ids that are switched off (from the sidebar's Sources list); everything else shows. */
  hiddenSources: string[];
  /** A drop: `date` is '' when dropped on the no-date tray. */
  onMove: (item: CalendarItem, date: string) => void;
  onOpen: (item: CalendarItem) => void;
  /** The + on a day. The caller asks what to create. */
  onAddOnDate: (dateKey: string, anchor: HTMLElement) => void;
  loading?: boolean;
  /** Today, for tests. */
  today?: Date;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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
  items, sources, hiddenSources, onMove, onOpen, onAddOnDate, loading, today,
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

  // DS IconButton, outline, sm (showcase 797): 28px, 1px strong border, 4px radius.
  const NAV_BUTTON = 'flex size-7 items-center justify-center rounded-[4px] border border-a-line-strong text-a-muted transition-colors duration-[120ms] hover:bg-a-line-soft hover:text-a-ink';

  return (
    <DndContext
      sensors={sensors}
      onDragStart={({ active: dragged }) => setActiveId(String(dragged.id))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={handleDragEnd}
    >
      <div className="mx-auto max-w-[1200px] animate-fade-in">
        <section className="min-w-0" aria-label={`Calendar, ${monthLabel}`}>
          <header className="mb-3 flex items-center gap-2">
            <button type="button" onClick={() => setMonth((m) => shiftMonth(m, -1))} className={NAV_BUTTON} aria-label="Previous month">
              <ChevronLeft className="size-4" strokeWidth={1.75} />
            </button>
            <button type="button" onClick={() => setMonth((m) => shiftMonth(m, 1))} className={NAV_BUTTON} aria-label="Next month">
              <ChevronRight className="size-4" strokeWidth={1.75} />
            </button>
            <h2 className="mx-2 text-[20px] leading-tight font-semibold text-a-ink">{monthLabel}</h2>
            <button
              type="button"
              onClick={() => setMonth(monthOf(now))}
              className="h-7 rounded-[3px] border border-a-line-strong bg-a-surface px-3 text-[11px] font-semibold text-a-ink transition-colors duration-[120ms] hover:bg-a-bg"
            >
              Today
            </button>
            {loading && <span className="text-[12px] text-a-faint">Loading…</span>}
          </header>

          <div className="overflow-x-auto">
            <div className="min-w-[700px] overflow-hidden rounded-[8px] border border-a-line bg-a-surface">
              <div className="grid grid-cols-7 border-b border-a-line bg-a-bg" aria-hidden>
                {WEEKDAYS.map((d) => (
                  <div key={d} className="px-2.5 py-2 text-[11px] font-semibold tracking-[0.06em] text-a-faint uppercase">{d}</div>
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
                      isPast={key < todayKey}
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
            <ItemChipBody item={active} dotBySource={dotBySource} className="shadow-lg" />
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
  /** Before today: an open task here is overdue. */
  isPast: boolean;
  dotBySource: Map<string, string>;
  onOpen: (item: CalendarItem) => void;
  onAddOnDate: (dateKey: string, anchor: HTMLElement) => void;
}

function CalendarDay({ dateKey, items, inMonth, isToday, isPast, dotBySource, onOpen, onAddOnDate }: CalendarDayProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `${CALENDAR_DAY_PREFIX}${dateKey}` });
  const label = longDate(dateKey);
  const overdue = (item: CalendarItem) => isPast && item.kind === 'task' && !item.done;

  return (
    <div
      ref={setNodeRef}
      role="group"
      aria-label={label}
      // Showcase 806: 104px, 6px 8px, a 3px gap, hairlines right and below.
      className={cn(
        'group/day relative flex min-h-[104px] min-w-0 flex-col gap-[3px] border-r border-b border-a-line-soft px-2 py-1.5 transition-colors duration-[120ms]',
        !inMonth && 'bg-a-bg',
        isOver && 'bg-a-row-hover shadow-[inset_0_0_0_1.5px_var(--a-accent)]',
      )}
    >
      <span
        className={cn(
          // design-check-ignore: pill — the day number is a 99px-radius badge (showcase 807).
          'inline-grid h-[22px] min-w-[22px] place-items-center self-start rounded-full px-1 text-[12px] tabular-nums',
          isToday ? 'bg-a-accent font-bold text-a-surface' : cn('font-medium', inMonth ? 'text-a-ink' : 'text-a-disabled'),
        )}
        aria-current={isToday ? 'date' : undefined}
      >
        {Number(dateKey.slice(8))}
      </span>

      {/* Not in the prototype's cells; kept for picking any day, and shown only on hover. */}
      <button
        type="button"
        onClick={(e) => onAddOnDate(dateKey, e.currentTarget)}
        className="absolute top-1.5 right-1.5 flex size-[22px] items-center justify-center rounded-full text-a-faint opacity-0 transition-opacity duration-[120ms] group-hover/day:opacity-100 focus-visible:opacity-100 hover:text-a-ink"
        aria-label={`Add on ${label}`}
      >
        <Plus className="size-3.5" strokeWidth={1.75} />
      </button>

      {items.slice(0, MAX_CHIPS).map((item) => (
        <ItemChip key={`${item.kind}:${item.id}`} item={item} overdue={overdue(item)} dotBySource={dotBySource} onOpen={onOpen} />
      ))}

      {items.length > MAX_CHIPS && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="rounded-[4px] pl-1.5 text-left text-[11px] text-a-faint transition-colors duration-[120ms] hover:text-a-ink"
              aria-label={`Show all ${items.length} on ${label}`}
            >
              {`+${items.length - MAX_CHIPS} more`}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="flex w-[260px] flex-col gap-[3px] p-2">
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
                <ItemChipBody item={item} overdue={overdue(item)} dotBySource={dotBySource} />
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

/** Showcase 821: a dashed panel under the grid — "Not on a date", a count, a Tag per item, a hint. */
function NoDateTray({
  items, dotBySource, onOpen,
}: { items: CalendarItem[]; dotBySource: Map<string, string>; onOpen: (item: CalendarItem) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${CALENDAR_DAY_PREFIX}${NO_DATE}` });

  return (
    <aside
      ref={setNodeRef}
      aria-label="Without a date"
      className={cn(
        'mt-4 flex flex-wrap items-center gap-3 rounded-[8px] border border-dashed border-a-line-strong bg-a-surface px-4 py-3 text-[13px] transition-[background-color,box-shadow] duration-[120ms]',
        isOver && 'bg-a-row-hover shadow-[inset_0_0_0_1.5px_var(--a-accent)]',
      )}
    >
      <h2 className="font-semibold text-a-ink">Not on a date</h2>
      <span className="font-mono text-[11px] text-a-faint">{items.length}</span>
      {items.map((item) => (
        <ItemChip key={`${item.kind}:${item.id}`} item={item} tag dotBySource={dotBySource} onOpen={onOpen} />
      ))}
      <span className="text-[12px] text-a-faint">
        {items.length > 0
          ? 'Drag one onto a day to give it a due date.'
          : 'Everything has a date. Drop something here to take its date off.'}
      </span>
    </aside>
  );
}

interface ItemChipProps {
  item: CalendarItem;
  dotBySource: Map<string, string>;
  onOpen: (item: CalendarItem) => void;
  /** The open task's day has passed. */
  overdue?: boolean;
  /** The DS Tag in the tray, rather than a day's chip. */
  tag?: boolean;
}

function ItemChip(props: ItemChipProps) {
  if (props.item.kind === 'zoho') return <ReadOnlyItemChip {...props} />;
  return <DraggableItemChip {...props} />;
}

function DraggableItemChip({ item, overdue, tag, dotBySource, onOpen }: ItemChipProps) {
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
      className={cn('touch-none text-left', tag ? 'inline-flex' : 'block w-full', isDragging && 'opacity-40')}
    >
      <ItemChipBody item={item} overdue={overdue} tag={tag} dotBySource={dotBySource} />
    </button>
  );
}

function ReadOnlyItemChip({ item, overdue, tag, dotBySource, onOpen }: ItemChipProps) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      aria-roledescription="Read-only Zoho Calendar event"
      aria-label={`${item.title}${item.time ? `, ${item.time}` : ''} — ${item.sourceName}`}
      className={cn('cursor-default text-left', tag ? 'inline-flex' : 'block w-full')}
    >
      <ItemChipBody item={item} overdue={overdue} tag={tag} dotBySource={dotBySource} />
    </button>
  );
}

function ItemChipBody({
  item, dotBySource, overdue, tag, className,
}: { item: CalendarItem; dotBySource: Map<string, string>; overdue?: boolean; tag?: boolean; className?: string }) {
  if (tag) {
    // DS Tag (showcase 823): 24px, 1px border, 4px radius, 11px / 500 secondary.
    return (
      <span
        title={`${item.title} — ${item.sourceName}`}
        className={cn('inline-flex h-6 items-center rounded-[4px] border border-a-line bg-a-surface px-2 text-[11px] font-medium whitespace-nowrap text-a-muted transition-colors duration-[120ms] hover:bg-a-bg', className)}
      >
        {item.title}
      </span>
    );
  }
  // Showcase 810: a 6px dot and the title on a grey chip; done is tertiary and struck, overdue is red.
  return (
    <span
      title={`${item.title} — ${item.sourceName}`}
      className={cn(
        'flex min-w-0 items-center gap-1.5 rounded-[4px] px-1.5 py-[2px] text-[12px] leading-[1.4]',
        overdue ? 'bg-a-red-tint text-q-do' : 'bg-a-bg',
        className,
      )}
    >
      <span
        className={cn('size-1.5 flex-shrink-0 rounded-full', dotBySource.get(item.sourceId) ?? 'bg-a-accent')}
        aria-hidden
      />
      {item.time && <span className="flex-shrink-0 tabular-nums text-a-faint">{item.time}</span>}
      <span className={cn('min-w-0 truncate', item.done ? 'text-a-faint line-through' : overdue ? '' : 'text-a-ink')}>
        {item.title}
      </span>
    </span>
  );
}
