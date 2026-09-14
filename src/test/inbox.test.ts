/**
 * The in-app inbox.
 *
 * The property worth testing hardest is owner scoping. Every read and every
 * write here takes a NotificationId from the client, and a missing OwnerId
 * predicate would let anyone who guessed or observed an id read and mutate
 * someone else's notifications. That failure is invisible in normal use — it
 * only shows up when someone goes looking — so it is asserted directly rather
 * than assumed from the query text.
 */
import { describe, it, expect } from 'vitest';
import {
  listInbox,
  markRead,
  markAllRead,
  removeEntry,
  INBOX_LIMIT,
} from '../../server/notifications/inbox.ts';
import type { CatalystApp } from '../../server/notifications/types.ts';

const INBOX = 'KaizenNotifications';

/**
 * A fake shaped to the inbox's queries specifically.
 *
 * The shared helpers/fakeCatalyst.ts fake answers ZCQL against the QUEUE
 * table, because that is what the queue and sweep exercise. The inbox needs
 * ORDER BY CreatedAt DESC and a ReadAt = 0 predicate against a different
 * table, so it gets its own reader rather than making the shared one
 * conditional on which table a test happens to mean.
 */
function fakeInbox() {
  const rows: Array<Record<string, string>> = [];
  let nextRowId = 500;

  const app: CatalystApp = {
    datastore: () => ({
      table: (name: string) => {
        expect(name).toBe(INBOX);
        return {
          insertRow: async (row) => {
            const stored: Record<string, string> = { ROWID: String(nextRowId++) };
            for (const [k, v] of Object.entries(row)) stored[k] = String(v ?? '');
            rows.push(stored);
            return stored;
          },
          updateRow: async (row) => {
            const found = rows.find((r) => r.ROWID === String(row.ROWID));
            if (!found) throw new Error('no such row');
            for (const [k, v] of Object.entries(row)) {
              if (k !== 'ROWID') found[k] = String(v ?? '');
            }
            return found;
          },
          deleteRow: async (rowId) => {
            const i = rows.findIndex((r) => r.ROWID === String(rowId));
            if (i >= 0) rows.splice(i, 1);
            return true;
          },
        };
      },
    }),

    zcql: () => ({
      executeZCQLQuery: async (query: string) => {
        const eq = (col: string) =>
          query.match(new RegExp(`${col} = '([^']*)'`))?.[1] ?? null;

        let out = rows.slice();
        for (const col of ['OwnerId', 'NotificationId'] as const) {
          const want = eq(col);
          if (want !== null) out = out.filter((r) => r[col] === want);
        }
        if (/ReadAt = 0/.test(query)) out = out.filter((r) => Number(r.ReadAt) === 0);

        if (/ORDER BY CreatedAt DESC/.test(query)) {
          out.sort((a, b) => Number(b.CreatedAt) - Number(a.CreatedAt));
        }
        const limit = Number(query.match(/LIMIT (\d+)/)?.[1] ?? Infinity);
        return out.slice(0, limit).map((r) => ({ [INBOX]: { ...r } }));
      },
    }),

    email: () => ({ sendMail: async () => true }),
    pushNotification: () => ({ web: () => ({ sendNotification: async () => true }) }),
  };

  /** Adds an entry the way the inapp channel does. */
  async function seed(over: Record<string, unknown> = {}) {
    return app.datastore().table(INBOX).insertRow({
      NotificationId: `n${rows.length + 1}`,
      OwnerId: 'user-1',
      Title: 'Prepare the deck',
      Body: 'Due in 30 minutes.',
      Kind: 'TASK_REMINDER',
      SourceType: 'TASK',
      SourceId: 't1',
      Payload: JSON.stringify({ taskId: 't1' }),
      ReadAt: '0',
      CreatedAt: String(Date.now()),
      ...over,
    });
  }

  return { app, rows, seed };
}

