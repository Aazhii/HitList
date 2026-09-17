/**
 * Databases and their records: validation, the row shapes, and storage that
 * pages past 300 rows and stays inside one owner.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_TITLE, databaseToRow, deleteDatabase, deleteRowsOfDatabase, getDatabase, getRow,
  insertDatabase, insertRow, listDatabases, listRows, markDatabaseDeleting, markRowDeleting,
  parseDatabaseBody, parseRowBody, rowToRow, setDatabaseDateFieldAvailable, toDatabase, toDatabaseRow, updateDatabase,
  type DatabaseRow, type KaizenDatabase,
} from '../../server/databases.ts';
import { fakeCatalyst } from './helpers/fakeCatalyst.ts';

const db = (over: Partial<KaizenDatabase> = {}): KaizenDatabase => ({
  id: 'db1', ownerId: 'user-1', name: 'Reading list', icon: '📚', dateFieldId: '', dbOrder: 0,
  createdAt: 1, updatedAt: 1, ...over,
});

const record = (over: Partial<DatabaseRow> = {}): DatabaseRow => ({
  id: 'r1', ownerId: 'user-1', databaseId: 'db1', title: 'Dune', rowOrder: 0,
  createdAt: 1, updatedAt: 1, ...over,
});

describe('parseDatabaseBody', () => {
  it('accepts a name and an emoji, trimming the name', () => {
    const parsed = parseDatabaseBody({ name: '  Clients  ', icon: '🗂' });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toEqual({ name: 'Clients', icon: '🗂', dateFieldId: '', dbOrder: undefined });
    }
  });

  it('takes the calendar\'s date field, and refuses one that is not a field id', () => {
    const ok = parseDatabaseBody({ name: 'Books', dateFieldId: 'due-field' });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.dateFieldId).toBe('due-field');

    const bad = parseDatabaseBody({ name: 'Books', dateFieldId: 'not a field id!' });
    expect(bad.ok).toBe(false);
    if ('errors' in bad) expect(bad.errors['dateFieldId']).toBeDefined();
  });

  it('names every invalid field', () => {
    const parsed = parseDatabaseBody({ name: '', icon: 'x'.repeat(20), dbOrder: -1 });
    expect(parsed.ok).toBe(false);
    if ('errors' in parsed) {
      expect(Object.keys(parsed.errors).sort()).toEqual(['dbOrder', 'icon', 'name']);
    }
  });

  it('rejects an over-long name rather than truncating it', () => {
    expect(parseDatabaseBody({ name: 'x'.repeat(101) }).ok).toBe(false);
  });
});

describe('parseRowBody', () => {
  it('requires a title', () => {
    expect(parseRowBody({ title: '   ' }).ok).toBe(false);
    const parsed = parseRowBody({ title: ' Dune ' });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.title).toBe('Dune');
  });

  it('rejects a title longer than the column', () => {
    expect(parseRowBody({ title: 'x'.repeat(MAX_TITLE + 1) }).ok).toBe(false);
  });
});

describe('row shapes', () => {
  it('round-trip through the datastore shape', () => {
    expect(toDatabase({ ROWID: '9', ...databaseToRow(db()) })).toEqual({ ...db(), rowId: '9' });
    expect(toDatabaseRow({ ROWID: '8', ...rowToRow(record()) })).toEqual({ ...record(), rowId: '8' });
  });
});

describe('storage', () => {
  it('lists only the owner\'s databases, in their order', async () => {
    const fake = fakeCatalyst();
    await insertDatabase(fake.app, db({ id: 'b', dbOrder: 1 }));
    await insertDatabase(fake.app, db({ id: 'a', dbOrder: 0 }));
    await insertDatabase(fake.app, db({ id: 'other', ownerId: 'user-2' }));

    expect((await listDatabases(fake.app, 'user-1')).map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('will not fetch another owner\'s database or record by id', async () => {
    const fake = fakeCatalyst();
    await insertDatabase(fake.app, db({ ownerId: 'user-2' }));
    await insertRow(fake.app, record({ ownerId: 'user-2' }));

    expect(await getDatabase(fake.app, 'user-1', 'db1')).toBeNull();
    expect(await getRow(fake.app, 'user-1', 'r1')).toBeNull();
  });

  it('keeps a database\'s records apart from another\'s', async () => {
    const fake = fakeCatalyst();
    await insertRow(fake.app, record({ id: 'r1', databaseId: 'db1' }));
    await insertRow(fake.app, record({ id: 'r2', databaseId: 'db2' }));

    expect((await listRows(fake.app, 'user-1', 'db1')).map((r) => r.id)).toEqual(['r1']);
  });

  it('reads every page, so nothing is cut off at 300', async () => {
    const fake = fakeCatalyst();
    for (let i = 0; i < 305; i++) {
      await insertRow(fake.app, record({ id: `r${i}`, rowOrder: i }));
    }

    const rows = await listRows(fake.app, 'user-1', 'db1');
    expect(rows).toHaveLength(305);
    expect(new Set(rows.map((r) => r.id)).size).toBe(305);
  });

  it('updates and deletes by row', async () => {
    const fake = fakeCatalyst();
    await insertDatabase(fake.app, db());
    const stored = (await getDatabase(fake.app, 'user-1', 'db1'))!;

    await updateDatabase(fake.app, stored.rowId, { ...db(), name: 'Books' });
    expect((await getDatabase(fake.app, 'user-1', 'db1'))?.name).toBe('Books');

    await deleteDatabase(fake.app, stored.rowId);
    expect(await getDatabase(fake.app, 'user-1', 'db1')).toBeNull();
  });

  it('deleting a database takes its records with it, and leaves other databases alone', async () => {
    const fake = fakeCatalyst();
    await insertRow(fake.app, record({ id: 'r1' }));
    await insertRow(fake.app, record({ id: 'r2' }));
    await insertRow(fake.app, record({ id: 'keep', databaseId: 'db2' }));

    expect(await deleteRowsOfDatabase(fake.app, 'user-1', 'db1')).toBe(2);
    expect(await listRows(fake.app, 'user-1', 'db1')).toHaveLength(0);
    expect((await listRows(fake.app, 'user-1', 'db2')).map((r) => r.id)).toEqual(['keep']);
  });

  it('hides a tombstoned database and record while their cleanup is retried', async () => {
    const fake = fakeCatalyst();
    await insertDatabase(fake.app, db());
    await insertRow(fake.app, record());
    const storedDb = (await getDatabase(fake.app, 'user-1', 'db1'))!;
    const storedRow = (await getRow(fake.app, 'user-1', 'r1'))!;

    await markDatabaseDeleting(fake.app, storedDb);
    await markRowDeleting(fake.app, storedRow);

    expect(await listDatabases(fake.app, 'user-1')).toEqual([]);
    expect(await listRows(fake.app, 'user-1', 'db1')).toEqual([]);
    expect(await getDatabase(fake.app, 'user-1', 'db1')).not.toBeNull();
    expect(await getRow(fake.app, 'user-1', 'r1')).not.toBeNull();
  });
});

describe("a database's calendar field (DateFieldId)", () => {
  it('round-trips once the column exists, and is left out before that', () => {
    const withDate = db({ dateFieldId: 'due-field' });

    setDatabaseDateFieldAvailable(false);
    expect(databaseToRow(withDate)['DateFieldId']).toBeUndefined();

    setDatabaseDateFieldAvailable(true);
    const row = databaseToRow(withDate);
    expect(row['DateFieldId']).toBe('due-field');
    expect(toDatabase({ ROWID: '1', ...row }).dateFieldId).toBe('due-field');
    setDatabaseDateFieldAvailable(false);
  });

  it('reads a database written before the column as having no calendar', () => {
    expect(toDatabase({ ROWID: '1', DatabaseId: 'db1', Name: 'Old' }).dateFieldId).toBe('');
  });
});
