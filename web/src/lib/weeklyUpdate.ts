/**
 * The Monday update: gather what happened in a week and turn it into one prompt for an LLM.
 *
 * HitList does not write the update. It collects the week honestly (the progress lines the person
 * logged, tasks finished, and what else was touched) and builds a prompt that tells a model exactly
 * the format wanted, with the rule that matters most: work that moved but did not finish is reported
 * as that, never as done. Pure functions, no I/O.
 */
import type { ApiProgressEntry, ProgressState } from '@/lib/api';
import { stripInline } from '@/lib/inlineMarkdown';
import type { NoteBlock } from '@/types/notes';
import type { Todo } from '@/types/todo';

/** Longest stretch of one note (or one task's note) that goes into the prompt, in characters. */
export const NOTE_CHARS = 2500;
export const TASK_NOTE_CHARS = 600;

/**
 * The words of a note as plain lines, for the prompt: bullets and to-dos keep their markers and their nesting, tables
 * become one line per row, and dividers and embedded databases (their rows are listed separately) are left out.
 */
export function noteText(blocks: readonly Pick<NoteBlock, 'type' | 'content' | 'checked' | 'indent' | 'tableData'>[], limit = NOTE_CHARS): string {
  const lines: string[] = [];
  for (const b of blocks) {
    if (b.type === 'divider' || b.type === 'database' || b.type === 'codefile') continue;
    const pad = '  '.repeat(Math.min(6, Math.max(0, b.indent ?? 0)));
    if (b.type === 'table') {
      for (const row of b.tableData?.rows ?? []) { const cells = row.map((c) => stripInline(c).trim()).filter(Boolean); if (cells.length) lines.push(`${pad}${cells.join(' | ')}`); }
      continue;
    }
    const text = (b.type === 'code' ? b.content : stripInline(b.content)).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const mark = b.type === 'todo' ? (b.checked ? '[x] ' : '[ ] ') : b.type === 'bullet' || b.type === 'numbered' ? '- ' : b.type === 'toggle' ? '> ' : '';
    lines.push(`${pad}${mark}${text}`);
  }
  const all = lines.join('\n');
  return all.length > limit ? `${all.slice(0, limit - 1)}…` : all;
}

