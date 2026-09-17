import { describe, expect, it } from 'vitest';
import {
  decodeValue, deleteDefsAndPropsForDatabase, deletePropsForDef, deletePropsForTask, encodeValue,
  getDef, insertDef, listDefs, listProps, normaliseOptions, parseFieldBody, propId, setFieldsDatabaseAvailable,
  setProp, toDef, defToRow, type FieldDef,
} from '../../server/fields.ts';
import { fakeCatalyst } from './helpers/fakeCatalyst.ts';

let n = 0;
const ids = () => `opt${++n}`;
const def = (over: Partial<FieldDef> = {}): FieldDef => ({
  id: 'd1', ownerId: 'user-1', databaseId: '', name: 'Effort', kind: 'select',
  options: [{ id: 'lo', label: 'Low', color: 'sage' }, { id: 'hi', label: 'High', color: 'do' }],
  fieldOrder: 0, showOnCard: true, createdAt: 1, updatedAt: 1, ...over,
});

describe('normaliseOptions', () => {
  it('keeps valid ids, so renaming an option keeps the tasks that use it', () => {
    expect(normaliseOptions([{ id: 'lo', label: ' Lower ', color: 'sage' }], ids))
      .toEqual([{ id: 'lo', label: 'Lower', color: 'sage' }]);
  });

  it('drops empty labels, fixes bad colours and gives new or clashing options fresh ids', () => {
    const out = normaliseOptions([{ label: 'A' }, { id: 'x', label: '' }, { id: 'dup', label: 'B', color: 'neon' }, { id: 'dup', label: 'C' }], ids);
    expect(out.map((o) => o.label)).toEqual(['A', 'B', 'C']);
    expect(out[1].color).toBe('accent');
    expect(new Set(out.map((o) => o.id)).size).toBe(3);
  });
});

describe('parseFieldBody', () => {
  it('creates a multi-select with its options', () => {
    const r = parseFieldBody({ name: 'Context', kind: 'multi', options: [{ label: 'Home' }, { label: 'Office' }] }, undefined, ids);
    expect(r.ok && r.value.options.map((o) => o.label)).toEqual(['Home', 'Office']);
  });

  it("refuses to change a field's kind, so stored values stay readable", () => {
    const r = parseFieldBody({ name: 'Effort', kind: 'number' }, def());
    expect('errors' in r && r.errors.kind).toMatch(/cannot change/);
  });

  it('keeps existing options when an update sends none, and ignores options on other kinds', () => {
    const r = parseFieldBody({ name: 'Effort' }, def());
    expect(r.ok && r.value.options).toEqual(def().options);
    const numeric = parseFieldBody({ name: 'Points', kind: 'number', options: [{ label: 'x' }] }, undefined, ids);
    expect(numeric.ok && numeric.value.options).toEqual([]);
  });

  it('names every problem', () => {
    const r = parseFieldBody({ name: '', kind: 'colour', options: 'x', showOnCard: 'yes', fieldOrder: 1.5 });
    expect('errors' in r && Object.keys(r.errors).sort()).toEqual(['fieldOrder', 'kind', 'name', 'options', 'showOnCard']);
  });
});

describe('encodeValue / decodeValue', () => {
  const kinds = {
    select: def(),
    multi: def({ kind: 'multi' }),
    number: def({ kind: 'number', options: [] }),
    date: def({ kind: 'date', options: [] }),
    checkbox: def({ kind: 'checkbox', options: [] }),
    text: def({ kind: 'text', options: [] }),
  };
  const roundTrip = (d: FieldDef, v: unknown) => {
    const e = encodeValue(d, v);
    // `in`, not `!e.ok`: the app tsconfig does not narrow on a false literal.
    if ('error' in e) throw new Error(e.error);
    return e.text === null ? null : decodeValue(d, e.text);
  };

  it('round-trips every kind', () => {
    expect(roundTrip(kinds.select, 'hi')).toBe('hi');
    expect(roundTrip(kinds.multi, ['lo', 'hi', 'lo'])).toEqual(['lo', 'hi']);
    expect(roundTrip(kinds.number, 2.5)).toBe(2.5);
    expect(roundTrip(kinds.number, 0)).toBe(0);
    expect(roundTrip(kinds.date, '2030-02-28')).toBe('2030-02-28');
    expect(roundTrip(kinds.checkbox, true)).toBe(true);
    expect(roundTrip(kinds.text, 'waiting on review')).toBe('waiting on review');
  });

  it('clears on empty, false, or no options', () => {
    expect(roundTrip(kinds.checkbox, false)).toBeNull();
    expect(roundTrip(kinds.multi, [])).toBeNull();
    expect(roundTrip(kinds.text, '   ')).toBeNull();
    expect(roundTrip(kinds.select, null)).toBeNull();
  });

  it('rejects values of the wrong kind instead of coercing them', () => {
    expect(encodeValue(kinds.number, '5').ok).toBe(false);
    expect(encodeValue(kinds.date, '2030-02-30').ok).toBe(false);
    expect(encodeValue(kinds.select, 'nope').ok).toBe(false);
    expect(encodeValue(kinds.multi, ['lo', 'nope']).ok).toBe(false);
    expect(encodeValue(kinds.checkbox, 'true').ok).toBe(false);
  });

  it('reads a removed option as no value, and junk as nothing', () => {
    expect(decodeValue(kinds.select, 'gone')).toBeNull();
    expect(decodeValue(kinds.multi, '["lo","gone"]')).toEqual(['lo']);
    expect(decodeValue(kinds.multi, '{broken')).toBeNull();
    expect(decodeValue(kinds.number, 'abc')).toBeNull();
  });
});

