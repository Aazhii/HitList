import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  applyTaskFilters,
  compareAcrossQuadrants,
  compareForFilters,
  groupByField,
  groupFieldFor,
  countActiveFilters,
  normaliseFilters,
  sameFilters,
  FIELD_EMPTY,
  FIELD_SET,
  type FilterState,
} from '@/lib/taskFilters';
import type { FieldDef, TaskFieldValues } from '@/types/fields';
import { compareTasks } from '@/lib/quadrantBuckets';
import type { Todo } from '@/types/todo';

// Local noon on 15 June 2030; every date below is relative to it.
const NOW = new Date(2030, 5, 15, 12, 0, 0);
const f = (over: Partial<FilterState>): FilterState => ({ ...DEFAULT_FILTERS, ...over });

let seq = 0;
const todo = (over: Partial<Todo>): Todo => ({
  id: `t${++seq}`, text: 'Task', status: 'todo', createdAt: seq, listId: 'l', order: seq, quadrant: 'do', ...over,
});
const ids = (list: Todo[]) => list.map((t) => t.text);

describe('applyTaskFilters', () => {
  it('returns everything with the default filters', () => {
    const all = [todo({}), todo({ status: 'done' })];
    expect(applyTaskFilters(all, DEFAULT_FILTERS, NOW)).toHaveLength(2);
    expect(countActiveFilters(DEFAULT_FILTERS)).toBe(0);
  });

  it('filters by status and quadrant', () => {
    const all = [
      todo({ text: 'a', status: 'todo', quadrant: 'do' }),
      todo({ text: 'b', status: 'in-progress', quadrant: 'schedule' }),
      todo({ text: 'c', status: 'done', quadrant: 'do' }),
    ];
    expect(ids(applyTaskFilters(all, f({ status: 'IN_PROGRESS' }), NOW))).toEqual(['b']);
    expect(ids(applyTaskFilters(all, f({ quadrant: 'DO' }), NOW))).toEqual(['a', 'c']);
    expect(ids(applyTaskFilters(all, f({ quadrant: 'DO', status: 'DONE' }), NOW))).toEqual(['c']);
  });

  it('searches the title, the note and the category, ignoring case', () => {
    const all = [
      todo({ text: 'Call the BANK' }),
      todo({ text: 'Review', note: 'bank statement attached' }),
      todo({ text: 'Standup', category: 'work' }),
      todo({ text: 'Unrelated' }),
    ];
    expect(ids(applyTaskFilters(all, f({ search: 'bank' }), NOW))).toEqual(['Call the BANK', 'Review']);
    expect(ids(applyTaskFilters(all, f({ search: 'WORK' }), NOW))).toEqual(['Standup']);
  });

  it('finds overdue tasks by their time, or the end of their day', () => {
    const all = [
      todo({ text: 'this morning', dueDate: '2030-06-15', dueTime: '09:00' }),
      todo({ text: 'today, no time', dueDate: '2030-06-15' }),
      todo({ text: 'yesterday', dueDate: '2030-06-14' }),
      todo({ text: 'done late', dueDate: '2030-06-14', status: 'done' }),
      todo({ text: 'no date' }),
    ];
    expect(ids(applyTaskFilters(all, f({ due: 'overdue' }), NOW))).toEqual(['this morning', 'yesterday']);
  });

  it('filters due today, within the next 7 days, and with no due date', () => {
    const all = [
      todo({ text: 'yesterday', dueDate: '2030-06-14' }),
      todo({ text: 'today', dueDate: '2030-06-15' }),
      todo({ text: 'day 7', dueDate: '2030-06-22' }),
      todo({ text: 'day 8', dueDate: '2030-06-23' }),
      todo({ text: 'none' }),
    ];
    expect(ids(applyTaskFilters(all, f({ due: 'today' }), NOW))).toEqual(['today']);
    expect(ids(applyTaskFilters(all, f({ due: 'next7' }), NOW))).toEqual(['today', 'day 7']);
    expect(ids(applyTaskFilters(all, f({ due: 'none' }), NOW))).toEqual(['none']);
  });

  it('treats the date range as inclusive and leaves undated tasks out', () => {
    const all = [
      todo({ text: 'before', dueDate: '2030-06-09' }),
      todo({ text: 'start', dueDate: '2030-06-10' }),
      todo({ text: 'end', dueDate: '2030-06-20' }),
      todo({ text: 'after', dueDate: '2030-06-21' }),
      todo({ text: 'undated' }),
    ];
    expect(ids(applyTaskFilters(all, f({ dueAfter: '2030-06-10', dueBefore: '2030-06-20' }), NOW)))
      .toEqual(['start', 'end']);
  });
});

