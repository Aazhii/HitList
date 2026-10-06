/**
 * Weekly update: the week's progress lines, finished tasks and what else was touched, grouped into the
 * team's sections, and one button that copies a prompt for an LLM to turn into the update. Nothing
 * leaves the app except what the person copies, and the exact text is shown first.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ClipboardCopy, NotebookPen, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TopBar, topBarPrimary, topBarSubtle } from '@/components/shell/TopBar';
import { ViewLayoutContext } from '@/components/shell/ViewLayout';
import { STATE_LABEL } from '@/components/worklog/LogProgressDialog';
import { useProgressLog } from '@/hooks/useProgressLog';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { databaseApi, type ApiDatabaseRow } from '@/lib/api';
import type { PageInfo } from '@/lib/pages';
import {
  DEFAULT_SETTINGS, buildMaterialText, buildWeeklyPrompt, collectWeek, defaultWeekOffset, normalizeSettings, weekRange,
  type MaterialItem, type SectionRule, type WeeklySettings,
} from '@/lib/weeklyUpdate';
import type { Todo } from '@/types/todo';

const SETTINGS_KEY = 'hitlist-weekly-settings-v1';
const SKIP_KEY = 'hitlist-weekly-skipped-v1';

const field = 'h-[30px] rounded-[4px] border border-a-line-strong bg-a-surface px-2 text-[13px] text-a-ink';
const small = 'h-[30px] rounded-[4px] border border-a-line-strong bg-a-surface px-3 text-[13px] font-semibold text-a-ink hover:bg-a-bg disabled:cursor-not-allowed disabled:opacity-50';

export interface WeeklyUpdatePageProps {
  todos: readonly Todo[];
  lists: ReadonlyArray<{ id: string; name: string }>;
  /** Every page, with when it was last edited: notes and databases. */
  directory: readonly PageInfo[];
  /** The Log progress dialog is open; when it closes the week is read again. */
  logOpen: boolean;
  onLogProgress: () => void;
  onOpenSidebar?: () => void;
  /** Fixed for tests. */
  now?: number;
}

