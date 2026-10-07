import { describe, expect, it } from 'vitest';
import type { ApiProgressEntry } from '@/lib/api';
import {
  noteText,
  DEFAULT_SETTINGS, PROMPT_LIMIT, buildMaterialText, buildWeeklyPrompt, collectWeek, defaultWeekOffset, normalizeSettings,
  sectionFor, titleLine, weekRange, type WeeklySettings,
} from '@/lib/weeklyUpdate';
import type { Todo } from '@/types/todo';

const at = (iso: string) => new Date(iso).getTime(); // local time, no zone suffix
const entry = (o: Partial<ApiProgressEntry> & { text: string; at: number }): ApiProgressEntry => ({
  id: `e-${o.text.length}-${o.at}`, state: 'moved', section: '', taskId: '', noteId: '', recordId: '', createdAt: o.at, updatedAt: o.at, ...o,
});
const todo = (o: Partial<Todo> & { id: string; text: string }): Todo => ({
  status: 'todo', createdAt: at('2026-01-01T09:00:00'), listId: 'l1', order: 0, quadrant: 'do', ...o,
});
const base = { settings: DEFAULT_SETTINGS, entries: [], todos: [], lists: [{ id: 'l1', name: 'Rule engine' }], notes: [] };

describe('weekRange', () => {
  it('runs Monday to Sunday and labels the week the way the team writes it', () => {
    const r = weekRange(at('2026-10-01T10:00:00')); // a Thursday
    expect(new Date(r.startMs).getDay()).toBe(1);
    expect(new Date(r.startMs).getDate()).toBe(28);
    expect(new Date(r.endMs).getDate()).toBe(4);
    expect(r.label).toBe('Sep 28-Oct04');
    expect(weekRange(at('2026-09-23T10:00:00')).label).toBe('Sep 21-27');
    expect(weekRange(at('2026-09-20T23:00:00')).label).toBe('Sep 14-20'); // a Sunday belongs to the week before
    expect(weekRange(at('2026-09-21T00:00:00')).label).toBe('Sep 21-27'); // Monday starts the next
  });

  it('moves by whole weeks across a year end', () => {
    expect(weekRange(at('2027-01-05T10:00:00'), -1).label).toBe('Dec 28-Jan03');
    expect(weekRange(at('2026-10-01T10:00:00'), -1).label).toBe('Sep 21-27');
  });

  it('keeps Monday to Sunday across a clock change', () => {
    const r = weekRange(at('2026-11-04T10:00:00')); // a US clock change falls on Nov 1; the week after still starts Monday 00:00
    expect(new Date(r.startMs).getHours()).toBe(0);
    expect(new Date(r.endMs).getDay()).toBe(0);
  });

  it('defaults to the week just ended on Monday and Tuesday only', () => {
    expect(defaultWeekOffset(at('2026-10-05T09:00:00'))).toBe(-1);
    expect(defaultWeekOffset(at('2026-10-06T09:00:00'))).toBe(-1);
    expect(defaultWeekOffset(at('2026-10-07T09:00:00'))).toBe(0);
    expect(defaultWeekOffset(at('2026-10-04T09:00:00'))).toBe(0);
  });
});

describe('sectionFor', () => {
  const settings: WeeklySettings = {
    ...DEFAULT_SETTINGS,
    rules: [{ from: 'list', value: 'Bugs', sectionId: 'bugs' }, { from: 'category', value: 'work', sectionId: 'support' }, { from: 'field', value: 'Ticket', sectionId: 'tickets' }],
  };
  it('prefers the entry, then list, category and field, then the default', () => {
    expect(sectionFor(settings, { sectionId: 'tickets', listName: 'Bugs' })).toBe('tickets');
    expect(sectionFor(settings, { listName: 'bugs', category: 'work' })).toBe('bugs');
    expect(sectionFor(settings, { category: 'Work' })).toBe('support');
    expect(sectionFor(settings, { fieldLabels: ['ticket'] })).toBe('tickets');
    expect(sectionFor(settings, { listName: 'Other' })).toBe('work');
    expect(sectionFor(settings, { sectionId: 'gone' })).toBe('work');
  });
});

describe('normalizeSettings', () => {
  it('falls back to the defaults for anything missing or broken', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    const s = normalizeSettings({ teamName: ' Squad ', sections: [{ id: 'a', label: 'Alpha' }, { id: 5 }], rules: [{ from: 'list', value: 'x', sectionId: 'nope' }], defaultSectionId: 'zzz' });
    expect(s.teamName).toBe('Squad');
    expect(s.sections.map((x) => x.id)).toEqual(['a']);
    expect(s.rules).toEqual([]);
    expect(s.defaultSectionId).toBe('a');
  });
});

