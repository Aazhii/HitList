/**
 * Planning a rule into the queue.
 *
 * Two properties carry the weight here.
 *
 * The first is that a rule cannot fire in a loop. The dead Java scheduler this
 * replaces set lastTriggeredAt on a detached entity and never saved it, so its
 * throttle always read null and every rule fired once a minute forever. The
 * throttle here is a row in the database, so the test is: plan twice and check
 * the second tick finds nothing.
 *
 * The second is that a firing cannot be lost. Enqueue happens before the rule
 * advances, so a crash between them leaves the rule due, recomputes the same
 * DedupeKey, and the duplicate is refused. Late beats missing.
 */
import { describe, it, expect, vi } from 'vitest';
import { planRule, initialTrigger, channelsFor } from '../../server/automations/planner.ts';
import { findDueRules, type RuleRow } from '../../server/automations/rules.ts';
import { listRuns } from '../../server/automations/runs.ts';
import { QueueStatus } from '../../server/notifications/queue.ts';
import { fakeCatalyst, QUEUE_TABLE } from './helpers/fakeCatalyst.ts';

const RULES = 'KaizenAutomationRules';
const RUNS = 'KaizenAutomationRuns';
const IST = 'Asia/Kolkata';

/** 2030-06-15 at 09:00 IST, expressed in UTC. */
const NINE_AM_IST = new Date('2030-06-15T03:30:00Z').getTime();

const ctx = { timeZone: IST, email: 'user@example.com' };