export function WeeklyUpdatePage({ todos, lists, directory, logOpen, onLogProgress, onOpenSidebar, now: fixedNow }: WeeklyUpdatePageProps) {
  const [now] = useState(() => fixedNow ?? Date.now());
  const [offset, setOffset] = useState(() => defaultWeekOffset(now));
  const range = useMemo(() => weekRange(now, offset), [now, offset]);
  const [rawSettings, setRawSettings] = useLocalStorage<WeeklySettings>(SETTINGS_KEY, DEFAULT_SETTINGS);
  const settings = useMemo(() => normalizeSettings(rawSettings), [rawSettings]);
  const [skippedByWeek, setSkippedByWeek] = useLocalStorage<Record<string, string[]>>(SKIP_KEY, {});
  const skipped = useMemo(() => new Set(skippedByWeek[String(range.startMs)] ?? []), [skippedByWeek, range.startMs]);

  const log = useProgressLog(range.startMs, range.endMs);
  const { reload } = log;
  useEffect(() => { if (!logOpen) void reload(); }, [logOpen, reload]);

  // Records added or edited in the week, read once from each database.
  const [records, setRecords] = useState<Array<{ id: string; databaseName: string; title: string; createdAt: number; updatedAt: number }>>([]);
  useEffect(() => {
    let live = true;
    const databases = directory.filter((p) => p.kind === 'database');
    void Promise.all(databases.map((d) => databaseApi.listRows(d.id).then((rows: ApiDatabaseRow[]) => rows.map((r) => ({ id: r.id, databaseName: d.name, title: r.title, createdAt: r.createdAt, updatedAt: r.updatedAt }))).catch(() => [])))
      .then((all) => { if (live) setRecords(all.flat()); });
    return () => { live = false; };
  }, [directory]);

  const material = useMemo(() => collectWeek({
    now, offsetWeeks: offset, settings, entries: log.entries, todos, lists, records,
    notes: directory.filter((p) => p.kind === 'note' && p.editedAt !== undefined).map((p) => ({ id: p.id, title: p.name, updatedAt: p.editedAt as number })),
  }), [now, offset, settings, log.entries, todos, lists, records, directory]);
  const prompt = useMemo(() => buildWeeklyPrompt(material, settings, skipped), [material, settings, skipped]);

  const toggle = (key: string) => setSkippedByWeek((cur) => {
    const week = String(range.startMs);
    const has = (cur[week] ?? []).includes(key);
    return { ...cur, [week]: has ? (cur[week] ?? []).filter((k) => k !== key) : [...(cur[week] ?? []), key] };
  });

  const [copied, setCopied] = useState<'prompt' | 'material' | 'failed' | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const copy = async (what: 'prompt' | 'material') => {
    const text = what === 'prompt' ? prompt.text : buildMaterialText(material, settings, skipped);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      // No clipboard here: show the text selected so it can be copied by hand.
      setCopied('failed');
      setShowPreview(true);
    }
  };

  const story = material.items.filter((i) => i.kind === 'progress' || i.kind === 'task-done');
  const background = material.items.filter((i) => i.kind !== 'progress' && i.kind !== 'task-done');
  const hasStory = story.some((i) => !skipped.has(i.key));

  return (
    <ViewLayoutContext.Provider value={{ openContext: () => onOpenSidebar?.(), closeContext: () => {}, toggleCollapsed: () => {}, collapsible: false, collapsed: false }}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar
          title="Weekly update"
          subtitle={range.label}
          actions={(
            <button type="button" className={topBarPrimary} onClick={onLogProgress}>
              <NotebookPen className="size-[15px]" strokeWidth={1.75} aria-hidden />
              Log progress
            </button>
          )}
        />
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto flex max-w-[760px] flex-col gap-5 px-4 pt-4 pb-12 md:px-12">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Week">
              {([[-1, 'Last week'], [0, 'This week']] as const).map(([o, label]) => (
                <button key={o} type="button" aria-pressed={offset === o} onClick={() => setOffset(o)}
                  className={cn('h-[30px] rounded-[4px] px-3 text-[13px] font-semibold', offset === o ? 'bg-a-blue-tint text-a-accent' : 'text-a-muted hover:bg-a-line-soft')}>
                  {label}
                </button>
              ))}
              <span className="text-[12px] text-a-faint">{range.label}</span>
              <div className="flex-1" />
              <button type="button" className={cn(topBarSubtle, 'inline-flex items-center gap-1.5')} onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}>
                {showSettings ? <ChevronDown className="size-[14px]" aria-hidden /> : <ChevronRight className="size-[14px]" aria-hidden />}
                Sections and examples
              </button>
            </div>

            {showSettings && <SettingsPanel settings={settings} lists={lists} onChange={setRawSettings} />}

            {log.waiting > 0 && (
              <p className="text-[13px] text-a-attention" role="status">{log.waiting} progress {log.waiting === 1 ? 'line is' : 'lines are'} saved on this computer and not in storage yet.</p>
            )}

            {!hasStory && (
              <p className="rounded-[8px] border border-a-line-soft px-4 py-3 text-[13px] text-a-muted" data-testid="empty-week">
                Nothing logged or finished in this week yet. Press <kbd className="font-mono">l</kbd> through the week to log what moved, finished or not.
                HitList only knows what you log and what you complete: notes and edits are background, not progress.
              </p>
            )}

            {settings.sections.map((section) => {
              const here = story.filter((i) => i.sectionId === section.id);
              if (!here.length) return null;
              return (
                <section key={section.id} aria-label={section.label} className="flex flex-col gap-1">
                  <h2 className="text-[12px] font-semibold uppercase tracking-wide text-a-faint">{section.label}</h2>
                  <ul className="flex flex-col">
                    {here.map((item) => (
                      <ItemRow key={item.key} item={item} off={skipped.has(item.key)} settings={settings}
                        onToggle={() => toggle(item.key)}
                        onSection={item.kind === 'progress' ? (id) => { void log.updateEntry(item.key.slice('progress:'.length), { section: id }); } : undefined}
                        onDelete={item.kind === 'progress' ? () => { void log.deleteEntry(item.key.slice('progress:'.length)); } : undefined}
                        onEdit={item.kind === 'progress' ? (text) => { void log.updateEntry(item.key.slice('progress:'.length), { text }); } : undefined} />
                    ))}
                  </ul>
                </section>
              );
            })}

            {background.length > 0 && (
              <section aria-label="Background" className="flex flex-col gap-1">
                <h2 className="text-[12px] font-semibold uppercase tracking-wide text-a-faint">Background · context for the model, not lines of their own</h2>
                <ul className="flex flex-col">
                  {background.map((item) => <ItemRow key={item.key} item={item} off={skipped.has(item.key)} settings={settings} onToggle={() => toggle(item.key)} />)}
                </ul>
              </section>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-a-line-soft pt-4">
              <button type="button" className={cn(topBarPrimary, 'inline-flex items-center gap-1.5')} onClick={() => { void copy('prompt'); }} disabled={!hasStory}>
                <ClipboardCopy className="size-[15px]" strokeWidth={1.75} aria-hidden />
                Copy the prompt
              </button>
              <button type="button" className={small} onClick={() => { void copy('material'); }} disabled={!hasStory}>Copy only the material</button>
              <button type="button" className={small} onClick={() => setShowPreview((v) => !v)} aria-expanded={showPreview}>{showPreview ? 'Hide' : 'Show'} what is copied</button>
              <span className="text-[12px] text-a-muted" role="status">
                {copied === 'prompt' ? 'Copied. Paste it into your LLM.' : copied === 'material' ? 'Copied the material.' : copied === 'failed' ? 'Could not copy automatically. The text is below, selected for you.' : ''}
              </span>
            </div>
            {prompt.trimmed > 0 && <p className="text-[12px] text-a-attention">{prompt.trimmed} background {prompt.trimmed === 1 ? 'line was' : 'lines were'} left out to keep the prompt short enough.</p>}
            {showPreview && (
              <textarea readOnly aria-label="The prompt" value={prompt.text} rows={18} onFocus={(e) => e.currentTarget.select()}
                className="w-full rounded-[6px] border border-a-line-strong bg-a-surface p-3 font-mono text-[12px] text-a-ink" />
            )}
          </div>
        </div>
      </div>
    </ViewLayoutContext.Provider>
  );
}

