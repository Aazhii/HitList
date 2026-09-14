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
import { fakeCatalyst, QUEUE_TABLE } from './helpers/fakeCatalyst.ts';
import { reclaimStale, CLAIM_TIMEOUT_MS } from '../../server/notifications/queue.ts';
import { zcqlRowId } from '../../server/notifications/zcql.ts';

const TABLE = QUEUE_TABLE;

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
  beforeEach(() => { fake = fakeCatalyst({ onlyTable: QUEUE_TABLE }); });

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
  beforeEach(() => { fake = fakeCatalyst({ onlyTable: QUEUE_TABLE }); });

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
  beforeEach(() => { fake = fakeCatalyst({ onlyTable: QUEUE_TABLE }); });

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
  beforeEach(() => { fake = fakeCatalyst({ onlyTable: QUEUE_TABLE }); });

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
  beforeEach(() => { fake = fakeCatalyst({ onlyTable: QUEUE_TABLE }); });

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
  beforeEach(() => { fake = fakeCatalyst({ onlyTable: QUEUE_TABLE }); });

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

describe('row ids are BigInt', () => {
  it('renders a row id without rounding it', () => {
    // Catalyst ids exceed Number.MAX_SAFE_INTEGER. Number('69251000000086009')
    // is 69251000000086010 — a different, usually non-existent row. Passing a
    // claim's verification through Number() made every claim fail against the
    // live project and stranded every swept row in SENDING.
    expect(zcqlRowId('69251000000086009')).toBe('69251000000086009');
    // Compared as a string: the numeric literal would itself be rounded by the
    // parser, so the two sides would agree for the wrong reason.
    expect(String(Number('69251000000086009'))).toBe('69251000000086010');
  });

  it('refuses anything that is not a row id rather than coercing it', () => {
    // A silent coercion is what caused the problem, so there is none here.
    expect(() => zcqlRowId("1 OR 1=1")).toThrow();
    expect(() => zcqlRowId('')).toThrow();
  });

  it('claims a row whose id is too large for a JS number', async () => {
    const fake = fakeCatalyst({ onlyTable: QUEUE_TABLE });
    await enqueue(fake.app, entry({ fireAt: Date.now() - 1000 }));
    const [row] = await findDue(fake.app, Date.now());

    // The regression: this returned false for every row against real Catalyst.
    expect(Number(row.rowId)).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
    expect(await claim(fake.app, row)).toBe(true);
  });
});

describe('reclaiming an abandoned claim', () => {
  async function claimed(fake: ReturnType<typeof fakeCatalyst>) {
    await enqueue(fake.app, entry({ fireAt: Date.now() - 1000 }));
    const [row] = await findDue(fake.app, Date.now());
    await claim(fake.app, row);
    return row;
  }

  it('returns a long-stranded row to the queue', async () => {
    // Without this a sweep that dies mid-delivery loses the notification
    // silently: findDue only selects PENDING, so nothing looks at it again.
    const fake = fakeCatalyst({ onlyTable: QUEUE_TABLE });
    await claimed(fake);
    const later = Date.now() + CLAIM_TIMEOUT_MS + 1000;

    expect(await reclaimStale(fake.app, later)).toBe(1);
    expect(fake.rows[0].Status).toBe(QueueStatus.PENDING);
    expect(await findDue(fake.app, later)).toHaveLength(1);
  });

  it('leaves a delivery still in progress alone', async () => {
    // A slow but live delivery must not have its row stolen underneath it.
    const fake = fakeCatalyst({ onlyTable: QUEUE_TABLE });
    await claimed(fake);

    expect(await reclaimStale(fake.app, Date.now() + 1000)).toBe(0);
    expect(fake.rows[0].Status).toBe(QueueStatus.SENDING);
  });

  it('records why the row came back', async () => {
    const fake = fakeCatalyst({ onlyTable: QUEUE_TABLE });
    await claimed(fake);

    await reclaimStale(fake.app, Date.now() + CLAIM_TIMEOUT_MS + 1000);

    expect(fake.rows[0].LastError).toContain('abandoned mid-delivery');
    expect(fake.rows[0].ClaimToken).toBe('');
  });

  it('does not hand a stranded row unlimited second chances', async () => {
    // The attempt was already counted at claim time, so a row that strands on
    // every attempt must still run out rather than cycling forever.
    const fake = fakeCatalyst({ onlyTable: QUEUE_TABLE });
    await enqueue(fake.app, entry({ fireAt: Date.now() - 1000 }));

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const [row] = await findDue(fake.app, Date.now());
      await claim(fake.app, row);
      await reclaimStale(fake.app, Date.now() + CLAIM_TIMEOUT_MS + 1000);
    }

    expect(fake.rows[0].Status).toBe(QueueStatus.FAILED);
  });

  it('does nothing when nothing is stranded', async () => {
    const fake = fakeCatalyst({ onlyTable: QUEUE_TABLE });
    expect(await reclaimStale(fake.app, Date.now())).toBe(0);
  });
});