describe('collectWeek', () => {
  const now = at('2026-10-05T09:00:00'); // Monday: the update is for Sep 28-Oct 04
  it('takes only what falls in the week, with the Sunday evening in and the next Monday out', () => {
    const m = collectWeek({
      ...base, now, offsetWeeks: -1,
      entries: [entry({ text: 'in', at: at('2026-10-04T23:30:00') }), entry({ text: 'out', at: at('2026-10-05T00:10:00') }), entry({ text: 'before', at: at('2026-09-27T23:59:00') })],
      todos: [todo({ id: 'a', text: 'Done Sunday', status: 'done', completedAt: at('2026-10-04T20:00:00') }), todo({ id: 'b', text: 'Done Monday', status: 'done', completedAt: at('2026-10-05T08:00:00') })],
    });
    expect(m.items.map((i) => i.text).sort()).toEqual(['Done Sunday', 'in']);
  });

  it('keeps partial progress as partial and carries the task it is about', () => {
    const m = collectWeek({
      ...base, now, offsetWeeks: -1,
      entries: [entry({ text: 'Discussed with @naga, still open', state: 'discussed', at: at('2026-09-30T11:00:00'), taskId: 't1' })],
      todos: [todo({ id: 't1', text: 'Fix instance create', listId: 'l1' })],
    });
    expect(m.items[0]).toMatchObject({ kind: 'progress', state: 'discussed', taskTitle: 'Fix instance create', listName: 'Rule engine' });
  });

  it('lists a task once: finished wins over touched, and an untouched task is left out', () => {
    const m = collectWeek({
      ...base, now, offsetWeeks: -1,
      todos: [
        todo({ id: 'a', text: 'Finished', status: 'done', completedAt: at('2026-10-01T10:00:00'), updatedAt: at('2026-10-01T10:00:00') }),
        todo({ id: 'b', text: 'Edited', updatedAt: at('2026-10-02T10:00:00') }),
        todo({ id: 'c', text: 'Old', createdAt: at('2026-08-01T10:00:00'), updatedAt: at('2026-08-02T10:00:00') }),
        todo({ id: 'd', text: 'No server time', createdAt: at('2026-08-01T10:00:00') }),
      ],
    });
    expect(m.items.map((i) => `${i.kind}:${i.text}`)).toEqual(['task-done:Finished', 'task-touched:Edited']);
  });

  it('routes by the entry override and by the task list rule', () => {
    const settings = normalizeSettings({ ...DEFAULT_SETTINGS, rules: [{ from: 'list', value: 'Rule engine', sectionId: 'bugs' }] });
    const m = collectWeek({
      ...base, settings, now, offsetWeeks: -1,
      entries: [entry({ text: 'override', at: at('2026-09-29T10:00:00'), section: 'support' }), entry({ text: 'via task', at: at('2026-09-29T11:00:00'), taskId: 't1' })],
      todos: [todo({ id: 't1', text: 'T' })],
    });
    expect(m.items.map((i) => [i.text, i.sectionId])).toEqual([['override', 'support'], ['via task', 'bugs']]);
  });

  it('includes notes and records edited in the week', () => {
    const m = collectWeek({
      ...base, now, offsetWeeks: -1,
      notes: [{ id: 'n', title: 'Design notes', updatedAt: at('2026-10-02T10:00:00') }, { id: 'o', title: 'Old', updatedAt: at('2026-01-02T10:00:00') }],
      records: [{ id: 'r', databaseName: 'Bugs', title: 'ZCRM-1', createdAt: at('2026-09-30T10:00:00'), updatedAt: at('2026-09-30T10:00:00') }],
    });
    expect(m.items.map((i) => i.kind).sort()).toEqual(['note', 'record']);
  });
});