function rule(over: Partial<RuleRow> = {}): RuleRow {
  return {
    rowId: '900',
    id: 'r1',
    ownerId: 'user-1',
    name: 'Morning review',
    description: 'Look at today\'s tasks.',
    taskId: '',
    triggerType: 'recurring',
    status: 'active',
    urgency: 'medium',
    offsetValue: 0,
    offsetUnit: 'minutes',
    recurrenceFreq: 'daily',
    recurrenceTime: '09:00',
    recurrenceDayOfWeek: 0,
    recurrenceDayOfMonth: 1,
    notifyInApp: true,
    notifyBrowser: false,
    notifyEmail: false,
    ownerTimezone: IST,
    ownerEmail: 'user@example.com',
    lastTriggeredAt: 0,
    nextTriggerAt: NINE_AM_IST,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

/** Seeds a rule into the fake so findDueRules can see it. */
async function seedRule(
  app: ReturnType<typeof fakeCatalyst>['app'],
  r: RuleRow,
): Promise<void> {
  await app.datastore().table(RULES).insertRow({
    ROWID: r.rowId,
    RuleId: r.id,
    OwnerId: r.ownerId,
    Name: r.name,
    RuleStatus: r.status,
    TriggerType: r.triggerType,
    RecurrenceFreq: r.recurrenceFreq,
    RecurrenceTime: r.recurrenceTime,
    RecurrenceDayOfWeek: String(r.recurrenceDayOfWeek),
    RecurrenceDayOfMonth: String(r.recurrenceDayOfMonth),
    NotifyInApp: String(r.notifyInApp),
    NotifyBrowser: String(r.notifyBrowser),
    NotifyEmail: String(r.notifyEmail),
    OwnerTimezone: r.ownerTimezone,
    OwnerEmail: r.ownerEmail,
    LastTriggeredAt: String(r.lastTriggeredAt),
    NextTriggerAt: String(r.nextTriggerAt),
  });
}

describe('channelsFor', () => {
  it('maps each notify flag to its channel', () => {
    expect(channelsFor(rule({ notifyInApp: true, notifyBrowser: true, notifyEmail: true })))
      .toEqual(['inapp', 'webpush', 'email']);
  });

  it('delivers in-app when a rule asks for nothing', () => {
    // A rule that fires and delivers nowhere is indistinguishable from one
    // that did not fire.
    expect(channelsFor(rule({ notifyInApp: false, notifyBrowser: false, notifyEmail: false })))
      .toEqual(['inapp']);
  });

  it('respects an explicit single channel', () => {
    expect(channelsFor(rule({ notifyInApp: false, notifyBrowser: false, notifyEmail: true })))
      .toEqual(['email']);
  });
});

describe('initialTrigger', () => {
  it('schedules a recurring rule', () => {
    const at = initialTrigger(rule(), IST, new Date('2030-06-15T00:00:00Z').getTime());
    expect(new Date(at).toISOString()).toBe('2030-06-15T03:30:00.000Z');
  });

  it('schedules a daily digest', () => {
    const at = initialTrigger(
      rule({ triggerType: 'daily-digest' }), IST, new Date('2030-06-15T00:00:00Z').getTime(),
    );
    expect(at).toBeGreaterThan(0);
  });

  it('leaves the event-driven triggers unscheduled', () => {
    // Giving these a NextTriggerAt would put them in the planning query, where
    // they have nothing to do — they hang off a task's dates or off an event.
    for (const t of ['due-date', 'overdue', 'status-change'] as const) {
      expect(initialTrigger(rule({ triggerType: t }), IST)).toBe(0);
    }
  });

  it('leaves a paused rule unscheduled', () => {
    expect(initialTrigger(rule({ status: 'paused' }), IST)).toBe(0);
  });

  it('is 0 when the schedule cannot be computed', () => {
    expect(initialTrigger(rule({ recurrenceTime: 'half nine' }), IST)).toBe(0);
  });
});

describe('planRule', () => {
  it('enqueues the firing', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule());

    const out = await planRule(fake.app, rule(), ctx, NINE_AM_IST);

    expect(out.enqueued).toBe(true);
    expect(fake.tables[QUEUE_TABLE]).toHaveLength(1);
    expect(fake.tables[QUEUE_TABLE][0].SourceType).toBe('RULE');
    expect(fake.tables[QUEUE_TABLE][0].SourceId).toBe('r1');
    expect(Number(fake.tables[QUEUE_TABLE][0].FireAt)).toBe(NINE_AM_IST);
  });

  it('advances the rule to tomorrow', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule());

    const out = await planRule(fake.app, rule(), ctx, NINE_AM_IST);

    expect(new Date(out.nextTriggerAt).toISOString()).toBe('2030-06-16T03:30:00.000Z');
    expect(fake.tables[RULES][0].NextTriggerAt).toBe(String(out.nextTriggerAt));
    expect(Number(fake.tables[RULES][0].LastTriggeredAt)).toBe(NINE_AM_IST);
  });

  it('does not fire in a loop', async () => {
    // The bug in the scheduler this replaces: a throttle held in memory that
    // was never written, so every rule fired once a minute forever.
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule());

    await planRule(fake.app, rule(), ctx, NINE_AM_IST);

    expect(await findDueRules(fake.app, NINE_AM_IST)).toHaveLength(0);
  });

  it('refuses to enqueue the same firing twice', async () => {
    // What makes the enqueue-then-advance ordering safe: if the process dies
    // between the two, the rule is still due and replans the same DedupeKey.
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule());

    await planRule(fake.app, rule(), ctx, NINE_AM_IST);
    const replay = await planRule(fake.app, rule(), ctx, NINE_AM_IST);

    expect(replay.enqueued).toBe(false);
    expect(fake.tables[QUEUE_TABLE]).toHaveLength(1);
  });

  it('enqueues BEFORE advancing the rule', async () => {
    // Ordering is the whole argument. Advancing first and then crashing loses
    // the firing with nothing to show for it.
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule());

    const order: string[] = [];
    const realDatastore = fake.app.datastore.bind(fake.app);
    vi.spyOn(fake.app, 'datastore').mockImplementation(() => {
      const ds = realDatastore();
      return {
        table: (name: string) => {
          const t = ds.table(name);
          return {
            ...t,
            insertRow: async (row: Record<string, string | number>) => {
              if (name === QUEUE_TABLE) order.push('enqueue');
              return t.insertRow(row);
            },
            updateRow: async (row: Record<string, string | number>) => {
              if (name === RULES) order.push('advance');
              return t.updateRow(row);
            },
          };
        },
      };
    });

    await planRule(fake.app, rule(), ctx, NINE_AM_IST);
    vi.restoreAllMocks();

    expect(order.indexOf('enqueue')).toBeLessThan(order.indexOf('advance'));
  });

  it('carries the delivery address and the rule id', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule());

    await planRule(fake.app, rule(), ctx, NINE_AM_IST);

    const payload = JSON.parse(fake.tables[QUEUE_TABLE][0].Payload);
    expect(payload.email).toBe('user@example.com');
    expect(payload.ruleId).toBe('r1');
  });

  it('marks a digest as a digest, not an automation', async () => {
    const fake = fakeCatalyst();
    const r = rule({ triggerType: 'daily-digest' });
    await seedRule(fake.app, r);

    await planRule(fake.app, r, ctx, NINE_AM_IST);

    expect(fake.tables[QUEUE_TABLE][0].Kind).toBe('DIGEST');
  });

  it('leaves the queued entry pending for the drain to pick up', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule());

    await planRule(fake.app, rule(), ctx, NINE_AM_IST);

    expect(fake.tables[QUEUE_TABLE][0].Status).toBe(QueueStatus.PENDING);
  });
});

