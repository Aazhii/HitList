/**
 * The Calendar view: one month for everything that has a date.
 *
 * Tasks come from their due date, records from whichever date column their
 * database chose, and both are dragged the same way — what a drop writes is the
 * only difference. Before this there were two calendars, one per tab, and a week
 * could only be seen half at a time.
 *
 * Everything is loaded in one request (`GET /api/calendar`) rather than a fetch
 * per database.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ViewLayoutContext, ContextSectionHeader, contextRowClass } from '@/components/shell/ViewLayout';
import { EmptyState, ILL } from '@/components/EmptyState';
import { TopBar, topBarPill } from '@/components/shell/TopBar';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import {
  UnifiedCalendar, type CalendarItem, type CalendarSource,
} from '@/components/calendar/UnifiedCalendar';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import {
  calendarApi, databaseApi, taskApi, ZOHO_CALENDAR_UNAVAILABLE_REASON,
  type CalendarRecord, type CalendarTask,
} from '@/lib/api';
import { getListColorDot, type KaizenList } from '@/types/todo';
import { localDateKey } from '@/lib/taskFilters';

export interface CalendarPageProps {
  lists: KaizenList[];
  /** Opens a task in the tasks view. */
  onOpenTask: (taskId: string) => void;
  /** Opens the database a record belongs to. */
  onOpenDatabase: (databaseId: string) => void;
  /** The sidebar (rendered by App) now owns "What's on it" — reports it up
   * instead of rendering its own context column. */
  onSidebarContentChange?: (context: ReactNode) => void;
  /** The month on show, for the breadcrumb ("Calendar / September 2026"). */
  onMonthLabelChange?: (label: string) => void;
  /** Opens the app-level sidebar's mobile sheet. */
  onOpenSidebar?: () => void;
}

