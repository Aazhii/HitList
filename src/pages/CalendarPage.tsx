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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Link2, Plus, RefreshCw, Unplug } from 'lucide-react';
import { toast } from 'sonner';
import { ViewLayout, ContextSectionHeader } from '@/components/shell/ViewLayout';
import { TopBar } from '@/components/shell/TopBar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import {
  UnifiedCalendar, type CalendarItem, type CalendarSource,
} from '@/components/calendar/UnifiedCalendar';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import {
  calendarApi, databaseApi, taskApi, zohoCalendarApi,
  type CalendarRecord, type CalendarTask, type ZohoCalendarConnectionStatus, type ZohoCalendarEvent,
} from '@/lib/api';
import { getListColorDot, type KaizenList } from '@/types/todo';

export interface CalendarPageProps {
  lists: KaizenList[];
  /** Opens a task in the tasks view. */
  onOpenTask: (taskId: string) => void;
  /** Opens the database a record belongs to. */
  onOpenDatabase: (databaseId: string) => void;
}

export function CalendarPage({ lists, onOpenTask, onOpenDatabase }: CalendarPageProps) {
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [records, setRecords] = useState<CalendarRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(true);
  const [zohoConnection, setZohoConnection] = useState<ZohoCalendarConnectionStatus | null>(null);
  const [zohoEvents, setZohoEvents] = useState<ZohoCalendarEvent[]>([]);
  const [disconnecting, setDisconnecting] = useState(false);
  const [hiddenSources, setHiddenSources] = useLocalStorage<string[]>('hitlist-calendar-hidden-v1', []);

  const load = useCallback(async () => {
    try {
      const { tasks: t, records: r } = await calendarApi.load();
      setTasks(t);
      setRecords(r);
      setOnline(true);
      void zohoCalendarApi.connection()
        .then((connection) => {
          setZohoConnection(connection);
          if (!connection.connected) { setZohoEvents([]); return; }
          return zohoCalendarApi.events().then(({ events }) => setZohoEvents(events));
        })
        .catch((e: unknown) => {
          console.error('[calendar] zoho connection/events load failed:', e);
          setZohoConnection(null); setZohoEvents([]);
        });
    } catch (e) {
      console.error('[calendar] load failed:', e);
      setOnline(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('zohoCalendar');
    if (!result) return;
    window.history.replaceState({}, '', window.location.pathname);
    toast[result === 'connected' ? 'success' : 'error'](
      result === 'connected' ? 'Zoho Calendar connected' : "Couldn't connect Zoho Calendar",
    );
    void load();
  }, [load]);

  const disconnectZohoCalendar = useCallback(async () => {
    if (disconnecting || !window.confirm('Disconnect Zoho Calendar? Your imported events will disappear from HitList.')) return;
    setDisconnecting(true);
    try {
      await zohoCalendarApi.disconnect();
      setZohoConnection((current) => current ? { ...current, connected: false, connectedAt: null } : current);
      toast.success('Zoho Calendar disconnected');
    } catch (e) {
      console.error('[calendar] zoho disconnect failed:', e);
      toast.error("Couldn't disconnect Zoho Calendar");
    } finally {
      setDisconnecting(false);
    }
  }, [disconnecting]);

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
    ...zohoEvents.map((event) => ({
      kind: 'zoho' as const,
      id: event.id,
      title: event.title,
      date: event.date,
      time: event.time,
      sourceId: `zoho:${event.calendarId}`,
      sourceName: event.calendarName,
    })),
  ], [tasks, records, zohoEvents, listById]);

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
    const zohoCalendars = new Set<string>();
    for (const event of zohoEvents) {
      const id = `zoho:${event.calendarId}`;
      if (zohoCalendars.has(id)) continue;
      zohoCalendars.add(id);
      out.push({ kind: 'zoho', id, name: event.calendarName, dotClass: 'bg-sky-500' });
    }
    return out;
  }, [lists, tasks, records, zohoEvents]);

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
      if (item.kind !== 'record') throw new Error('Zoho Calendar events are read-only');
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
    else toast.message('Zoho Calendar events are read-only');
  }, [onOpenTask, onOpenDatabase]);

  const [addOn, setAddOn] = useState<string | null>(null);

  const count = items.length;
  const dated = items.filter((i) => i.date).length;

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <ViewLayout
        contextLabel="Calendar"
        context={
          <div className="mb-5">
            <ContextSectionHeader label="What's on it" />
            <p className="px-3 pb-2 text-[12.5px] leading-relaxed text-a-faint">
              Tasks with a due date, and records from every database that has chosen a date column.
              Drag anything to another day.
            </p>
            <div className="flex items-center gap-1.5 px-3 pb-3">
              {zohoConnection?.connected ? (
                <>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-a-muted">Zoho Calendar connected</span>
                  <button
                    type="button"
                    onClick={() => { void load(); }}
                    className="flex size-7 items-center justify-center rounded-full text-a-muted transition-colors hover:bg-a-row-hover hover:text-a-ink"
                    aria-label="Refresh Zoho Calendar connection"
                    title="Refresh connection"
                  >
                    <RefreshCw className="size-3.5" strokeWidth={2.3} />
                  </button>
                  <button
                    type="button"
                    onClick={() => { void disconnectZohoCalendar(); }}
                    disabled={disconnecting}
                    className="flex size-7 items-center justify-center rounded-full text-a-muted transition-colors hover:bg-a-row-hover hover:text-a-ink disabled:opacity-50"
                    aria-label="Disconnect Zoho Calendar"
                    title="Disconnect Zoho Calendar"
                  >
                    <Unplug className="size-3.5" strokeWidth={2.3} />
                  </button>
                </>
              ) : zohoConnection?.configured ? (
                <button
                  type="button"
                  onClick={() => zohoCalendarApi.connect()}
                  className="flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold text-a-ink shadow-[inset_0_0_0_1px_var(--a-line)] transition-colors hover:bg-a-row-hover"
                >
                  <Link2 className="size-3.5" strokeWidth={2.3} />
                  Connect Zoho Calendar
                </button>
              ) : null}
            </div>
            <ul className="space-y-0.5 px-3">
              {sources.map((source) => (
                <li key={source.id} className="flex items-center gap-2 py-1 text-[13.5px] text-a-muted">
                  <span className={`size-2 flex-shrink-0 rounded-full ${source.dotClass}`} aria-hidden />
                  <span className="min-w-0 truncate">{source.name}</span>
                  <span className="ml-auto text-[12px] tabular-nums text-a-faint">
                    {items.filter((i) => i.sourceId === source.id).length}
                  </span>
                </li>
              ))}
              {sources.length === 0 && !loading && (
                <li className="py-1 text-[12.5px] text-a-faint">Nothing has a date yet.</li>
              )}
            </ul>
          </div>
        }
        topBar={
          <TopBar
            title="Calendar"
            subtitle={loading ? 'Loading…' : `${dated} of ${count} on a date`}
          />
        }
      >
        <div className="px-4 py-[22px] md:px-[26px]">
          {!online ? (
            <div className="mx-auto flex max-w-[460px] flex-col items-center py-16 text-center animate-fade-in">
              <CalendarDays className="mb-3 size-6 text-a-faint" strokeWidth={2.25} aria-hidden />
              <p className="font-display text-[20px] text-a-ink">The calendar needs the server</p>
              <p className="mt-2 text-[14px] leading-relaxed text-a-muted">
                It reads your tasks and every database at once, so there is no offline copy.
                Try again when the server is reachable.
              </p>
            </div>
          ) : (
            <UnifiedCalendar
              items={items}
              sources={sources}
              hiddenSources={hiddenSources}
              onToggleSource={(id) => setHiddenSources((prev) => (
                prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
              ))}
              onMove={(item, date) => { void handleMove(item, date); }}
              onOpen={handleOpen}
              onAddOnDate={(dateKey) => setAddOn(dateKey)}
              loading={loading}
            />
          )}
        </div>
      </ViewLayout>

      {addOn && (
        <AddOnDayDialog
          dateKey={addOn}
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
  dateKey, onClose, onDone,
}: { dateKey: string; onClose: () => void; onDone: () => void }) {
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
      <PopoverTrigger asChild>
        <span className="sr-only" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="center" side="bottom" className="w-[300px] p-3" aria-label={`Add on ${label}`}>
        <p className="mb-2 text-[12px] font-semibold text-a-muted">Add on {label}</p>

        <Input
          autoFocus
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          placeholder="What is it?"
          aria-label="Title"
          className="h-8 rounded-full text-[14px]"
        />

        <div className="mt-2.5 space-y-0.5" role="radiogroup" aria-label="Where it goes">
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
          className="mt-3 h-8 w-full rounded-full bg-a-accent text-[13.5px] font-semibold text-a-bg transition-colors duration-150 hover:bg-a-accent-600 disabled:opacity-50"
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
      className={`flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-[13.5px] transition-colors duration-150 ${
        active ? 'bg-a-accent-tint font-semibold text-a-ink' : 'text-a-muted hover:bg-a-row-hover hover:text-a-ink'
      }`}
    >
      <Plus className="size-3.5 flex-shrink-0 opacity-0" aria-hidden />
      {label}
    </button>
  );
}