describe('buildWeeklyPrompt', () => {
  const now = at('2026-10-05T09:00:00');
  const material = collectWeek({
    ...base, now, offsetWeeks: -1,
    entries: [
      entry({ text: 'Discussed ZCRM-1058212 with @naga, [thread](https://x.test/t?a=1&b=2), looping him in', state: 'discussed', at: at('2026-09-30T11:00:00'), section: 'bugs' }),
      entry({ text: 'Waiting on #167471944 reply from the platform team', state: 'blocked', at: at('2026-10-01T11:00:00') }),
    ],
    todos: [todo({ id: 'a', text: 'Webhook action module flow', status: 'done', completedAt: at('2026-10-02T10:00:00') })],
    notes: [{ id: 'n', title: 'Playbook sync', updatedAt: at('2026-10-02T10:00:00') }],
  });

  it('states the format, the title line, the prefix rule and the partial-progress rule', () => {
    const { text } = buildWeeklyPrompt(material, DEFAULT_SETTINGS);
    expect(text).toContain('*Team - Sep 28-Oct04 Weekly Updates*');
    expect(titleLine(material.range, DEFAULT_SETTINGS)).toBe('*Team - Sep 28-Oct04 Weekly Updates*');
    expect(text).not.toContain('RE - ');
    expect(text).not.toContain('starts with');
    const withPrefix = buildWeeklyPrompt(material, { ...DEFAULT_SETTINGS, sections: DEFAULT_SETTINGS.sections.map((x) => (x.id === 'work' ? { ...x, prefix: 'TEAM - ' } : x)) }).text;
    expect(withPrefix).toContain('Every line under Work Items starts with "TEAM - "');
    expect(text).toContain('Never report a PARTIAL item as fixed');
    expect(text).toContain('Tickets, Bugs, Work Items, Support');
    expect(text).toContain('EXAMPLES OF MY PAST UPDATES');
  });

  it('passes ids, mentions and links through untouched and tags each state', () => {
    const { text } = buildWeeklyPrompt(material, DEFAULT_SETTINGS);
    expect(text).toContain('[PARTIAL - discussed, not finished] Sep 30 · Discussed ZCRM-1058212 with @naga, [thread](https://x.test/t?a=1&b=2), looping him in');
    expect(text).toContain('[BLOCKED] Oct 01 · Waiting on #167471944 reply from the platform team');
    expect(text).toContain('[DONE] Oct 02 · Webhook action module flow');
  });

  it('groups the material under its sections in the configured order, and drops empty ones', () => {
    const { text } = buildWeeklyPrompt(material, DEFAULT_SETTINGS);
    const material_ = text.slice(text.indexOf('MATERIAL ('));
    expect(material_.indexOf('*--- Bugs*')).toBeGreaterThan(-1);
    expect(material_.indexOf('*--- Bugs*')).toBeLessThan(material_.indexOf('*--- Work Items*'));
    expect(material_).not.toContain('*--- Tickets*');
    expect(material_).not.toContain('*--- Support*');
  });

  it('puts notes in a background list that is not to become lines', () => {
    const { text } = buildWeeklyPrompt(material, DEFAULT_SETTINGS);
    expect(text).toContain('BACKGROUND (context only)');
    expect(text).toContain('- note edited: Playbook sync');
  });

  it('leaves out what the person unticked', () => {
    const skip = new Set(material.items.filter((i) => i.kind === 'progress' && i.state === 'blocked').map((i) => i.key));
    const { text } = buildWeeklyPrompt(material, DEFAULT_SETTINGS, skip);
    expect(text).not.toContain('#167471944');
    expect(text).toContain('ZCRM-1058212');
  });

  it('says plainly when the week is empty', () => {
    const empty = collectWeek({ ...base, now, offsetWeeks: -1 });
    expect(buildWeeklyPrompt(empty, DEFAULT_SETTINGS).text).toContain('(Nothing was logged or finished this week.)');
  });

  it('drops background lines, never the story, to stay under the limit', () => {
    const notes = Array.from({ length: 400 }, (_, i) => ({ id: `n${i}`, title: `Note number ${i} ${'x'.repeat(40)}`, updatedAt: at('2026-10-02T10:00:00') }));
    const big = collectWeek({ ...base, now, offsetWeeks: -1, notes, entries: [entry({ text: 'Keep me', at: at('2026-10-01T10:00:00') })] });
    const { text, trimmed } = buildWeeklyPrompt(big, DEFAULT_SETTINGS);
    expect(text.length).toBeLessThanOrEqual(PROMPT_LIMIT);
    expect(trimmed).toBeGreaterThan(0);
    expect(text).toContain('Keep me');
  });

  it('can give just the material', () => {
    const only = buildMaterialText(material, DEFAULT_SETTINGS);
    expect(only.startsWith('MATERIAL (Sep 28-Oct04)')).toBe(true);
    expect(only).not.toContain('RULES');
  });
});