export function CalendarPage({ lists, onOpenTask, onOpenDatabase, onSidebarContentChange, onMonthLabelChange, onOpenSidebar }: CalendarPageProps) {
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [records, setRecords] = useState<CalendarRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(true);
  const [hiddenSources, setHiddenSources] = useLocalStorage<string[]>('hitlist-calendar-hidden-v1', []);

  const load = useCallback(async () => {
    try {
      const { tasks: t, records: r } = await calendarApi.load();
      setTasks(t);
      setRecords(r);
      setOnline(true);
    } catch (e) {
      console.error('[calendar] load failed:', e);
      setOnline(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const listById = useMemo(() => new Map(lists.map((l) => [l.id, l])), [lists]);

  const items = useMemo<CalendarItem[]>(() => [
    ...tasks.map((t) => ({
      kind: 'task' as const,
      id: t.id,
      title: t.title,
      date: t.dueDate,
      time: t.dueTime || undefined,
      sourceId: t.listId,
      sourceName: listById.get(t.listId)?.name ?? 'Tasks',
      done: t.status === 'DONE',
    })),
    ...records.map((r) => ({
      kind: 'record' as const,
      id: r.id,
      title: r.title,
      date: r.date,
      sourceId: r.databaseId,
      sourceName: r.databaseName,
    })),
  ], [tasks, records, listById]);

  const sources = useMemo<CalendarSource[]>(() => {
    const out: CalendarSource[] = lists
      .filter((l) => tasks.some((t) => t.listId === l.id))
      .map((l) => ({ kind: 'task' as const, id: l.id, name: l.name, dotClass: getListColorDot(l.color) }));

    const seen = new Set<string>();
    for (const record of records) {
      if (seen.has(record.databaseId)) continue;
      seen.add(record.databaseId);
      out.push({ kind: 'record', id: record.databaseId, name: record.databaseName, dotClass: 'bg-a-sage' });
    }
    return out;
  }, [lists, tasks, records]);

  /** A task writes its due date; a record writes its database's date column. */
  const handleMove = useCallback(async (item: CalendarItem, date: string) => {
    const previous = item.date;
    const apply = (to: string) => {
      if (item.kind === 'task') {
        setTasks((prev) => prev.map((t) => (t.id === item.id ? { ...t, dueDate: to } : t)));
      } else if (item.kind === 'record') {
        setRecords((prev) => prev.map((r) => (r.id === item.id ? { ...r, date: to } : r)));
      }
    };
    apply(date);

    const write = async (to: string) => {
      if (item.kind === 'task') {
        // Taking the date off takes the time with it: a time with no day means nothing.
        await taskApi.update(item.id, to ? { dueDate: to } : { dueDate: '', dueTime: '' });
        return;
      }
      if (item.kind !== 'record') throw new Error('Only tasks and records can be moved');
      const database = await databaseApi.list().then((all) => all.find((d) => d.id === item.sourceId));
      if (!database?.dateFieldId) throw new Error('no date column');
      await databaseApi.setFieldValue(item.id, database.dateFieldId, to || null);
    };

    try {
      await write(date);
      toast.success(date ? 'Date moved' : 'Date removed', {
        duration: 5000,
        action: {
          label: 'Undo',
          onClick: () => {
            apply(previous);
            void write(previous).catch((e: unknown) => {
              console.error('[calendar] undo failed:', e);
              apply(date); toast.error("Couldn't undo");
            });
          },
        },
      });
    } catch (e) {
      console.error('[calendar] date change failed:', e);
      apply(previous);
      toast.error("Couldn't save the date");
    }
  }, []);

  const handleOpen = useCallback((item: CalendarItem) => {
    if (item.kind === 'task') onOpenTask(item.id);
    else if (item.kind === 'record') onOpenDatabase(item.sourceId);
  }, [onOpenTask, onOpenDatabase]);

  /** The day being added on, and the button it hangs from. */
  const [addOn, setAddOn] = useState<{ dateKey: string; anchor: HTMLElement } | null>(null);

  const count = items.length;
  const dated = items.filter((i) => i.date).length;

  // The sidebar (rendered by App) now owns "What's on it" — report it up
  // instead of rendering our own context column.
  useEffect(() => {
    onSidebarContentChange?.(
      <div className="mb-5">
        <ContextSectionHeader label="What's on it" />
        <p className="px-3 pb-2 text-[12px] leading-relaxed text-a-faint">
          Tasks with a due date, and records from every database that has chosen a date column.
          Drag anything to another day.
        </p>
        <p className="px-3 pb-3 text-[12px] leading-relaxed text-a-faint">
          {ZOHO_CALENDAR_UNAVAILABLE_REASON}
        </p>
        <ContextSectionHeader label="Sources" />
        <ul className="px-1">
          {sources.map((source) => {
            const on = !hiddenSources.includes(source.id);
            return (
              <li key={source.id}>
                {/* The sidebar's Sources are also the on/off switches for what the grid shows. */}
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => setHiddenSources((prev) => (
                    prev.includes(source.id) ? prev.filter((x) => x !== source.id) : [...prev, source.id]
                  ))}
                  className={cn(contextRowClass(false), 'gap-1.5')}
                >
                  <span className={`size-2 flex-shrink-0 rounded-full ${on ? source.dotClass : 'bg-a-faint/40'}`} aria-hidden />
                  <span className={`min-w-0 flex-1 truncate ${on ? '' : 'text-a-faint'}`}>{source.name}</span>
                  <span className="font-mono text-[11px] text-a-faint">
                    {items.filter((i) => i.sourceId === source.id).length}
                  </span>
                </button>
              </li>
            );
          })}
          {sources.length === 0 && !loading && (
            <li className="px-2 py-1 text-[12px] text-a-faint">Nothing has a date yet.</li>
          )}
        </ul>
      </div>,
    );
    return () => onSidebarContentChange?.(null);
     
  }, [sources, items, loading, hiddenSources]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <ViewLayoutContext.Provider value={{
        openContext: () => onOpenSidebar?.(),
        closeContext: () => {},
        toggleCollapsed: () => {},
        collapsible: false,
        collapsed: false,
      }}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar
          title="Calendar"
          subtitle={loading ? 'Loading…' : online ? `${dated} of ${count} on a date` : undefined}
          actions={
            // Ghost, not primary (showcase 139): the calendar's page action is a quiet one. Offline it
            // has nowhere to write, so it stays but is inert.
            <button
              type="button"
              disabled={!online}
              onClick={(e) => setAddOn({ dateKey: localDateKey(new Date()), anchor: e.currentTarget })}
              className={cn(topBarPill, 'disabled:opacity-50')}
            >
              <Plus className="size-[15px]" strokeWidth={1.75} aria-hidden />
              Add on a day
            </button>
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="px-4 pt-4 pb-12 md:px-12">
          {!online ? (
            <EmptyState
              image={ILL.schedule}
              title="The calendar needs the server"
              description="It reads your tasks and every database at once, so there is no offline copy. Try again when the server is reachable."
            />
          ) : (
            <UnifiedCalendar
              items={items}
              sources={sources}
              hiddenSources={hiddenSources}
              onMonthLabelChange={onMonthLabelChange}
              onMove={(item, date) => { void handleMove(item, date); }}
              onOpen={handleOpen}
              onAddOnDate={(dateKey, anchor) => setAddOn({ dateKey, anchor })}
              loading={loading}
            />
          )}
        </div>
        </div>
      </div>
      </ViewLayoutContext.Provider>

      {addOn && (
        <AddOnDayDialog
          dateKey={addOn.dateKey}
          anchor={addOn.anchor}
          onClose={() => setAddOn(null)}
          onDone={() => { setAddOn(null); void load(); }}
        />
      )}
    </div>
  );
}

/**
 * What to create on a day. A task and a record are both plausible here, so it
 * asks rather than guessing — and remembers nothing, because the answer is
 * different most times.
 */
function AddOnDayDialog({
  dateKey, anchor, onClose, onDone,
}: { dateKey: string; anchor: HTMLElement; onClose: () => void; onDone: () => void }) {
  const [databases, setDatabases] = useState<Array<{ id: string; name: string; dateFieldId: string }>>([]);
  const [target, setTarget] = useState<'task' | string>('task');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    databaseApi.list()
      .then((all) => setDatabases(all.filter((d) => d.dateFieldId)))
      .catch(() => setDatabases([]));
  }, []);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      if (target === 'task') {
        await taskApi.create({ title: trimmed, dueDate: dateKey, status: 'TODO', quadrant: 'DO' });
      } else {
        const database = databases.find((d) => d.id === target);
        if (!database) throw new Error('gone');
        const created = await databaseApi.createRow(database.id, { title: trimmed });
        await databaseApi.setFieldValue(created.id, database.dateFieldId, dateKey);
      }
      toast.success('Added', { duration: 2000 });
      onDone();
    } catch (e) {
      console.error('[calendar] add failed:', e);
      toast.error("Couldn't add it");
      setSaving(false);
    }
  };

  const label = new Date(
    Number(dateKey.slice(0, 4)), Number(dateKey.slice(5, 7)) - 1, Number(dateKey.slice(8)),
  ).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <Popover open onOpenChange={(open) => { if (!open) onClose(); }}>
      {/* It hangs from whatever opened it: the header action, or a day's + . */}
      <PopoverAnchor virtualRef={{ current: anchor }} />
      {/* Showcase 1115: 300px, 12px radius, 14px padding, 12px gap. */}
      <PopoverContent
        align="end"
        side="bottom"
        className="flex w-[300px] flex-col gap-3 rounded-[12px] p-[14px] text-[13px] shadow-[var(--a-shadow-xl)]"
        aria-label={`Add on ${label}`}
      >
        <span className="font-semibold text-a-muted">Add on {label}</span>

        <Input
          autoFocus
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          placeholder="What is it?"
          aria-label="Title"
          className="h-7"
        />

        <div className="flex flex-col gap-0.5" role="radiogroup" aria-label="Where it goes">
          <TargetRow label="A task" active={target === 'task'} onClick={() => setTarget('task')} />
          {databases.map((d) => (
            <TargetRow
              key={d.id}
              label={`A record in ${d.name}`}
              active={target === d.id}
              onClick={() => setTarget(d.id)}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => void submit()}
          disabled={!title.trim() || saving}
          className="h-7 w-full rounded-[3px] bg-a-accent text-[11px] font-semibold text-white transition-colors duration-[120ms] hover:bg-a-accent-600 disabled:opacity-50"
        >
          {saving ? 'Adding…' : 'Add'}
        </button>
      </PopoverContent>
    </Popover>
  );
}

function TargetRow({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`w-full rounded-[6px] px-2 py-1.5 text-left text-[13px] transition-colors duration-[120ms] ${
        active ? 'bg-a-blue-tint font-semibold text-a-accent' : 'text-a-muted hover:bg-a-line-soft'
      }`}
    >
      {label}
    </button>
  );
}