export interface WeekRange {
  startMs: number;
  endMs: number;
  /** "Sep 21-27", or across a month "Sep 28-Oct04", the way the team writes it. */
  label: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** Monday 00:00 to Sunday 23:59:59.999 (local time) of the week `offsetWeeks` from the one holding `now`. */
export function weekRange(now: number, offsetWeeks = 0): WeekRange {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + offsetWeeks * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  const label = start.getMonth() === end.getMonth()
    ? `${MONTHS[start.getMonth()]} ${start.getDate()}-${end.getDate()}`
    : `${MONTHS[start.getMonth()]} ${start.getDate()}-${MONTHS[end.getMonth()]}${pad(end.getDate())}`;
  return { startMs: start.getTime(), endMs: end.getTime(), label };
}

/** On Monday and Tuesday the update is for the week that just ended; later it is for the week in progress. */
export function defaultWeekOffset(now: number): number {
  const day = new Date(now).getDay();
  return day === 1 || day === 2 ? -1 : 0;
}

export interface SectionDef {
  id: string;
  label: string;
  /** Written at the start of every line in the section, e.g. "RE - ". */
  prefix?: string;
}

/** Where an item goes when it is not set by hand: what a task's list, category or field says. */
export interface SectionRule {
  from: 'list' | 'category' | 'field';
  /** The list name, category id, or field option label, compared without case. */
  value: string;
  sectionId: string;
}

export interface WeeklySettings {
  teamName: string;
  sections: SectionDef[];
  rules: SectionRule[];
  /** Where everything unmapped lands. */
  defaultSectionId: string;
  /** Past updates, pasted as they were posted, so the model copies their shape. */
  examples: string;
}

export const DEFAULT_EXAMPLE = `*Team - Sep 21-27 Weekly Updates*

*--- Bugs*
1. PROJ-1054 - Timeout from the scheduler under load
2. PROJ-1057 - NullPointerException in the report export

*--- Work Items*
1. Debug and provide a solution to @asha for the client feature
2. Discussed the import flow with @ravi, looping him in, issue not fixed yet
3. Webhook action module flow - completed

*--- Support*
1. Build error fixed - [changeset](https://example.com/changeset/123)`;

/** The example older builds shipped, with a line prefix on every work item. Saved settings still holding it are updated. */
const LEGACY_EXAMPLE = `*Team - Sep 21-27 Weekly Updates*

*--- Bugs*
1. PROJ-1054 - Timeout from the scheduler under load
2. PROJ-1057 - NullPointerException in the report export

*--- Work Items*
1. RE - Debug and provide a solution to @asha for the client feature
2. RE - Discussed the import flow with @ravi, looping him in, issue not fixed yet
3. RE - Webhook action module flow - completed

*--- Support*
1. Build error fixed - [changeset](https://example.com/changeset/123)`;

export const DEFAULT_SETTINGS: WeeklySettings = {
  teamName: 'Team',
  sections: [
    { id: 'tickets', label: 'Tickets' },
    { id: 'bugs', label: 'Bugs' },
    { id: 'work', label: 'Work Items' },
    { id: 'support', label: 'Support' },
  ],
  rules: [],
  defaultSectionId: 'work',
  examples: DEFAULT_EXAMPLE,
};

/** A saved settings blob read back safely: anything missing or malformed falls back to the defaults. */
export function normalizeSettings(raw: unknown): WeeklySettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<WeeklySettings>;
  const sections = Array.isArray(o.sections)
    ? o.sections.filter((s): s is SectionDef => !!s && typeof s.id === 'string' && typeof s.label === 'string' && s.label.trim() !== '')
        .map((s) => ({ id: s.id, label: s.label.trim(), prefix: typeof s.prefix === 'string' ? s.prefix : undefined }))
    : [];
  // Settings saved by an older build that were never edited still carry its "RE - " prefix and example: use the new defaults.
  const untouchedLegacy = o.examples === LEGACY_EXAMPLE;
  const use = (sections.length ? sections : DEFAULT_SETTINGS.sections)
    .map((x) => (untouchedLegacy && x.id === 'work' && x.prefix === 'RE - ' ? { id: x.id, label: x.label } : x));
  const rules = Array.isArray(o.rules)
    ? o.rules.filter((r): r is SectionRule => !!r && ['list', 'category', 'field'].includes(r.from) && typeof r.value === 'string' && use.some((s) => s.id === r.sectionId))
    : [];
  return {
    teamName: typeof o.teamName === 'string' && o.teamName.trim() ? o.teamName.trim() : DEFAULT_SETTINGS.teamName,
    sections: use,
    rules,
    defaultSectionId: use.some((s) => s.id === o.defaultSectionId) ? (o.defaultSectionId as string)
      : use.some((s) => s.id === DEFAULT_SETTINGS.defaultSectionId) ? DEFAULT_SETTINGS.defaultSectionId : use[use.length - 1].id,
    examples: typeof o.examples === 'string' && !untouchedLegacy ? o.examples : DEFAULT_SETTINGS.examples,
  };
}