describe('what you wrote reaches the prompt', () => {
  const now = at('2026-10-07T09:00:00');
  const week = { ...base, now, offsetWeeks: 0 };

  it('an open task with a note becomes a line that carries the note, never a done one', () => {
    const m = collectWeek({
      ...week,
      todos: [
        todo({ id: 'a', text: 'follow up @indumathi reg table audi', note: "asked to @mandy this isn't not added", updatedAt: at('2026-10-06T11:00:00') }),
        todo({ id: 'b', text: 'edited but no words', updatedAt: at('2026-10-06T12:00:00') }),
      ],
    });
    const { text } = buildWeeklyPrompt(m, DEFAULT_SETTINGS);
    expect(text).toContain("[OPEN - worked on this week, not done] Oct 06 · follow up @indumathi reg table audi  (list: Rule engine)  — note: asked to @mandy this isn't not added");
    expect(text).toContain('- task touched: edited but no words');
    expect(text).toContain('Never report an OPEN item as completed');
  });

  it('a finished task keeps its note as extra detail', () => {
    const m = collectWeek({ ...week, todos: [todo({ id: 'a', text: 'Webhook flow', status: 'done', completedAt: at('2026-10-06T10:00:00'), note: 'tested with the sandbox' })] });
    expect(buildWeeklyPrompt(m, DEFAULT_SETTINGS).text).toContain('[DONE] Oct 06 · Webhook flow  (list: Rule engine)  — note: tested with the sandbox');
  });

  it('a note edited in the week goes in with its words, laid out as lines', () => {
    const text = noteText([
      { type: 'heading2', content: 'Kiosk screen' },
      { type: 'numbered', content: 'Sequence of the components in screen' },
      { type: 'bullet', content: 'field of lookup ( need to ask reg this with @gowtham )', indent: 1 },
      { type: 'todo', content: 'check **tab id**', checked: true },
      { type: 'divider', content: '' },
      { type: 'database', content: '' },
    ]);
    expect(text).toBe('Kiosk screen\n- Sequence of the components in screen\n  - field of lookup ( need to ask reg this with @gowtham )\n[x] check tab id');
    const m = collectWeek({ ...week, notes: [{ id: 'n', title: 'Bugs', updatedAt: at('2026-10-06T10:00:00'), text }] });
    const prompt = buildWeeklyPrompt(m, DEFAULT_SETTINGS).text;
    expect(prompt).toContain('NOTES I WROTE OR EDITED THIS WEEK (raw text)');
    expect(prompt).toContain('- Note "Bugs" (edited Oct 06):');
    expect(prompt).toContain('      - field of lookup ( need to ask reg this with @gowtham )');
    expect(prompt).not.toContain('(Nothing was logged or finished this week.)');
  });

  it('a very long note is cut to fit, the story is kept, and the prompt says it was shortened', () => {
    const long = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, title: `Note ${i}`, updatedAt: at('2026-10-06T10:00:00'), text: 'word '.repeat(600) }));
    const m = collectWeek({ ...week, notes: long, entries: [entry({ text: 'Keep this line', at: at('2026-10-06T09:00:00') })] });
    const { text, notesShortened } = buildWeeklyPrompt(m, DEFAULT_SETTINGS);
    expect(text.length).toBeLessThanOrEqual(PROMPT_LIMIT);
    expect(notesShortened).toBe(true);
    expect(text).toContain('Keep this line');
  });

  it('settings saved by the older build keep working, without its "RE - " prefix', () => {
    const legacy = {
      teamName: 'Team', defaultSectionId: 'work', rules: [],
      sections: [{ id: 'tickets', label: 'Tickets' }, { id: 'bugs', label: 'Bugs' }, { id: 'work', label: 'Work Items', prefix: 'RE - ' }, { id: 'support', label: 'Support' }],
      examples: DEFAULT_SETTINGS.examples.replace(/^(\d\. )(?=Debug|Discussed|Webhook)/gm, '$1RE - '),
    };
    const migrated = normalizeSettings(legacy);
    expect(migrated.sections.find((x) => x.id === 'work')?.prefix).toBeUndefined();
    expect(migrated.examples).not.toContain('RE - ');
    // Someone who chose their own prefix keeps it.
    const own = normalizeSettings({ ...legacy, examples: 'my own examples', sections: legacy.sections });
    expect(own.sections.find((x) => x.id === 'work')?.prefix).toBe('RE - ');
  });
});