function ItemRow({ item, off, settings, onToggle, onSection, onDelete, onEdit }: {
  item: MaterialItem; off: boolean; settings: WeeklySettings; onToggle: () => void;
  onSection?: (id: string) => void; onDelete?: () => void; onEdit?: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const label = item.kind === 'progress' ? (item.state ? STATE_LABEL[item.state] : 'Logged') : item.kind === 'task-done' ? 'Finished' : item.kind === 'task-touched' ? 'Task touched' : item.kind === 'note' ? 'Note edited' : 'Record';
  return (
    <li className={cn('flex items-start gap-2.5 border-b border-a-line-soft py-1.5 text-[13px]', off && 'opacity-50')}>
      <input type="checkbox" className="mt-[3px]" checked={!off} onChange={onToggle} aria-label={`Include: ${item.text}`} />
      <span className="mt-px w-[84px] flex-shrink-0 text-[11px] font-semibold uppercase text-a-faint">{label}</span>
      <div className="min-w-0 flex-1">
        {editing ? (
          <input autoFocus className={cn(field, 'w-full')} value={draft} maxLength={500} aria-label="Edit line"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) { onEdit?.(draft.trim()); setEditing(false); }
              if (e.key === 'Escape') { setDraft(item.text); setEditing(false); }
            }} />
        ) : (
          <button type="button" disabled={!onEdit} onClick={() => { setDraft(item.text); setEditing(true); }}
            className={cn('text-left text-a-ink [overflow-wrap:anywhere]', onEdit && 'hover:underline')}>
            {item.text}
          </button>
        )}
        {item.taskTitle && <p className="text-[12px] text-a-faint">task: {item.taskTitle}</p>}
      </div>
      {onSection && (
        <select aria-label="Section" className={cn(field, 'h-[26px] w-[110px] flex-shrink-0 text-[12px]')} value={item.sectionId} onChange={(e) => onSection(e.target.value)}>
          {settings.sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      )}
      {onDelete && (
        <button type="button" onClick={onDelete} aria-label={`Delete: ${item.text}`} className="mt-px flex-shrink-0 text-a-faint hover:text-a-attention">
          <Trash2 className="size-[14px]" strokeWidth={1.75} aria-hidden />
        </button>
      )}
    </li>
  );
}

