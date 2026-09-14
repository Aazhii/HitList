/**
 * The bridge from a task write to the queue.
 *
 * Two things are worth testing here, and they pull in opposite directions.
 *
 * The first is that syncTaskReminder() is safe to call on every write. Editing
 * a title must not enqueue a second reminder; moving a due date must not leave
 * the old one armed. Both are silent failures in production — one sends twice,
 * the other sends at the wrong time — so both are asserted directly.
 *
 * The second is that it never throws. It runs inside the user's task save, and
 * a queue that is briefly unreachable must cost the reminder, not the save.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  syncTaskReminder,
  cancelTaskReminders,
  backfillReminders,
  resolveTimeZone,
  isKnownTimeZone,
  type ReminderContext,
} from '../../server/notifications/reminders.ts';
import { QueueStatus, findPendingForSource } from '../../server/notifications/queue.ts';
import type { SchedulableTask } from '../../server/notifications/schedule.ts';
import { fakeCatalyst, QUEUE_TABLE } from './helpers/fakeCatalyst.ts';

const ctx: ReminderContext = {
  ownerId: 'user-1',
  email: 'user@example.com',
  timeZone: 'Asia/Kolkata',
};

function task(overrides: Partial<SchedulableTask> = {}): SchedulableTask {
  return {
    id: 't1',
    title: 'Prepare the deck',
    status: 'TODO',
    dueDate: '2030-06-15',
    dueTime: '14:30',
    reminderEnabled: true,
    reminderMinutesBefore: 30,
    ...overrides,
  };
}

/** Pending rows for a task, which is what "armed" means. */
async function pending(app: Parameters<typeof findPendingForSource>[0], id = 't1') {
  return findPendingForSource(app, 'TASK', id);
}

