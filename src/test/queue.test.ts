/**
 * The notification outbox.
 *
 * The properties worth testing here are the ones that make delivery safe rather
 * than merely working, because AppSail auto-scales to 1–5 instances and a
 * message sent twice cannot be recalled:
 *
 *   - the same logical delivery cannot be enqueued twice (DedupeKey)
 *   - two sweeps racing the same row deliver it once (the PENDING → SENDING claim)
 *   - a sweep that missed its slot still delivers (FireAt <= now)
 *
 * Run against a fake Catalyst app that enforces the unique constraint the real
 * table does, so the behaviour under test is the queue's own logic.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  enqueue,
  findDue,
  findPendingForSource,
  claim,
  markSent,
  markFailed,
  cancelPendingFor,
  cancelSupersededFor,
  purgeOldEntries,
  QueueStatus,
  MAX_ATTEMPTS,
  RETENTION_MS,
  type QueueEntry,
} from '../../server/notifications/queue.ts';
import type { CatalystApp } from '../../server/notifications/types.ts';

const TABLE = 'KaizenNotificationQueue';

/**
 * An in-memory stand-in for Catalyst that enforces what the real table
 * enforces: a unique DedupeKey, and ZCQL's row-wrapped result shape.
 */
function fakeCatalyst() {
  const rows: Array<Record<string, string>> = [];
  let nextRowId = 1000;

  const app: CatalystApp = {
    datastore: () => ({
      table: (name: string) => {
        expect(name).toBe(TABLE);
        return {
          insertRow: async (row) => {
            const key = String(row.DedupeKey ?? '');
            if (rows.some((r) => r.DedupeKey === key)) {
              // What Catalyst answers for a unique-constraint violation.
              throw { code: 'DUPLICATE_VALUE', message: 'duplicate value for DedupeKey' };
            }
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

    // Enough ZCQL to serve the queries the queue actually issues.
    zcql: () => ({
      executeZCQLQuery: async (query: string) => {
        const eq = (col: string): string | null => {
          const m = query.match(new RegExp(`${col} = '([^']*)'`));
          return m ? m[1] : null;
        };
        const lte = (col: string): number | null => {
          const m = query.match(new RegExp(`${col} <= (\\d+)`));
          return m ? Number(m[1]) : null;
        };
        const lt = (col: string): number | null => {
          const m = query.match(new RegExp(`${col} < (\\d+)`));
          return m ? Number(m[1]) : null;
        };
        const limit = Number(query.match(/LIMIT (\d+)/)?.[1] ?? Infinity);

        let out = rows.slice();
        const rowId = query.match(/ROWID = (\d+)/)?.[1];
        if (rowId) out = out.filter((r) => r.ROWID === rowId);
        const status = eq('Status');
        if (status) out = out.filter((r) => r.Status === status);
        const sourceType = eq('SourceType');
        if (sourceType) out = out.filter((r) => r.SourceType === sourceType);
        const sourceId = eq('SourceId');
        if (sourceId) out = out.filter((r) => r.SourceId === sourceId);
        const fireAt = lte('FireAt');
        if (fireAt !== null) out = out.filter((r) => Number(r.FireAt) <= fireAt);
        const sentBefore = lt('SentAt');
        if (sentBefore !== null) out = out.filter((r) => Number(r.SentAt) < sentBefore);
        if (/SentAt > 0/.test(query)) out = out.filter((r) => Number(r.SentAt) > 0);

        if (/ORDER BY FireAt ASC/.test(query)) {
          out.sort((a, b) => Number(a.FireAt) - Number(b.FireAt));
        }
        return out.slice(0, limit).map((r) => ({ [TABLE]: { ...r } }));
      },
    }),

    email: () => ({ sendMail: async () => true }),
    pushNotification: () => ({ web: () => ({ sendNotification: async () => true }) }),
  };

  return { app, rows };
}

function entry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    ownerId: 'user-1',
    fireAt: Date.now() + 60_000,
    dedupeKey: 'task:t1:due:1000:off:30',
    kind: 'TASK_REMINDER',
    sourceType: 'TASK',
    sourceId: 't1',
    channels: ['email', 'inapp'],
    title: 'Prepare the deck',
    body: 'Due in 30 minutes.',
    ...overrides,
  };
}

describe('enqueue', () => {
  let fake: ReturnType<typeof fakeCatalyst>;
  beforeEach(() => { fake = fakeCatalyst(); });

  it('stores an entry as PENDING', async () => {
    expect(await enqueue(fake.app, entry())).toBe(true);
    expect(fake.rows).toHaveLength(1);
    expect(fake.rows[0].Status).toBe(QueueStatus.PENDING);
  });

  it('refuses a duplicate dedupe key, without throwing', async () => {
    expect(await enqueue(fake.app, entry())).toBe(true);
    expect(await enqueue(fake.app, entry())).toBe(false);
    expect(fake.rows).toHaveLength(1);
  });

  it('survives concurrent enqueues of the same key', async () => {
    // Several AppSail instances can save the same task at once. The unique
    // constraint is the only check that cannot be interleaved.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => enqueue(fake.app, entry())),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(fake.rows).toHaveLength(1);
  });

  it('allows different keys for the same task', async () => {
    await enqueue(fake.app, entry({ dedupeKey: 'task:t1:due:1000:off:30' }));
    await enqueue(fake.app, entry({ dedupeKey: 'task:t1:due:2000:off:30' }));
    expect(fake.rows).toHaveLength(2);
  });

  it('truncates an over-long title to the column limit', async () => {
    await enqueue(fake.app, entry({ title: 'x'.repeat(400) }));
    expect(fake.rows[0].Title.length).toBe(255);
  });

  it('serialises the payload, and tolerates none', async () => {
    await enqueue(fake.app, entry({ payload: { taskId: 't1' } }));
    expect(JSON.parse(fake.rows[0].Payload)).toEqual({ taskId: 't1' });

    await enqueue(fake.app, entry({ dedupeKey: 'other', payload: undefined }));
    expect(fake.rows[1].Payload).toBe('');
  });
});

describe('findDue', () => {
  let fake: ReturnType<typeof fakeCatalyst>;
  beforeEach(() => { fake = fakeCatalyst(); });

  it('returns nothing when nothing is due', async () => {
    await enqueue(fake.app, entry({ fireAt: Date.now() + 3_600_000 }));
    expect(await findDue(fake.app, Date.now())).toHaveLength(0);
  });

  it('returns entries whose time has arrived', async () => {
    await enqueue(fake.app, entry({ fireAt: Date.now() - 1000 }));
    expect(await findDue(fake.app, Date.now())).toHaveLength(1);
  });

  it('returns entries a missed sweep left behind', async () => {
    // The self-healing property: an outage delays delivery, it does not drop
    // it. This is why the query is FireAt <= now rather than == now.
    await enqueue(fake.app, entry({ fireAt: Date.now() - 7 * 24 * 3_600_000 }));
    expect(await findDue(fake.app, Date.now())).toHaveLength(1);
  });

  it('ignores entries that are not PENDING', async () => {
    await enqueue(fake.app, entry({ fireAt: Date.now() - 1000 }));
    const [row] = await findDue(fake.app, Date.now());
    await markSent(fake.app, row);
    expect(await findDue(fake.app, Date.now())).toHaveLength(0);
  });

  it('returns the most overdue first', async () => {
    const now = Date.now();
    await enqueue(fake.app, entry({ dedupeKey: 'b', fireAt: now - 1000 }));
    await enqueue(fake.app, entry({ dedupeKey: 'a', fireAt: now - 9000 }));
    const due = await findDue(fake.app, now);
    expect(due.map((r) => r.dedupeKey)).toEqual(['a', 'b']);
  });

  it('honours the sweep limit so a tick cannot run long', async () => {
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      await enqueue(fake.app, entry({ dedupeKey: `k${i}`, fireAt: now - 1000 }));
    }
    expect(await findDue(fake.app, now, 3)).toHaveLength(3);
  });

  it('round-trips every field', async () => {
    await enqueue(fake.app, entry({
      fireAt: 1234, channels: ['email', 'webpush'], payload: { a: 1 },
    }));
    const [row] = await findDue(fake.app, 9999);
    expect(row.ownerId).toBe('user-1');
    expect(row.fireAt).toBe(1234);
    expect(row.channels).toEqual(['email', 'webpush']);
    expect(row.payload).toEqual({ a: 1 });
    expect(row.title).toBe('Prepare the deck');
  });
});

describe('claiming — the exactly-once property', () => {
  let fake: ReturnType<typeof fakeCatalyst>;
  beforeEach(() => { fake = fakeCatalyst(); });

  it('removes the row from the due set once claimed', async () => {
    await enqueue(fake.app, entry({ fireAt: Date.now() - 1000 }));
    const [row] = await findDue(fake.app, Date.now());

    await claim(fake.app, row);

    // A second sweep — on another instance, or a retried tick — finds nothing.
    expect(await findDue(fake.app, Date.now())).toHaveLength(0);
  });

  it('gives one winner when two sweeps race the same row', async () => {
    await enqueue(fake.app, entry({ fireAt: Date.now() - 1000 }));

    const [a] = await findDue(fake.app, Date.now());
    const [b] = await findDue(fake.app, Date.now());
    expect(a.rowId).toBe(b.rowId);

    await claim(fake.app, a);
    await claim(fake.app, b);

    // Both claims land, but the row is SENDING once and is delivered once —
    // it left the PENDING set on the first claim.
    expect(fake.rows[0].Status).toBe(QueueStatus.SENDING);
    expect(await findDue(fake.app, Date.now())).toHaveLength(0);
  });

  it('counts attempts so retries are bounded', async () => {
    await enqueue(fake.app, entry({ fireAt: Date.now() - 1000 }));
    const [row] = await findDue(fake.app, Date.now());
    await claim(fake.app, row);
    expect(Number(fake.rows[0].AttemptCount)).toBe(1);
  });
});

describe('failure handling', () => {
  let fake: ReturnType<typeof fakeCatalyst>;
  beforeEach(() => { fake = fakeCatalyst(); });

  it('returns a row to PENDING while attempts remain', async () => {
    await enqueue(fake.app, entry({ fireAt: Date.now() - 1000 }));
    const [row] = await findDue(fake.app, Date.now());
    await markFailed(fake.app, row, new Error('smtp down'));

    expect(fake.rows[0].Status).toBe(QueueStatus.PENDING);
    expect(fake.rows[0].LastError).toContain('smtp down');
    expect(await findDue(fake.app, Date.now())).toHaveLength(1);
  });

  it('gives up once the retry budget is spent', async () => {
    // A misconfigured channel would otherwise be retried on every tick forever.
    await enqueue(fake.app, entry({ fireAt: Date.now() - 1000 }));
    const [row] = await findDue(fake.app, Date.now());

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await markFailed(fake.app, { ...row, attemptCount: i }, new Error('nope'));
    }

    expect(fake.rows[0].Status).toBe(QueueStatus.FAILED);
    expect(await findDue(fake.app, Date.now())).toHaveLength(0);
  });

  it('renders an SDK-style thrown object rather than [object Object]', async () => {
    await enqueue(fake.app, entry({ fireAt: Date.now() - 1000 }));
    const [row] = await findDue(fake.app, Date.now());
    await markFailed(fake.app, row, { statusCode: 400, message: 'bad sender' });

    expect(fake.rows[0].LastError).toContain('bad sender');
    expect(fake.rows[0].LastError).not.toContain('[object Object]');
  });
});

describe('cancellation', () => {
  let fake: ReturnType<typeof fakeCatalyst>;
  beforeEach(() => { fake = fakeCatalyst(); });

  it('cancels everything pending for a task', async () => {
    await enqueue(fake.app, entry({ dedupeKey: 'a' }));
    await enqueue(fake.app, entry({ dedupeKey: 'b' }));

    expect(await cancelPendingFor(fake.app, 'TASK', 't1')).toBe(2);
    expect(await findPendingForSource(fake.app, 'TASK', 't1')).toHaveLength(0);
    expect(fake.rows.every((r) => r.Status === QueueStatus.CANCELLED)).toBe(true);
  });

  it('leaves other tasks alone', async () => {
    await enqueue(fake.app, entry({ dedupeKey: 'a', sourceId: 't1' }));
    await enqueue(fake.app, entry({ dedupeKey: 'b', sourceId: 't2' }));

    await cancelPendingFor(fake.app, 'TASK', 't1');
    expect(await findPendingForSource(fake.app, 'TASK', 't2')).toHaveLength(1);
  });

  it('cancels superseded entries but keeps the current one', async () => {
    // The re-scheduling case: a due date moved, so the old row must not fire.
    await enqueue(fake.app, entry({ dedupeKey: 'old' }));
    await enqueue(fake.app, entry({ dedupeKey: 'new' }));

    expect(await cancelSupersededFor(fake.app, 'TASK', 't1', 'new')).toBe(1);

    const pending = await findPendingForSource(fake.app, 'TASK', 't1');
    expect(pending.map((r) => r.dedupeKey)).toEqual(['new']);
  });

  it('is a no-op when nothing was superseded', async () => {
    // Safe to call on every task write, including saves that changed nothing.
    await enqueue(fake.app, entry({ dedupeKey: 'current' }));
    expect(await cancelSupersededFor(fake.app, 'TASK', 't1', 'current')).toBe(0);
    expect(await findPendingForSource(fake.app, 'TASK', 't1')).toHaveLength(1);
  });

  it('keeps cancelled rows rather than deleting them', async () => {
    // History makes it possible to see why an expected reminder never arrived.
    await enqueue(fake.app, entry());
    await cancelPendingFor(fake.app, 'TASK', 't1');
    expect(fake.rows).toHaveLength(1);
  });
});

describe('retention', () => {
  let fake: ReturnType<typeof fakeCatalyst>;
  beforeEach(() => { fake = fakeCatalyst(); });

  it('clears delivered entries past the window', async () => {
    const now = Date.now();
    await enqueue(fake.app, entry({ fireAt: now - 1000 }));
    const [row] = await findDue(fake.app, now);
    await markSent(fake.app, row);
    fake.rows[0].SentAt = String(now - RETENTION_MS - 1000);

    expect(await purgeOldEntries(fake.app, now)).toBe(1);
    expect(fake.rows).toHaveLength(0);
  });

  it('keeps recent and undelivered entries', async () => {
    const now = Date.now();
    await enqueue(fake.app, entry({ dedupeKey: 'recent', fireAt: now - 1000 }));
    const [row] = await findDue(fake.app, now);
    await markSent(fake.app, row);

    await enqueue(fake.app, entry({ dedupeKey: 'pending', fireAt: now + 60_000 }));

    expect(await purgeOldEntries(fake.app, now)).toBe(0);
    expect(fake.rows).toHaveLength(2);
  });
});