function SettingsPanel({ settings, lists, onChange }: {
  settings: WeeklySettings; lists: ReadonlyArray<{ id: string; name: string }>; onChange: (next: WeeklySettings) => void;
}) {
  const set = (patch: Partial<WeeklySettings>) => onChange({ ...settings, ...patch });
  const setRule = (i: number, patch: Partial<SectionRule>) => set({ rules: settings.rules.map((r, n) => (n === i ? { ...r, ...patch } : r)) });
  return (
    <div className="flex flex-col gap-4 rounded-[8px] border border-a-line-soft p-4" aria-label="Weekly update settings">
      <label className="flex items-center gap-2 text-[13px] text-a-ink">Team name
        <input className={cn(field, 'w-[180px]')} value={settings.teamName} onChange={(e) => set({ teamName: e.target.value })} />
      </label>
      <div className="flex flex-col gap-1.5">
        <p className="text-[12px] font-semibold uppercase text-a-faint">Sections, in order</p>
        {settings.sections.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2">
            <input className={cn(field, 'w-[160px]')} aria-label={`Section ${i + 1} name`} value={s.label}
              onChange={(e) => set({ sections: settings.sections.map((x) => (x.id === s.id ? { ...x, label: e.target.value } : x)) })} />
            <input className={cn(field, 'w-[110px]')} aria-label={`Section ${i + 1} line prefix`} placeholder="line prefix" value={s.prefix ?? ''}
              onChange={(e) => set({ sections: settings.sections.map((x) => (x.id === s.id ? { ...x, prefix: e.target.value } : x)) })} />
            <label className="flex items-center gap-1 text-[12px] text-a-muted">
              <input type="radio" name="default-section" checked={settings.defaultSectionId === s.id} onChange={() => set({ defaultSectionId: s.id })} />
              everything else
            </label>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-[12px] font-semibold uppercase text-a-faint">Put these in a section</p>
        {settings.rules.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select className={cn(field, 'w-[110px]')} aria-label="Rule source" value={r.from} onChange={(e) => setRule(i, { from: e.target.value as SectionRule['from'] })}>
              <option value="list">List</option><option value="category">Category</option><option value="field">Field value</option>
            </select>
            <input className={cn(field, 'w-[170px]')} aria-label="Rule value" list={`weekly-lists-${i}`} value={r.value} onChange={(e) => setRule(i, { value: e.target.value })} />
            <datalist id={`weekly-lists-${i}`}>{lists.map((l) => <option key={l.id} value={l.name} />)}</datalist>
            <span className="text-[12px] text-a-muted">goes to</span>
            <select className={cn(field, 'w-[130px]')} aria-label="Rule section" value={r.sectionId} onChange={(e) => setRule(i, { sectionId: e.target.value })}>
              {settings.sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <button type="button" className="text-a-faint hover:text-a-attention" aria-label="Remove rule" onClick={() => set({ rules: settings.rules.filter((_, n) => n !== i) })}>
              <Trash2 className="size-[14px]" strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        ))}
        <button type="button" className={cn(small, 'self-start')} onClick={() => set({ rules: [...settings.rules, { from: 'list', value: lists[0]?.name ?? '', sectionId: settings.defaultSectionId }] })}>Add a rule</button>
      </div>
      <label className="flex flex-col gap-1.5 text-[13px] text-a-ink">
        <span><span className="font-semibold">Past updates</span> <span className="text-a-muted">Paste a few you posted. The model copies their shape.</span></span>
        <textarea className="w-full rounded-[4px] border border-a-line-strong bg-a-surface p-2 font-mono text-[12px]" rows={9} value={settings.examples} onChange={(e) => set({ examples: e.target.value })} />
      </label>
    </div>
  );
}