describe('resolveTimeZone', () => {
  beforeEach(() => { vi.stubEnv('DEFAULT_TIMEZONE', ''); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('takes a valid zone from the request', () => {
    expect(resolveTimeZone('Asia/Kolkata')).toBe('Asia/Kolkata');
  });

  it('falls back to the configured default when the request has none', () => {
    vi.stubEnv('DEFAULT_TIMEZONE', 'Europe/Berlin');
    expect(resolveTimeZone(undefined)).toBe('Europe/Berlin');
  });

  it('rejects a bogus zone rather than letting Intl throw later', () => {
    // A header is client-supplied; an invalid one must not reach Intl inside
    // the scheduling maths, where it would throw mid-save.
    expect(resolveTimeZone('Mars/Olympus')).toBe('UTC');
    expect(isKnownTimeZone('Mars/Olympus')).toBe(false);
  });

  it('ignores a bogus configured default too', () => {
    vi.stubEnv('DEFAULT_TIMEZONE', 'Nowhere/Nothing');
    expect(resolveTimeZone('')).toBe('UTC');
  });
});

describe('syncTaskReminder', () => {
  it('queues a reminder for a task that wants one', async () => {
    const fake = fakeCatalyst();

    const result = await syncTaskReminder(fake.app, ctx, task());

    expect(result.enqueued).toBe(true);
    expect(fake.rows).toHaveLength(1);
    expect(fake.rows[0].SourceId).toBe('t1');
    expect(fake.rows[0].Status).toBe(QueueStatus.PENDING);
  });

  it('fires at the offset before the due time, in the user\'s zone', async () => {
    const fake = fakeCatalyst();

    await syncTaskReminder(fake.app, ctx, task());

    // 14:30 IST on 2030-06-15 is 09:00 UTC; 30 minutes before is 08:30 UTC.
    expect(new Date(Number(fake.rows[0].FireAt)).toISOString())
      .toBe('2030-06-15T08:30:00.000Z');
  });

  it('carries the delivery address, which the owner id is not', async () => {
    const fake = fakeCatalyst();

    await syncTaskReminder(fake.app, ctx, task());

    expect(JSON.parse(fake.rows[0].Payload).email).toBe('user@example.com');
  });

  it('does not queue a second reminder when only the title changes', async () => {
    // The case that makes this callable on every write: the DedupeKey is built
    // from when it fires, not from what it says.
    const fake = fakeCatalyst();

    await syncTaskReminder(fake.app, ctx, task());
    const second = await syncTaskReminder(fake.app, ctx, task({ title: 'Prepare the deck (v2)' }));

    expect(second.enqueued).toBe(false);
    expect(second.cancelled).toBe(0);
    expect(await pending(fake.app)).toHaveLength(1);
  });

  it('re-arms and withdraws the old one when the due date moves', async () => {
    const fake = fakeCatalyst();

    await syncTaskReminder(fake.app, ctx, task());
    const moved = await syncTaskReminder(fake.app, ctx, task({ dueDate: '2030-06-20' }));

    expect(moved.enqueued).toBe(true);
    expect(moved.cancelled).toBe(1);

    // Two rows exist, but only the new one is armed.
    expect(fake.rows).toHaveLength(2);
    const armed = await pending(fake.app);
    expect(armed).toHaveLength(1);
    expect(new Date(armed[0].fireAt).toISOString()).toBe('2030-06-20T08:30:00.000Z');
  });

  it('re-arms when only the offset changes', async () => {
    const fake = fakeCatalyst();

    await syncTaskReminder(fake.app, ctx, task());
    await syncTaskReminder(fake.app, ctx, task({ reminderMinutesBefore: 120 }));

    const armed = await pending(fake.app);
    expect(armed).toHaveLength(1);
    expect(new Date(armed[0].fireAt).toISOString()).toBe('2030-06-15T07:00:00.000Z');
  });

  it('withdraws the reminder when the task is completed', async () => {
    const fake = fakeCatalyst();
    await syncTaskReminder(fake.app, ctx, task());

    const done = await syncTaskReminder(fake.app, ctx, task({ status: 'DONE' }));

    expect(done.cancelled).toBe(1);
    expect(await pending(fake.app)).toHaveLength(0);
    expect(fake.rows[0].Status).toBe(QueueStatus.CANCELLED);
  });

  it('withdraws the reminder when it is switched off', async () => {
    const fake = fakeCatalyst();
    await syncTaskReminder(fake.app, ctx, task());

    await syncTaskReminder(fake.app, ctx, task({ reminderEnabled: false }));

    expect(await pending(fake.app)).toHaveLength(0);
  });

  it('withdraws the reminder when the due date is cleared', async () => {
    const fake = fakeCatalyst();
    await syncTaskReminder(fake.app, ctx, task());

    await syncTaskReminder(fake.app, ctx, task({ dueDate: undefined }));

    expect(await pending(fake.app)).toHaveLength(0);
  });

  it('queues nothing, and costs nothing, for a task with no reminder', async () => {
    const fake = fakeCatalyst();

    const result = await syncTaskReminder(fake.app, ctx, task({ reminderEnabled: false }));

    expect(result.enqueued).toBe(false);
    expect(fake.rows).toHaveLength(0);
  });

  it('still queues a reminder whose time has already passed', async () => {
    // Deliberate: the queue delivers late rather than dropping. A task created
    // with a due date an hour ago should still produce the notification.
    const fake = fakeCatalyst();

    const result = await syncTaskReminder(fake.app, ctx, task({ dueDate: '2020-01-01' }));

    expect(result.enqueued).toBe(true);
  });

  it('treats an unparseable due date as nothing to schedule', async () => {
    const fake = fakeCatalyst();

    const result = await syncTaskReminder(fake.app, ctx, task({ dueDate: '2030-02-31' }));

    expect(result.enqueued).toBe(false);
    expect(fake.rows).toHaveLength(0);
  });
});

describe('failure is the reminder\'s problem, not the save\'s', () => {
  it('reports a datastore failure instead of throwing', async () => {
    const fake = fakeCatalyst();
    // Spy on datastore() rather than on one table handle: the app hands back a
    // fresh handle per call, so a spy on the handle would not survive.
    vi.spyOn(fake.app, 'datastore').mockImplementation(() => {
      throw { code: 'SERVICE_UNAVAILABLE', message: 'datastore is down' };
    });

    const result = await syncTaskReminder(fake.app, ctx, task());

    expect(result.error).toContain('datastore is down');
    expect(result.enqueued).toBe(false);
  });

  it('reports a failed cancel instead of throwing', async () => {
    const fake = fakeCatalyst();
    vi.spyOn(fake.app, 'zcql').mockImplementation(() => {
      throw new Error('zcql unavailable');
    });

    const result = await cancelTaskReminders(fake.app, 't1');

    expect(result.error).toContain('zcql unavailable');
  });
});

describe('cancelTaskReminders', () => {
  it('withdraws everything pending for a deleted task', async () => {
    const fake = fakeCatalyst();
    await syncTaskReminder(fake.app, ctx, task());

    const result = await cancelTaskReminders(fake.app, 't1');

    expect(result.cancelled).toBe(1);
    expect(await pending(fake.app)).toHaveLength(0);
  });

  it('leaves other tasks alone', async () => {
    const fake = fakeCatalyst();
    await syncTaskReminder(fake.app, ctx, task({ id: 't1' }));
    await syncTaskReminder(fake.app, ctx, task({ id: 't2' }));

    await cancelTaskReminders(fake.app, 't1');

    expect(await pending(fake.app, 't2')).toHaveLength(1);
  });

  it('is quiet when there is nothing queued', async () => {
    const fake = fakeCatalyst();
    expect((await cancelTaskReminders(fake.app, 'never-seen')).cancelled).toBe(0);
  });
});

describe('backfillReminders', () => {
  it('queues reminders for tasks that predate the queue', async () => {
    const fake = fakeCatalyst();

    const out = await backfillReminders(fake.app, ctx, [
      task({ id: 'a' }),
      task({ id: 'b' }),
      task({ id: 'c', reminderEnabled: false }),
    ]);

    expect(out.scanned).toBe(3);
    expect(out.enqueued).toBe(2);
    expect(fake.rows).toHaveLength(2);
  });

  it('enqueues nothing on a second run', async () => {
    // The property that makes it safe to run as a self-heal rather than once.
    const fake = fakeCatalyst();
    const tasks = [task({ id: 'a' }), task({ id: 'b' })];

    await backfillReminders(fake.app, ctx, tasks);
    const again = await backfillReminders(fake.app, ctx, tasks);

    expect(again.enqueued).toBe(0);
    expect(fake.rows).toHaveLength(2);
  });

  it('finishes the batch when one task fails', async () => {
    const fake = fakeCatalyst();
    const realDatastore = fake.app.datastore.bind(fake.app);
    let calls = 0;
    vi.spyOn(fake.app, 'datastore').mockImplementation(() => {
      if (++calls === 1) throw new Error('transient');
      return realDatastore();
    });

    const out = await backfillReminders(fake.app, ctx, [task({ id: 'a' }), task({ id: 'b' })]);

    expect(out.failed).toBe(1);
    expect(out.enqueued).toBe(1);
  });
});
