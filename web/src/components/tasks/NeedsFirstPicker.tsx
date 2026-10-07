/**
 * "Needs first": the tasks that must be done before this one. A row of chips (status, title, remove) and a search box that
 * offers open tasks, never the task itself or one that would make two tasks wait on each other. It can also make a new task from
 * what was typed: straight away (`onCreate`, used when editing a task) or kept as a title until the task being made is saved
 * (`newTitles`, used by the Add task dialog).
 */
import { useMemo, useState } from 'react';
import { Check, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { existingNeeds, MAX_NEEDS_FIRST, wouldCycle } from '@/lib/taskNeeds';
import { cn } from '@/lib/utils';
import type { Todo } from '@/types/todo';

export interface NeedsFirstPickerProps {
  /** The task being edited; absent in the Add task dialog. */
  taskId?: string;
  todos: readonly Todo[];
  ids: string[];
  onIdsChange: (ids: string[]) => void;
  /** Make a task now and give back its id (null if it could not be made). */
  onCreate?: (title: string) => Promise<string | null>;
  /** Or keep new tasks as titles until the caller saves them. */
  newTitles?: string[];
  onNewTitlesChange?: (titles: string[]) => void;
  listName?: (listId: string) => string | undefined;
}

const CHIP = 'inline-flex max-w-full items-center gap-1.5 rounded-[4px] border border-a-line bg-a-surface py-[3px] pr-1 pl-2 text-[13px] text-a-ink';

export function NeedsFirstPicker({ taskId, todos, ids, onIdsChange, onCreate, newTitles, onNewTitlesChange, listName }: NeedsFirstPickerProps) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const byId = useMemo(() => new Map(todos.map((t) => [t.id, t])), [todos]);
  const chosen = useMemo(() => existingNeeds({ id: taskId ?? '', needsFirst: ids }, byId), [taskId, ids, byId]);
  const pending = newTitles ?? [];
  const full = chosen.length + pending.length >= MAX_NEEDS_FIRST;

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q || full) return [];
    return todos
      .filter((t) => t.status !== 'done' && t.id !== taskId && !ids.includes(t.id) && t.text.toLowerCase().includes(q)
        && (!taskId || !wouldCycle(taskId, t.id, byId)))
      .sort((a, b) => Number(b.text.toLowerCase().startsWith(q)) - Number(a.text.toLowerCase().startsWith(q)))
      .slice(0, 6);
  }, [q, full, todos, taskId, ids, byId]);
  const canCreate = !!q && !full && (!!onCreate || !!onNewTitlesChange)
    && !todos.some((t) => t.status !== 'done' && t.text.trim().toLowerCase() === q) && !pending.some((p) => p.toLowerCase() === q);

  const add = (id: string) => { onIdsChange([...ids, id]); setQuery(''); };
  const create = async () => {
    const title = query.trim();
    if (!title) return;
    if (onNewTitlesChange) { onNewTitlesChange([...pending, title]); setQuery(''); return; }
    if (!onCreate || busy) return;
    setBusy(true);
    try { const id = await onCreate(title); if (id) { onIdsChange([...ids, id]); setQuery(''); } } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-2">
      {(chosen.length > 0 || pending.length > 0) && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Needs first">
          {chosen.map((t) => (
            <li key={t.id} className={CHIP}>
              {t.status === 'done'
                ? <Check className="size-3.5 flex-shrink-0 text-a-accent" strokeWidth={1.75} aria-label="Done" />
                : <span className="size-[7px] flex-shrink-0 rounded-full bg-a-attention" aria-label="Not done" />}
              <span className={cn('min-w-0 [overflow-wrap:anywhere]', t.status === 'done' && 'text-a-faint line-through')}>{t.text}</span>
              <button type="button" aria-label={`Remove ${t.text} from needs first`} onClick={() => onIdsChange(ids.filter((id) => id !== t.id))}
                className="flex size-5 flex-shrink-0 items-center justify-center rounded-[3px] text-a-faint hover:bg-a-line-soft hover:text-a-ink">
                <X className="size-3.5" strokeWidth={1.75} aria-hidden />
              </button>
            </li>
          ))}
          {pending.map((title) => (
            <li key={`new:${title}`} className={CHIP}>
              <span className="size-[7px] flex-shrink-0 rounded-full bg-a-attention" aria-hidden />
              <span className="min-w-0 [overflow-wrap:anywhere]">{title}</span>
              <span className="text-[11px] text-a-faint">new</span>
              <button type="button" aria-label={`Remove ${title} from needs first`} onClick={() => onNewTitlesChange?.(pending.filter((p) => p !== title))}
                className="flex size-5 flex-shrink-0 items-center justify-center rounded-[3px] text-a-faint hover:bg-a-line-soft hover:text-a-ink">
                <X className="size-3.5" strokeWidth={1.75} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (matches[0]) add(matches[0].id);
          else if (canCreate) void create();
        }}
        placeholder={full ? `A task can need up to ${MAX_NEEDS_FIRST} others first` : 'Search for a task to do first…'}
        aria-label="Add a task that needs to be done first"
        disabled={full}
        maxLength={200}
      />
      {(matches.length > 0 || canCreate) && (
        <ul role="listbox" aria-label="Tasks to do first" className="flex flex-col rounded-[6px] border border-a-line bg-a-surface p-1">
          {matches.map((t) => (
            <li key={t.id} role="option" aria-selected={false}>
              <button type="button" onClick={() => add(t.id)} className="flex w-full items-baseline gap-2 rounded-[4px] px-2 py-1.5 text-left text-[13px] text-a-ink hover:bg-a-line-soft">
                <span className="[overflow-wrap:anywhere]">{t.text}</span>
                {listName?.(t.listId) && <span className="flex-shrink-0 text-[12px] text-a-faint">{listName(t.listId)}</span>}
              </button>
            </li>
          ))}
          {canCreate && (
            <li role="option" aria-selected={false}>
              <button type="button" disabled={busy} onClick={() => { void create(); }} className="w-full rounded-[4px] px-2 py-1.5 text-left text-[13px] text-a-accent hover:bg-a-line-soft">
                Create “{query.trim()}” as a new task
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
