/**
 * Trial features — the app-wide switches in KaizenTrialFeatures — and what the
 * sweep does under them.
 *
 * The switches exist to stop work, so the failure worth guarding against is the
 * opposite one: a missing row, a typo, or an unreadable table silently turning
 * everyone's reminders off. Each of those must read as ON.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  readTrialFeatures,
  createTrialFeatureCache,
  parseEnabled,
  sweepOptionsFor,
  ALL_ENABLED,
} from '../../server/trialFeatures.ts';
import { TRIAL_FEATURES_TABLE } from '../../server/catalyst/schema.ts';
import { runSweep } from '../../server/notifications/sweep.ts';
import { startScheduler } from '../../server/notifications/scheduler.ts';
import { enqueue, QueueStatus, STALE_AFTER_MS, type QueueEntry } from '../../server/notifications/queue.ts';
import type { CatalystApp } from '../../server/notifications/types.ts';
import { fakeCatalyst, QUEUE_TABLE, INBOX_TABLE } from './helpers/fakeCatalyst.ts';

function flagRows(values: Record<string, string>) {
  return Object.entries(values).map(([FeatureKey, Enabled], i) => ({
    ROWID: String(69251000000090001n + BigInt(i)), FeatureKey, Enabled,
  }));
}

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
  vi.stubEnv('NOTIFY_FROM_EMAIL', 'reminders@example.com');
  vi.stubEnv('NOTIFY_DISABLED_CHANNELS', '');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('parseEnabled', () => {
  it('reads true and false in any case, and nothing else', () => {
    expect(parseEnabled('true')).toBe(true);
    expect(parseEnabled(' FALSE ')).toBe(false);
    expect(parseEnabled(false)).toBe(false);
    expect(parseEnabled('no')).toBeNull();
    expect(parseEnabled('')).toBeNull();
    expect(parseEnabled(null)).toBeNull();
  });
});

describe('readTrialFeatures', () => {
  it('counts an empty table as everything on', async () => {
    const fake = fakeCatalyst();
    expect(await readTrialFeatures(fake.app)).toEqual(ALL_ENABLED);
  });

  it('turns off exactly the features whose row says false', async () => {
    const fake = fakeCatalyst();
    fake.tables[TRIAL_FEATURES_TABLE] = flagRows({ notifications: 'false', automations: 'true' });
    expect(await readTrialFeatures(fake.app)).toEqual({ notifications: false, automations: true });
  });

  it('treats a value that is not true/false as on, and ignores unknown keys', async () => {
    const fake = fakeCatalyst();
    fake.tables[TRIAL_FEATURES_TABLE] = flagRows({ notifications: 'no', automations: 'False', other: 'false' });
    expect(await readTrialFeatures(fake.app)).toEqual({ notifications: true, automations: false });
  });
});

describe('createTrialFeatureCache', () => {
  it('reads once per TTL, and shares a read between concurrent callers', async () => {
    const fake = fakeCatalyst();
    fake.tables[TRIAL_FEATURES_TABLE] = flagRows({ notifications: 'false' });
    let now = 1_000_000;
    const cache = createTrialFeatureCache(60_000, () => now);

    const [a, b] = await Promise.all([cache.get(fake.app), cache.get(fake.app)]);
    expect(a.notifications).toBe(false);
    expect(b.notifications).toBe(false);
    expect(fake.queries).toHaveLength(1);

    // Switched back on in the console: not seen until the TTL passes.
    fake.tables[TRIAL_FEATURES_TABLE] = flagRows({ notifications: 'true' });
    now += 59_000;
    expect((await cache.get(fake.app)).notifications).toBe(false);
    now += 2_000;
    expect((await cache.get(fake.app)).notifications).toBe(true);
    expect(fake.queries).toHaveLength(2);
  });

  it('keeps the last good value when a read fails', async () => {
    const fake = fakeCatalyst();
    fake.tables[TRIAL_FEATURES_TABLE] = flagRows({ notifications: 'false' });
    let now = 1_000_000;
    const cache = createTrialFeatureCache(60_000, () => now);
    await cache.get(fake.app);

    const broken: CatalystApp = {
      ...fake.app,
      zcql: () => ({ executeZCQLQuery: async () => { throw new Error('network down'); } }),
    };
    now += 120_000;
    expect((await cache.get(broken)).notifications).toBe(false);
  });

  it('counts everything as on when no read has ever succeeded', async () => {
    const fake = fakeCatalyst();
    const broken: CatalystApp = {
      ...fake.app,
      zcql: () => ({ executeZCQLQuery: async () => { throw new Error('network down'); } }),
    };
    expect(await createTrialFeatureCache().get(broken)).toEqual(ALL_ENABLED);
  });
});

describe('sweepOptionsFor', () => {
  it('skips the sweep entirely when notifications are off', () => {
    expect(sweepOptionsFor({ notifications: false, automations: true })).toBeNull();
    expect(sweepOptionsFor({ notifications: false, automations: false })).toBeNull();
  });

  it('stops rules, and only rules, when automations are off', () => {
    expect(sweepOptionsFor({ notifications: true, automations: false }))
      .toEqual({ skipPlan: true, withdrawRules: true });
    expect(sweepOptionsFor(ALL_ENABLED)).toEqual({});
  });
});

describe('runSweep after a pause', () => {
  it('withdraws reminders more than a day late and still sends newer ones', async () => {
    const fake = fakeCatalyst();
    const now = Date.now();
    await enqueue(fake.app, entry({ dedupeKey: 'old', fireAt: now - STALE_AFTER_MS - 60_000, title: 'Old' }));
    await enqueue(fake.app, entry({ dedupeKey: 'recent', fireAt: now - 3 * 3_600_000, title: 'Recent' }));

    const report = await runSweep(fake.app, { now });

    expect(report.discarded).toBe(1);
    expect(report.delivered).toBe(1);
    const old = fake.tables[QUEUE_TABLE].find((r) => r.DedupeKey === 'old')!;
    expect(old.Status).toBe(QueueStatus.CANCELLED);
    expect(old.LastError).toMatch(/late/);
    // Withdrawn, not deleted: the row and its reason stay.
    expect(fake.tables[QUEUE_TABLE]).toHaveLength(2);
    expect(fake.tables[INBOX_TABLE]).toHaveLength(1);
  });

  it('withdraws due rule firings while automations are off, and still sends task reminders', async () => {
    const fake = fakeCatalyst();
    await enqueue(fake.app, entry({ dedupeKey: 'rule', kind: 'AUTOMATION', sourceType: 'RULE', sourceId: 'r1' }));
    await enqueue(fake.app, entry({ dedupeKey: 'task' }));

    const report = await runSweep(fake.app, { skipPlan: true, withdrawRules: true });

    expect(report.discarded).toBe(1);
    expect(report.delivered).toBe(1);
    const rule = fake.tables[QUEUE_TABLE].find((r) => r.DedupeKey === 'rule')!;
    expect(rule.Status).toBe(QueueStatus.CANCELLED);
    expect(rule.LastError).toMatch(/automations/);
  });
});

describe('startScheduler with prepareTick', () => {
  it('does not sweep when prepareTick says no', async () => {
    const fake = fakeCatalyst();
    await enqueue(fake.app, entry());
    const onTick = vi.fn();
    const scheduler = startScheduler(() => fake.app, {
      intervalMs: 3_600_000, onTick, prepareTick: async () => null,
    });
    await scheduler.runNow();
    scheduler.stop();

    expect(onTick).not.toHaveBeenCalled();
    expect(fake.tables[INBOX_TABLE]).toHaveLength(0);
  });

  it('sweeps with the options prepareTick returns', async () => {
    const fake = fakeCatalyst();
    await enqueue(fake.app, entry());
    const onTick = vi.fn();
    const scheduler = startScheduler(() => fake.app, {
      intervalMs: 3_600_000, onTick, prepareTick: async () => ({ skipPlan: true }),
    });
    await scheduler.runNow();
    scheduler.stop();

    expect(onTick).toHaveBeenCalledTimes(1);
    expect(onTick.mock.calls[0][0].delivered).toBe(1);
  });
});
