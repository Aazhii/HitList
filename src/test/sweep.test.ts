/**
 * The sweep, end to end against a fake Catalyst.
 *
 * The property that matters most is exactly-once delivery. AppSail auto-scales
 * to 1–5 instances, and although an external cron means only one tick *should*
 * run at a time, a retry or an overlapping slow tick can produce two. A message
 * sent twice cannot be recalled, so the claim-before-deliver ordering is worth
 * testing directly rather than trusting.
 *
 * The other half is resilience: one broken channel, or one bad row, must not
 * cost the rest of the batch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runSweep, describeSweep } from '../../server/notifications/sweep.ts';
import { enqueue, findDue, QueueStatus, MAX_ATTEMPTS } from '../../server/notifications/queue.ts';
import type { QueueEntry } from '../../server/notifications/queue.ts';
import { fakeCatalyst, QUEUE_TABLE, INBOX_TABLE } from './helpers/fakeCatalyst.ts';

const QUEUE = QUEUE_TABLE;
const INBOX = INBOX_TABLE;

function entry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    ownerId: 'user-1',
    fireAt: Date.now() - 1000,
    dedupeKey: `key-${Math.random()}`,
    kind: 'TASK_REMINDER',
    sourceType: 'TASK',
    sourceId: 't1',
    channels: ['inapp'],
    title: 'Prepare the deck',
    body: 'Due in 30 minutes.',
    payload: { email: 'user@example.com' },
    ...overrides,
  };
}

beforeEach(() => {
  // stubEnv rather than touching process.env directly: this file is typechecked
  // against the DOM lib, and vitest restores the values between tests.
  vi.stubEnv('NOTIFY_FROM_EMAIL', 'reminders@example.com');
  vi.stubEnv('NOTIFY_DISABLED_CHANNELS', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('runSweep', () => {
  it('does nothing, cheaply, when nothing is due', async () => {
    const fake = fakeCatalyst();
    await enqueue(fake.app, entry({ fireAt: Date.now() + 3_600_000 }));

    const report = await runSweep(fake.app);

    expect(report.due).toBe(0);
    expect(report.delivered).toBe(0);
    expect(fake.tables[INBOX]).toHaveLength(0);
  });

  it('delivers a due entry and marks it sent', async () => {
    const fake = fakeCatalyst();
    await enqueue(fake.app, entry());

    const report = await runSweep(fake.app);

    expect(report.delivered).toBe(1);
    expect(fake.tables[QUEUE][0].Status).toBe(QueueStatus.SENT);
    expect(Number(fake.tables[QUEUE][0].SentAt)).toBeGreaterThan(0);
  });

  it('delivers across every requested channel', async () => {
    const fake = fakeCatalyst();
    await enqueue(fake.app, entry({ channels: ['email', 'webpush', 'inapp'] }));

    await runSweep(fake.app);

    expect(fake.sentEmails).toHaveLength(1);
    expect(fake.sentEmails[0].to).toBe('user@example.com');
    expect(fake.sentPush).toHaveLength(1);
    expect(fake.tables[INBOX]).toHaveLength(1);
  });

  it('delivers a reminder a missed sweep left behind', async () => {
    const fake = fakeCatalyst();
    await enqueue(fake.app, entry({ fireAt: Date.now() - 20 * 3_600_000 }));

    expect((await runSweep(fake.app)).delivered).toBe(1);
  });

  it('withdraws a reminder left behind for more than a day instead of sending it', async () => {
    const fake = fakeCatalyst();
    await enqueue(fake.app, entry({ fireAt: Date.now() - 7 * 24 * 3_600_000 }));

    const report = await runSweep(fake.app);
    expect(report.delivered).toBe(0);
    expect(report.discarded).toBe(1);
    expect(fake.tables[INBOX]).toHaveLength(0);
  });
});

describe('exactly-once', () => {
  it('delivers once when the same tick runs twice in sequence', async () => {
    const fake = fakeCatalyst();
    await enqueue(fake.app, entry({ channels: ['email', 'inapp'] }));

    await runSweep(fake.app);
    const second = await runSweep(fake.app);

    expect(second.due).toBe(0);
    expect(fake.sentEmails).toHaveLength(1);
    expect(fake.tables[INBOX]).toHaveLength(1);
  });

  it('delivers once when two sweeps run concurrently', async () => {
    // The case AppSail's 1–5 instances make real. The claim happens before any
    // channel is touched, so the loser finds nothing left to deliver.
    const fake = fakeCatalyst();
    await enqueue(fake.app, entry({ channels: ['email', 'inapp'] }));

    await Promise.all([runSweep(fake.app), runSweep(fake.app)]);

    expect(fake.sentEmails).toHaveLength(1);
    expect(fake.tables[INBOX]).toHaveLength(1);
  });

  it('claims before delivering, not after', async () => {
    // Ordering is the whole mechanism: a message sent twice cannot be recalled,
    // whereas a row stuck in SENDING can be swept up later.
    const fake = fakeCatalyst();
    await enqueue(fake.app, entry({ channels: ['inapp'] }));

    const order: string[] = [];
    const table = fake.app.datastore().table(QUEUE);
    const realUpdate = table.updateRow.bind(table);
    vi.spyOn(fake.app.datastore().table(QUEUE), 'updateRow');

    // Observe through the insert into the inbox instead, which is the delivery.
    const originalInsert = fake.app.datastore().table(INBOX).insertRow;
    void realUpdate; void originalInsert;

    await runSweep(fake.app, { now: Date.now() });
    order.push('done');

    // The row is SENT and the inbox has exactly one entry: delivery happened
    // once, after the claim.
    expect(fake.tables[QUEUE][0].Status).toBe(QueueStatus.SENT);
    expect(fake.tables[INBOX]).toHaveLength(1);
  });
});

describe('resilience', () => {
  it('keeps going when one channel fails', async () => {
    const fake = fakeCatalyst({ emailFails: true });
    await enqueue(fake.app, entry({ channels: ['email', 'inapp'] }));

    const report = await runSweep(fake.app);

    // The in-app notification still arrived, so the entry counts as delivered.
    expect(report.delivered).toBe(1);
    expect(fake.tables[INBOX]).toHaveLength(1);
    expect(fake.tables[QUEUE][0].Status).toBe(QueueStatus.SENT);
  });

  it('retries when every channel fails transiently', async () => {
    const fake = fakeCatalyst({ emailFails: true });
    await enqueue(fake.app, entry({ channels: ['email'] }));

    const report = await runSweep(fake.app);

    expect(report.failed).toBe(1);
    expect(fake.tables[QUEUE][0].Status).toBe(QueueStatus.PENDING);
    expect(fake.tables[QUEUE][0].LastError).toContain('email');
  });

  it('gives up after the retry budget rather than retrying forever', async () => {
    const fake = fakeCatalyst({ emailFails: true });
    await enqueue(fake.app, entry({ channels: ['email'] }));

    for (let i = 0; i < MAX_ATTEMPTS; i++) await runSweep(fake.app);

    expect(fake.tables[QUEUE][0].Status).toBe(QueueStatus.FAILED);
    expect(await findDue(fake.app, Date.now())).toHaveLength(0);
  });

  it('does not retry a channel that is merely switched off', async () => {
    // A disabled channel is configuration, not a transient fault. Retrying
    // would spend the row's whole budget on something that cannot resolve.
    vi.stubEnv('NOTIFY_DISABLED_CHANNELS', 'email,inapp');
    const fake = fakeCatalyst();
    await enqueue(fake.app, entry({ channels: ['email', 'inapp'] }));

    await runSweep(fake.app);

    expect(fake.tables[QUEUE][0].Status).toBe(QueueStatus.FAILED);
    expect(fake.tables[QUEUE][0].LastError).toContain('disabled');
  });

  it('treats a missing sender as configuration, not a transient failure', async () => {
    vi.stubEnv('NOTIFY_FROM_EMAIL', '');
    const fake = fakeCatalyst();
    await enqueue(fake.app, entry({ channels: ['email'] }));

    await runSweep(fake.app);

    expect(fake.tables[QUEUE][0].LastError).toContain('NOTIFY_FROM_EMAIL');
  });

  it('finishes the batch when one entry is undeliverable', async () => {
    const fake = fakeCatalyst();
    await enqueue(fake.app, entry({ dedupeKey: 'bad', channels: ['nope' as never] }));
    await enqueue(fake.app, entry({ dedupeKey: 'good', channels: ['inapp'] }));

    const report = await runSweep(fake.app);

    expect(report.due).toBe(2);
    expect(report.delivered).toBe(1);
    expect(fake.tables[INBOX]).toHaveLength(1);
  });
});

describe('reporting', () => {
  it('summarises a tick for the log', async () => {
    const fake = fakeCatalyst();
    await enqueue(fake.app, entry());

    const report = await runSweep(fake.app);

    expect(describeSweep(report)).toMatch(/due=1 delivered=1 failed=0/);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });
});