describe('compareForFilters', () => {
  it('is the manual order by default, so drag order is unchanged', () => {
    expect(compareForFilters(DEFAULT_FILTERS)).toBe(compareTasks);
  });

  it('sorts by title either way and keeps done tasks last', () => {
    const list = [todo({ text: 'b' }), todo({ text: 'z', status: 'done' }), todo({ text: 'a' }), todo({ text: 'c' })];
    expect(ids([...list].sort(compareForFilters({ sortBy: 'title', sortDir: 'asc' })))).toEqual(['a', 'b', 'c', 'z']);
    expect(ids([...list].sort(compareForFilters({ sortBy: 'title', sortDir: 'desc' })))).toEqual(['c', 'b', 'a', 'z']);
  });

  it('puts tasks without a due date last in both directions', () => {
    const list = [
      todo({ text: 'none' }),
      todo({ text: 'late', dueDate: '2030-06-20' }),
      todo({ text: 'early', dueDate: '2030-06-10' }),
    ];
    expect(ids([...list].sort(compareForFilters({ sortBy: 'due-date', sortDir: 'asc' })))).toEqual(['early', 'late', 'none']);
    expect(ids([...list].sort(compareForFilters({ sortBy: 'due-date', sortDir: 'desc' })))).toEqual(['late', 'early', 'none']);
  });
});

describe('normaliseFilters / sameFilters', () => {
  it('drops fields the app no longer has, such as priority', () => {
    const out = normaliseFilters({ priority: 'HIGH', quadrant: 'DO', sortBy: 'priority' });
    expect(out).toEqual({ ...DEFAULT_FILTERS, quadrant: 'DO' });
    expect(out).not.toHaveProperty('priority');
  });

  it('resets illegal values and ignores non-objects', () => {
    expect(normaliseFilters({ due: 'someday', dueAfter: '15/06/2030', sortDir: 'up' })).toEqual(DEFAULT_FILTERS);
    expect(normaliseFilters('nope')).toEqual(DEFAULT_FILTERS);
  });

  it('compares filters by what they show', () => {
    expect(sameFilters({ quadrant: 'DO' }, { ...DEFAULT_FILTERS, quadrant: 'DO', priority: 'HIGH' })).toBe(true);
    expect(sameFilters({ quadrant: 'DO' }, { quadrant: 'SCHEDULE' })).toBe(false);
  });
});

describe('applyTaskFilters — custom fields', () => {
  const defs: FieldDef[] = [
    { id: 'effort', name: 'Effort', kind: 'select', options: [{ id: 'lo', label: 'Low', color: 'sage' }, { id: 'hi', label: 'High', color: 'do' }], fieldOrder: 0, showOnCard: true, createdAt: 1, updatedAt: 1 },
    { id: 'ctx', name: 'Context', kind: 'multi', options: [{ id: 'home', label: 'Home', color: 'accent' }, { id: 'office', label: 'Office', color: 'sage' }], fieldOrder: 1, showOnCard: true, createdAt: 1, updatedAt: 1 },
    { id: 'blocked', name: 'Blocked', kind: 'checkbox', options: [], fieldOrder: 2, showOnCard: true, createdAt: 1, updatedAt: 1 },
  ];
  const a = todo({ text: 'a' }); const b = todo({ text: 'b' }); const c = todo({ text: 'c' });
  const values: TaskFieldValues = {
    [a.id]: { effort: 'hi', ctx: ['home', 'office'], blocked: true },
    [b.id]: { effort: 'lo', ctx: ['office'] },
    [c.id]: {},
  };
  const run = (fields: Record<string, string[]>) =>
    ids(applyTaskFilters([a, b, c], f({ fields }), NOW, { defs, values }));

  it('matches a select option, and any of several', () => {
    expect(run({ effort: ['hi'] })).toEqual(['a']);
    expect(run({ effort: ['hi', 'lo'] })).toEqual(['a', 'b']);
  });

  it('matches a multi-select that contains the option', () => {
    expect(run({ ctx: ['home'] })).toEqual(['a']);
    expect(run({ ctx: ['office'] })).toEqual(['a', 'b']);
  });

  it('filters on having a value or not — checked and unchecked for a checkbox', () => {
    expect(run({ blocked: [FIELD_SET] })).toEqual(['a']);
    expect(run({ blocked: [FIELD_EMPTY] })).toEqual(['b', 'c']);
    expect(run({ effort: [FIELD_EMPTY] })).toEqual(['c']);
  });

  it('combines fields with AND', () => {
    expect(run({ effort: ['lo', 'hi'], ctx: ['home'] })).toEqual(['a']);
  });

  it('ignores a filter on a field that no longer exists, instead of hiding everything', () => {
    expect(run({ deleted: ['x'] })).toEqual(['a', 'b', 'c']);
    expect(ids(applyTaskFilters([a, b, c], f({ fields: { effort: ['hi'] } }), NOW))).toEqual(['a', 'b', 'c']);
  });

  it('counts field filters and group-by as active, and compares them regardless of order', () => {
    expect(countActiveFilters(f({ fields: { effort: ['hi'], ctx: [] }, groupBy: 'effort' }))).toBe(2);
    expect(sameFilters(f({ fields: { effort: ['hi', 'lo'] } }), f({ fields: { effort: ['lo', 'hi'] } }))).toBe(true);
    expect(sameFilters(f({ fields: { effort: ['hi'] } }), f({}))).toBe(false);
  });
});