/** Entry's own section, then the list rule, the category rule, the field rule, and last the default. */
export function sectionFor(
  settings: WeeklySettings,
  hint: { sectionId?: string; listName?: string; category?: string; fieldLabels?: readonly string[] },
): string {
  const has = (id: string | undefined) => !!id && settings.sections.some((s) => s.id === id);
  if (has(hint.sectionId)) return hint.sectionId as string;
  const same = (a: string | undefined, b: string) => !!a && a.trim().toLowerCase() === b.trim().toLowerCase();
  const byList = settings.rules.find((r) => r.from === 'list' && same(hint.listName, r.value));
  if (byList) return byList.sectionId;
  const byCategory = settings.rules.find((r) => r.from === 'category' && same(hint.category, r.value));
  if (byCategory) return byCategory.sectionId;
  const byField = settings.rules.find((r) => r.from === 'field' && (hint.fieldLabels ?? []).some((l) => same(l, r.value)));
  if (byField) return byField.sectionId;
  return has(settings.defaultSectionId) ? settings.defaultSectionId : settings.sections[settings.sections.length - 1].id;
}

export type MaterialState = ProgressState;
export type MaterialKind = 'progress' | 'task-done' | 'task-touched' | 'note' | 'record';

export interface MaterialItem {
  /** Stable, so a ticked-off item stays ticked-off while the week is on screen. */
  key: string;
  kind: MaterialKind;
  sectionId: string;
  text: string;
  state?: MaterialState;
  at: number;
  /** For a progress line about a task. */
  taskTitle?: string;
  listName?: string;
  /** The words behind the title: a task's own note, or a note's text. */
  detail?: string;
}

export interface WeekMaterial {
  range: WeekRange;
  items: MaterialItem[];
}

export interface WeekInput {
  now: number;
  offsetWeeks?: number;
  settings: WeeklySettings;
  entries: readonly ApiProgressEntry[];
  todos: readonly Todo[];
  lists: ReadonlyArray<{ id: string; name: string }>;
  notes: ReadonlyArray<{ id: string; title: string; updatedAt: number; text?: string }>;
  records?: ReadonlyArray<{ id: string; databaseName: string; title: string; createdAt: number; updatedAt: number }>;
  /** Option labels of select fields a task has, for the "field" rule. */
  fieldLabelsOf?: (taskId: string) => readonly string[];
}

const taskNote = (t: Todo): string | undefined => {
  const text = (t.note ?? '').replace(/\s+/g, ' ').trim();
  return text ? (text.length > TASK_NOTE_CHARS ? `${text.slice(0, TASK_NOTE_CHARS - 1)}…` : text) : undefined;
};

/** What tells the story: lines you logged, tasks you finished, and tasks you touched that carry a note. The rest is background. */
export const isStory = (i: MaterialItem): boolean => i.kind === 'progress' || i.kind === 'task-done' || (i.kind === 'task-touched' && !!i.detail);

const inside = (at: number | undefined, r: WeekRange) => at !== undefined && at >= r.startMs && at <= r.endMs;

