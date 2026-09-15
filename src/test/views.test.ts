import { describe, expect, it } from 'vitest';
import {
  deleteView, getView, insertView, listViews, normaliseFilters, parseViewBody,
  toView, toRow, updateView, type SavedView,
} from '../../server/views.ts';
import { fakeCatalyst } from './helpers/fakeCatalyst.ts';

const view = (over: Partial<SavedView> = {}): SavedView => ({
  id: 'v1', ownerId: 'user-1', name: 'Overdue at work', layout: 'list', scopeListId: 'list-work',
  filters: normaliseFilters({ due: 'overdue' }), showDone: false, viewOrder: 0, createdAt: 1, updatedAt: 1,
  ...over,
});

describe('normaliseFilters', () => {
  it('drops unknown fields and resets illegal values', () => {
    const out = normaliseFilters({
      due: 'overdue', status: 'NOPE', quadrant: 'DO', sortBy: 'priority', sortDir: 'sideways',
      dueAfter: 'yesterday', dueBefore: '2030-06-20', priority: 'HIGH', search: 'x'.repeat(500),
    });
    expect(out).toEqual({
      search: 'x'.repeat(200), status: '', quadrant: 'DO', due: 'overdue',
      dueAfter: '', dueBefore: '2030-06-20', sortBy: 'order', sortDir: 'asc', fields: {}, groupBy: '',
    });
    expect(out).not.toHaveProperty('priority');
  });

  it('treats anything that is not an object as no filters', () => {
    expect(normaliseFilters('nope').sortBy).toBe('order');
    expect(normaliseFilters(null).due).toBe('');
    expect(normaliseFilters([1, 2]).status).toBe('');
  });
});

describe('parseViewBody', () => {
  it('accepts a complete view', () => {
    const parsed = parseViewBody({ name: '  Today  ', layout: 'matrix', scopeListId: '', filters: { due: 'today' }, showDone: true });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.name).toBe('Today');
      expect(parsed.value.filters.due).toBe('today');
      expect(parsed.value.showDone).toBe(true);
    }
  });

  it('names every invalid field', () => {
    const parsed = parseViewBody({ name: '', layout: 'board', scopeListId: 'bad id!', filters: [], showDone: 'yes', viewOrder: -1 });
    expect(parsed.ok).toBe(false);
    // `in`, not `!parsed.ok`: the app tsconfig does not narrow on a false literal.
    if ('errors' in parsed) {
      expect(Object.keys(parsed.errors).sort()).toEqual(['filters', 'layout', 'name', 'scopeListId', 'showDone', 'viewOrder']);
    }
  });

  it('rejects an over-long name rather than truncating it', () => {
    expect(parseViewBody({ name: 'x'.repeat(101) }).ok).toBe(false);
  });
});

describe('rows', () => {
  it('round-trips through the datastore shape', () => {
    const stored = toRow(view());
    // Every value comes back as a string, as the datastore returns it.
    const back = toView({ ...stored, ROWID: '69251000000086009' });
    expect(back).toEqual({ ...view(), rowId: '69251000000086009' });
  });

  it('reads a row with unreadable filter JSON as no filters', () => {
    const back = toView({ ...toRow(view()), FilterJson: '{broken', ROWID: '1' });
    expect(back.filters).toEqual(normaliseFilters({}));
  });
});

describe('storage', () => {
  it('lists only the owner\'s views, in their order', async () => {
    const fake = fakeCatalyst();
    await insertView(fake.app, view({ id: 'b', viewOrder: 1 }));
    await insertView(fake.app, view({ id: 'a', viewOrder: 0 }));
    await insertView(fake.app, view({ id: 'other', ownerId: 'user-2' }));

    expect((await listViews(fake.app, 'user-1')).map((v) => v.id)).toEqual(['a', 'b']);
  });

  it('will not fetch another owner\'s view by id', async () => {
    const fake = fakeCatalyst();
    await insertView(fake.app, view({ id: 'v1', ownerId: 'user-2' }));
    expect(await getView(fake.app, 'user-1', 'v1')).toBeNull();
  });

  it('updates and deletes by row', async () => {
    const fake = fakeCatalyst();
    await insertView(fake.app, view());
    const row = (await getView(fake.app, 'user-1', 'v1'))!;

    await updateView(fake.app, row.rowId, { ...row, name: 'Renamed' });
    expect((await getView(fake.app, 'user-1', 'v1'))!.name).toBe('Renamed');

    await deleteView(fake.app, row.rowId);
    expect(await getView(fake.app, 'user-1', 'v1')).toBeNull();
  });
});

describe('normaliseFilters — custom fields', () => {
  it('keeps valid field choices and the group-by field, and drops the rest', () => {
    const out = normaliseFilters({
      fields: { effort: ['hi', '__set__', 'bad id!', 7], 'bad key!': ['x'], empty: [], notArray: 'x' },
      groupBy: 'effort',
    });
    expect(out.fields).toEqual({ effort: ['hi', '__set__'] });
    expect(out.groupBy).toBe('effort');
    expect(normaliseFilters({ fields: [1], groupBy: 'no spaces allowed' })).toMatchObject({ fields: {}, groupBy: '' });
  });
});

describe('table layout and field sorts', () => {
  it('accepts the table layout and reads it back from a row', () => {
    const parsed = parseViewBody({ name: 'Everything', layout: 'table' });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.layout).toBe('table');
    expect(toView({ ROWID: '1', ...toRow(view({ layout: 'table' })) }).layout).toBe('table');
  });

  it('keeps a field or quadrant sort, and drops a malformed one', () => {
    expect(normaliseFilters({ sortBy: 'field:effort' }).sortBy).toBe('field:effort');
    expect(normaliseFilters({ sortBy: 'quadrant' }).sortBy).toBe('quadrant');
    expect(normaliseFilters({ sortBy: 'field:not valid!' }).sortBy).toBe('order');
  });
});