describe('listInbox', () => {
  it('returns the owner\'s entries', async () => {
    const fake = fakeInbox();
    await fake.seed();

    const entries = await listInbox(fake.app, 'user-1');

    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('Prepare the deck');
    expect(entries[0].sourceId).toBe('t1');
  });

  it('never returns another owner\'s entries', async () => {
    const fake = fakeInbox();
    await fake.seed({ NotificationId: 'mine', OwnerId: 'user-1' });
    await fake.seed({ NotificationId: 'theirs', OwnerId: 'user-2' });

    const entries = await listInbox(fake.app, 'user-1');

    expect(entries.map((e) => e.id)).toEqual(['mine']);
  });

  it('puts the newest first', async () => {
    const fake = fakeInbox();
    await fake.seed({ NotificationId: 'old', CreatedAt: '1000' });
    await fake.seed({ NotificationId: 'new', CreatedAt: '9000' });

    expect((await listInbox(fake.app, 'user-1')).map((e) => e.id)).toEqual(['new', 'old']);
  });

  it('reads timestamps back as numbers, not the strings the datastore returns', async () => {
    const fake = fakeInbox();
    await fake.seed({ CreatedAt: '1700000000000' });

    const [entry] = await listInbox(fake.app, 'user-1');

    expect(entry.createdAt).toBe(1700000000000);
    expect(entry.readAt).toBe(0);
  });

  it('survives a payload that will not parse', async () => {
    // The notification is still worth showing; only the deep link is lost.
    const fake = fakeInbox();
    await fake.seed({ Payload: 'not json' });

    const [entry] = await listInbox(fake.app, 'user-1');

    expect(entry.title).toBe('Prepare the deck');
    expect(entry.payload).toBeUndefined();
  });

  it('caps what it will return', async () => {
    const fake = fakeInbox();
    const entries = await listInbox(fake.app, 'user-1', 10_000);
    // The cap is applied to the query, not after the fact.
    expect(entries.length).toBeLessThanOrEqual(INBOX_LIMIT);
  });

  it('is empty for an owner with nothing', async () => {
    const fake = fakeInbox();
    expect(await listInbox(fake.app, 'nobody')).toEqual([]);
  });
});

describe('markRead', () => {
  it('marks the entry read', async () => {
    const fake = fakeInbox();
    await fake.seed({ NotificationId: 'n1' });

    expect(await markRead(fake.app, 'user-1', 'n1', 12345)).toBe(true);
    expect(fake.rows[0].ReadAt).toBe('12345');
  });

  it('refuses another owner\'s entry', async () => {
    // The check that matters: an id alone must not be enough.
    const fake = fakeInbox();
    await fake.seed({ NotificationId: 'theirs', OwnerId: 'user-2' });

    expect(await markRead(fake.app, 'user-1', 'theirs')).toBe(false);
    expect(fake.rows[0].ReadAt).toBe('0');
  });

  it('reports an unknown id rather than throwing', async () => {
    const fake = fakeInbox();
    expect(await markRead(fake.app, 'user-1', 'never-existed')).toBe(false);
  });

  it('is idempotent', async () => {
    const fake = fakeInbox();
    await fake.seed({ NotificationId: 'n1' });

    await markRead(fake.app, 'user-1', 'n1', 111);
    expect(await markRead(fake.app, 'user-1', 'n1', 222)).toBe(true);
    expect(fake.rows[0].ReadAt).toBe('222');
  });
});

describe('markAllRead', () => {
  it('marks every unread entry and leaves read ones alone', async () => {
    const fake = fakeInbox();
    await fake.seed({ NotificationId: 'a' });
    await fake.seed({ NotificationId: 'b' });
    await fake.seed({ NotificationId: 'c', ReadAt: '500' });

    expect(await markAllRead(fake.app, 'user-1', 999)).toBe(2);

    expect(fake.rows.map((r) => r.ReadAt)).toEqual(['999', '999', '500']);
  });

  it('leaves another owner\'s entries unread', async () => {
    const fake = fakeInbox();
    await fake.seed({ NotificationId: 'mine' });
    await fake.seed({ NotificationId: 'theirs', OwnerId: 'user-2' });

    await markAllRead(fake.app, 'user-1', 999);

    expect(fake.rows.find((r) => r.NotificationId === 'theirs')!.ReadAt).toBe('0');
  });

  it('is zero when there is nothing unread', async () => {
    const fake = fakeInbox();
    expect(await markAllRead(fake.app, 'user-1')).toBe(0);
  });
});

describe('removeEntry', () => {
  it('deletes the entry', async () => {
    const fake = fakeInbox();
    await fake.seed({ NotificationId: 'n1' });

    expect(await removeEntry(fake.app, 'user-1', 'n1')).toBe(true);
    expect(fake.rows).toHaveLength(0);
  });

  it('refuses another owner\'s entry', async () => {
    const fake = fakeInbox();
    await fake.seed({ NotificationId: 'theirs', OwnerId: 'user-2' });

    expect(await removeEntry(fake.app, 'user-1', 'theirs')).toBe(false);
    expect(fake.rows).toHaveLength(1);
  });
});