/** What happened in the week, as one flat list. Progress lines carry the story; the rest is background. */
export function collectWeek(input: WeekInput): WeekMaterial {
  const range = weekRange(input.now, input.offsetWeeks ?? 0);
  const { settings } = input;
  const listName = new Map(input.lists.map((l) => [l.id, l.name]));
  const todoById = new Map(input.todos.map((t) => [t.id, t]));
  const items: MaterialItem[] = [];

  const hintOf = (t: Todo | undefined, sectionId?: string) => ({
    sectionId,
    listName: t ? listName.get(t.listId) : undefined,
    category: t?.category,
    fieldLabels: t && input.fieldLabelsOf ? input.fieldLabelsOf(t.id) : undefined,
  });

  for (const e of input.entries) {
    if (!inside(e.at, range)) continue;
    const task = e.taskId ? todoById.get(e.taskId) : undefined;
    items.push({
      key: `progress:${e.id}`, kind: 'progress', sectionId: sectionFor(settings, hintOf(task, e.section || undefined)),
      text: e.text, state: e.state, at: e.at, taskTitle: task?.text, listName: task ? listName.get(task.listId) : undefined,
    });
  }

  const doneIds = new Set<string>();
  for (const t of input.todos) {
    if (t.status === 'done' && inside(t.completedAt, range)) {
      doneIds.add(t.id);
      items.push({
        key: `done:${t.id}`, kind: 'task-done', sectionId: sectionFor(settings, hintOf(t)), text: t.text, state: 'done',
        at: t.completedAt as number, listName: listName.get(t.listId), detail: taskNote(t),
      });
    }
  }
  for (const t of input.todos) {
    if (doneIds.has(t.id)) continue;
    // Created or saved in the week: the task was worked on, though the app cannot say how.
    const at = inside(t.updatedAt, range) ? t.updatedAt : inside(t.createdAt, range) ? t.createdAt : undefined;
    if (at === undefined) continue;
    items.push({ key: `touched:${t.id}`, kind: 'task-touched', sectionId: sectionFor(settings, hintOf(t)), text: t.text, at, listName: listName.get(t.listId), detail: taskNote(t) });
  }
  for (const n of input.notes) {
    if (!inside(n.updatedAt, range)) continue;
    items.push({ key: `note:${n.id}`, kind: 'note', sectionId: settings.defaultSectionId, text: n.title.trim() || 'Untitled note', at: n.updatedAt, detail: n.text || undefined });
  }
  for (const r of input.records ?? []) {
    const at = inside(r.updatedAt, range) ? r.updatedAt : inside(r.createdAt, range) ? r.createdAt : undefined;
    if (at === undefined) continue;
    items.push({ key: `record:${r.id}`, kind: 'record', sectionId: sectionFor(settings, { listName: r.databaseName }), text: `${r.title} (${r.databaseName})`, at });
  }
  items.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
  return { range, items };
}

export const PROMPT_LIMIT = 20_000;

const STATE_TAG: Record<MaterialState, string> = {
  moved: 'PARTIAL - moved, not finished',
  discussed: 'PARTIAL - discussed, not finished',
  blocked: 'BLOCKED',
  done: 'DONE',
};