describe('sorting and grouping by custom fields', () => {
  const effort: FieldDef = {
    id: 'effort', name: 'Effort', kind: 'select',
    options: [{ id: 'lo', label: 'Low', color: 'sage' }, { id: 'mid', label: 'Mid', color: 'accent' }, { id: 'hi', label: 'High', color: 'do' }],
    fieldOrder: 0, showOnCard: false, createdAt: 1, updatedAt: 1,
  };
  const points: FieldDef = { id: 'points', name: 'Points', kind: 'number', options: [], fieldOrder: 1, showOnCard: false, createdAt: 1, updatedAt: 1 };
  const text: FieldDef = { id: 'memo', name: 'Memo', kind: 'text', options: [], fieldOrder: 2, showOnCard: false, createdAt: 1, updatedAt: 1 };
  const defs = [effort, points, text];

  const a = todo({ text: 'a', quadrant: 'schedule', order: 1 });
  const b = todo({ text: 'b', quadrant: 'do', order: 5 });
  const c = todo({ text: 'c', quadrant: 'do', order: 2 });
  const done = todo({ text: 'done', quadrant: 'do', order: 0, status: 'done' });
  const values: TaskFieldValues = {
    [a.id]: { effort: 'hi', points: 3 },
    [b.id]: { effort: 'lo', points: 10 },
    [c.id]: { effort: 'gone' },
    [done.id]: { effort: 'lo' },
  };
  const custom = { defs, values };
  const sorted = (over: Partial<FilterState>, list = [a, b, c]) =>
    ids([...list].sort(compareForFilters(f(over), custom)));

  it('sorts a select by the option order, with no value last in both directions', () => {
    expect(sorted({ sortBy: 'field:effort' })).toEqual(['b', 'a', 'c']);
    expect(sorted({ sortBy: 'field:effort', sortDir: 'desc' })).toEqual(['a', 'b', 'c']);
  });

  it('sorts numbers as numbers, not as text', () => {
    expect(sorted({ sortBy: 'field:points' })).toEqual(['a', 'b', 'c']);
  });

  it('keeps done tasks last when sorting by a field', () => {
    expect(sorted({ sortBy: 'field:effort' }, [done, a, b])).toEqual(['b', 'a', 'done']);
  });

  it('falls back to the manual order when the sort field no longer exists', () => {
    expect(compareForFilters(f({ sortBy: 'field:deleted' }), custom)).toBe(compareTasks);
  });

  it('sorts by quadrant', () => {
    expect(sorted({ sortBy: 'quadrant' })).toEqual(['c', 'b', 'a']);
  });

  it('orders tasks from several quadrants by quadrant, then manual order', () => {
    expect(ids([a, b, c].sort(compareAcrossQuadrants(DEFAULT_FILTERS, custom)))).toEqual(['c', 'b', 'a']);
    expect(ids([a, b, c].sort(compareAcrossQuadrants(f({ sortBy: 'title' }), custom)))).toEqual(['a', 'b', 'c']);
  });

  it('groups by a select in option order, counting a deleted option as no value', () => {
    const groups = groupByField([a, b, c, done], false, compareAcrossQuadrants(DEFAULT_FILTERS, custom), effort, values);
    expect(groups.map((g) => [g.label, ids(g.tasks)])).toEqual([
      ['Low', ['b']], ['Mid', []], ['High', ['a']], ['No Effort', ['c']],
    ]);
  });

  it('adds the no-value group only when a task needs it, and shows done tasks when asked', () => {
    const groups = groupByField([a, b, done], true, compareTasks, effort, values);
    expect(groups.map((g) => g.key)).toEqual(['lo', 'mid', 'hi']);
    expect(ids(groups[0].tasks)).toEqual(['b', 'done']);
  });

  it('only groups by a select field that still exists', () => {
    expect(groupFieldFor({ groupBy: 'effort' }, defs)).toBe(effort);
    expect(groupFieldFor({ groupBy: 'points' }, defs)).toBeNull();
    expect(groupFieldFor({ groupBy: 'deleted' }, defs)).toBeNull();
    expect(groupFieldFor({ groupBy: '' }, defs)).toBeNull();
  });

  it('keeps a field or quadrant sort when normalising, and drops a malformed one', () => {
    expect(normaliseFilters({ sortBy: 'field:effort' }).sortBy).toBe('field:effort');
    expect(normaliseFilters({ sortBy: 'quadrant' }).sortBy).toBe('quadrant');
    expect(normaliseFilters({ sortBy: 'field:not valid!' }).sortBy).toBe('order');
  });
});