describe('a rule that cannot be scheduled', () => {
  it('is parked rather than left due forever', async () => {
    // Left due, it would be re-read and fail identically on every tick from
    // now on — a permanent, invisible cost.
    const fake = fakeCatalyst();
    const broken = rule({ recurrenceTime: 'half nine' });
    await seedRule(fake.app, broken);

    const out = await planRule(fake.app, broken, ctx, NINE_AM_IST);

    expect(out.enqueued).toBe(false);
    expect(out.nextTriggerAt).toBe(0);
    expect(fake.tables[RULES][0].NextTriggerAt).toBe('0');
    expect(await findDueRules(fake.app, NINE_AM_IST)).toHaveLength(0);
  });

  it('says why, in the audit trail', async () => {
    const fake = fakeCatalyst();
    const broken = rule({ recurrenceTime: 'half nine' });
    await seedRule(fake.app, broken);

    await planRule(fake.app, broken, ctx, NINE_AM_IST);

    const runs = await listRuns(fake.app, 'user-1');
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('SKIPPED');
    expect(runs[0].detail).toContain('parked');
  });
});

describe('the audit trail', () => {
  it('records a successful firing', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule());

    await planRule(fake.app, rule(), ctx, NINE_AM_IST);

    const runs = await listRuns(fake.app, 'user-1');
    expect(runs[0].status).toBe('SUCCESS');
    expect(runs[0].ruleId).toBe('r1');
    expect(runs[0].channels).toEqual(['inapp']);
  });

  it('records a failure without throwing', async () => {
    // planRule runs inside a tick that may already have delivered. A rule that
    // cannot be planned must not abandon the rest of the batch.
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule());

    // Fail the enqueue, then let the audit write through — the run record is
    // the only trace a failed plan leaves, so it has to survive the failure
    // that produced it.
    const realDatastore = fake.app.datastore.bind(fake.app);
    let first = true;
    vi.spyOn(fake.app, 'datastore').mockImplementation(() => {
      if (first) { first = false; throw new Error('datastore unavailable'); }
      return realDatastore();
    });

    const out = await planRule(fake.app, rule(), ctx, NINE_AM_IST);
    vi.restoreAllMocks();

    expect(out.error).toContain('datastore unavailable');
    expect(out.enqueued).toBe(false);
    expect(fake.tables[RUNS].some((r) => r.RunStatus === 'FAILED')).toBe(true);
  });
});