const dayLabel = (ms: number) => {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${pad(d.getDate())}`;
};

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

export interface WeeklyPrompt {
  text: string;
  /** Background lines left out to stay under the limit. */
  trimmed: number;
  /** Whether notes were cut shorter than usual to stay under the limit. */
  notesShortened: boolean;
}

/** The title line the update starts with. */
export function titleLine(range: WeekRange, settings: WeeklySettings): string {
  return `*${settings.teamName} - ${range.label} Weekly Updates*`;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text);

/** One block of text to paste into an LLM. `skip` holds keys of items the person unticked. */
export function buildWeeklyPrompt(material: WeekMaterial, settings: WeeklySettings, skip: ReadonlySet<string> = new Set()): WeeklyPrompt {
  const kept = material.items.filter((i) => !skip.has(i.key));
  const sectionOrder = settings.sections.map((s) => s.id);
  const story = kept.filter(isStory);
  const noteItems = kept.filter((i) => i.kind === 'note' && !!i.detail);
  const background = kept.filter((i) => !isStory(i) && !(i.kind === 'note' && i.detail));

  const head = [
    'You are writing my weekly progress update for my team. Rewrite the raw material below into the exact format shown.',
    'Output only the update, with no introduction and no closing remarks.',
    '',
    'RULES',
    `- Start with this title line exactly: ${titleLine(material.range, settings)}`,
    `- Then the sections, in this order, leaving out any section that has no items: ${settings.sections.map((s) => s.label).join(', ')}.`,
    '- Write each section heading as "*--- <Section>*", then number its lines from 1.',
    ...settings.sections.filter((s) => s.prefix).map((s) => `- Every line under ${s.label} starts with "${s.prefix}".`),
    '- Keep ticket and bug ids exactly as written (for example PROJ-1058 or #1234567). Never shorten or renumber them.',
    '- Keep @mentions exactly as written. They are colleagues, not placeholders.',
    '- Keep markdown links exactly as written: [text](url).',
    '- One line per item, past tense, plain words. Add no detail that is not in the material.',
    '- PARTIAL means the work moved but is not finished. Say what was done and what is still open, for example "discussed with @asha, looping them in, issue not fixed yet". Never report a PARTIAL item as fixed, closed or completed.',
    '- OPEN means I worked on the task this week and it is not marked done. Its "note" is what I wrote about it: report what the note says happened (who I talked to, what I found, what is pending) and that it is still open. Never report an OPEN item as completed.',
    '- BLOCKED means waiting on something. Say what it is waiting on.',
    '- DONE may be reported as completed. A "note" on it is extra detail.',
    '- Merge lines that are clearly about the same id or task into one line, keeping the latest state.',
    '- NOTES are my own raw notes. They have no per-line dates, so use a line only when it clearly says work was done, something was discussed or a decision was made. Do not turn a plan, a question or a to-do into something done.',
    '- The background list is for context only. Use it only to make a line above it clearer. Do not make lines from it.',
    '',
  ];
  const examples = settings.examples.trim()
    ? ['EXAMPLES OF MY PAST UPDATES (match their shape, wording and level of detail)', settings.examples.trim(), '']
    : [];

  const line = (i: MaterialItem) => {
    const tag = i.state ? `[${STATE_TAG[i.state]}] ` : i.kind === 'task-touched' ? '[OPEN - worked on this week, not done] ' : '';
    const about = i.taskTitle && i.kind === 'progress' ? `  (task: "${oneLine(i.taskTitle)}")` : '';
    const list = i.listName && (i.kind === 'task-done' || i.kind === 'task-touched') ? `  (list: ${i.listName})` : '';
    const note = i.detail && i.kind !== 'progress' ? `  — note: ${oneLine(i.detail)}` : '';
    return `- ${tag}${dayLabel(i.at)} · ${oneLine(i.text)}${about}${list}${note}`;
  };
  const materialLines: string[] = [`MATERIAL (${material.range.label})`];
  for (const id of sectionOrder) {
    const here = story.filter((i) => i.sectionId === id);
    if (!here.length) continue;
    materialLines.push(`*--- ${settings.sections.find((s) => s.id === id)?.label ?? id}*`, ...here.map(line));
  }
  if (!story.length && !noteItems.length) materialLines.push('(Nothing was logged or finished this week.)');

  const notesBlock = (room: number): string[] => (noteItems.length
    ? ['', 'NOTES I WROTE OR EDITED THIS WEEK (raw text)',
      ...noteItems.flatMap((n) => [`- Note "${oneLine(n.text)}" (edited ${dayLabel(n.at)}):`, ...clip(n.detail ?? '', room).split('\n').map((l) => `    ${l}`)])]
    : []);

  let bg = background.map((i) => `- ${i.kind === 'note' ? 'note edited' : i.kind === 'record' ? 'record' : 'task touched'}: ${oneLine(i.text)}`);
  let room = NOTE_CHARS;
  const assemble = () => [...head, ...examples, ...materialLines, ...notesBlock(room), ...(bg.length ? ['', 'BACKGROUND (context only)', ...bg] : [])].join('\n');
  let text = assemble();
  const before = bg.length;
  let notesShortened = false;
  // Too long: the background goes first, then each note gets a little less room. The story is never cut.
  while (text.length > PROMPT_LIMIT && (bg.length || room > 300)) {
    if (bg.length) bg = bg.slice(0, -1);
    else { room = Math.floor(room * 0.7); notesShortened = true; }
    text = assemble();
  }
  return { text, trimmed: before - bg.length, notesShortened };
}

/** Only the material, for pasting somewhere else. */
export function buildMaterialText(material: WeekMaterial, settings: WeeklySettings, skip: ReadonlySet<string> = new Set()): string {
  const full = buildWeeklyPrompt(material, settings, skip).text;
  const at = full.indexOf('MATERIAL (');
  return at < 0 ? '' : full.slice(at);
}