describe('propId', () => {
  it('is deterministic and fits the 64-character column', () => {
    const task = 'c3e1b7d2-4a5f-4c8e-9b1d-7f2a6e3c5b41';
    const field = '5f0c9a2e-8d1b-4e6f-9a3c-2b7d4e1f8a90';
    expect(propId(task, field)).toBe(propId(task, field));
    expect(propId(task, field).length).toBeLessThanOrEqual(64);
    expect(propId(task, field)).not.toBe(propId(field, task));
  });
});

describe('storage', () => {
  it('round-trips a definition', () => {
    expect(toDef({ ...defToRow(def()), ROWID: '9' })).toEqual({ ...def(), rowId: '9' });
  });

  it("lists only the owner's fields, in order", async () => {
    const fake = fakeCatalyst();
    await insertDef(fake.app, def({ id: 'a', fieldOrder: 1 }));
    await insertDef(fake.app, def({ id: 'b', fieldOrder: 0 }));
    await insertDef(fake.app, def({ id: 'c', ownerId: 'user-2' }));
    expect((await listDefs(fake.app, 'user-1')).map((d) => d.id)).toEqual(['b', 'a']);
    expect(await getDef(fake.app, 'user-1', 'c')).toBeNull();
  });

  it('keeps one value per task and field: set, update, clear', async () => {
    const fake = fakeCatalyst();
    await setProp(fake.app, 'user-1', 't1', 'd1', 'lo');
    await setProp(fake.app, 'user-1', 't1', 'd1', 'hi');
    expect((await listProps(fake.app, 'user-1')).map((r) => r.valueText)).toEqual(['hi']);

    await setProp(fake.app, 'user-1', 't1', 'd1', null);
    expect(await listProps(fake.app, 'user-1')).toHaveLength(0);
  });

  it("removes values when their field or task is deleted, and no one else's", async () => {
    const fake = fakeCatalyst();
    await setProp(fake.app, 'user-1', 't1', 'd1', 'lo');
    await setProp(fake.app, 'user-1', 't2', 'd1', 'hi');
    await setProp(fake.app, 'user-1', 't1', 'd2', '5');
    await setProp(fake.app, 'user-2', 't9', 'd1', 'lo');

    expect(await deletePropsForDef(fake.app, 'user-1', 'd1')).toBe(2);
    expect(await deletePropsForTask(fake.app, 'user-1', 't1')).toBe(1);
    expect(await listProps(fake.app, 'user-1')).toHaveLength(0);
    expect(await listProps(fake.app, 'user-2')).toHaveLength(1);
  });

  it('deletes every database field and value without touching another database', async () => {
    const fake = fakeCatalyst();
    setFieldsDatabaseAvailable(true);
    try {
      await insertDef(fake.app, def({ id: 'db1-field', databaseId: 'db1' }));
      await insertDef(fake.app, def({ id: 'db2-field', databaseId: 'db2' }));
      await setProp(fake.app, 'user-1', 'record-1', 'db1-field', 'lo');
      await setProp(fake.app, 'user-1', 'record-2', 'db2-field', 'hi');

      expect(await deleteDefsAndPropsForDatabase(fake.app, 'user-1', 'db1'))
        .toEqual({ definitionsRemoved: 1, propertiesRemoved: 1 });
      expect(await listDefs(fake.app, 'user-1', 'db1')).toEqual([]);
      expect((await listDefs(fake.app, 'user-1', 'db2')).map((field) => field.id)).toEqual(['db2-field']);
      expect((await listProps(fake.app, 'user-1')).map((prop) => prop.defId)).toEqual(['db2-field']);
      expect(await deleteDefsAndPropsForDatabase(fake.app, 'user-1', 'db1'))
        .toEqual({ definitionsRemoved: 0, propertiesRemoved: 0 });
    } finally {
      setFieldsDatabaseAvailable(false);
    }
  });
});
