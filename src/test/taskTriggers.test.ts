/**
 * The rules that hang off a task rather than a clock.
 *
 * Two properties decide whether these are usable.
 *
 * The first is that saving a task must not fire its status-change rules. This
 * runs on every write, and a rule that notifies whenever the task is touched
 * is worse than one that never fires — it trains the user to ignore the bell.
 *
 * The second is that one task's firing must be cancellable without touching
 * another's. The rule is shared between tasks, so the queue rows have to be
 * scoped per task or completing one task withdraws every other task's pending
 * notification from the same rule.
 */
import { describe, it, expect } from 'vitest';
import {
  syncTaskRules,
  backfillTaskRules,
  firingsFor,
  cancelTaskRules,
  fireAtFor,
  offsetMs,
  appliesTo,
  taskRuleDedupeKey,
} from '../../server/automations/taskTriggers.ts';
import { findPendingForSource } from '../../server/notifications/queue.ts';
import type { RuleRow } from '../../server/automations/rules.ts';
import type { SchedulableTask } from '../../server/notifications/schedule.ts';
import { fakeCatalyst, QUEUE_TABLE } from './helpers/fakeCatalyst.ts';

const RULES = 'KaizenAutomationRules';
const IST = 'Asia/Kolkata';

/** 2030-06-15 at 14:30 IST is 09:00 UTC. */
const DUE_AT = new Date('2030-06-15T09:00:00Z').getTime();
const NOW = new Date('2030-06-10T00:00:00Z').getTime();

function rule(over: Partial<RuleRow> = {}): RuleRow {
  return {
    rowId: '900',
    id: 'r1',
    ownerId: 'user-1',
    name: 'Nudge me',
    description: 'Heads up',
    taskId: '',
    triggerType: 'due-date',
    status: 'active',
    urgency: 'medium',
    offsetValue: 30,
    offsetUnit: 'minutes',
    offsetSteps: [],
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
    nextTriggerAt: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

function task(over: Partial<SchedulableTask> = {}): SchedulableTask {
  return {
    id: 't1',
    title: 'Prepare the deck',
    status: 'TODO',
    dueDate: '2030-06-15',
    dueTime: '14:30',
    ...over,
  };
}

const ctx = { ownerId: 'user-1', timeZone: IST, email: 'user@example.com' };

async function seedRule(app: ReturnType<typeof fakeCatalyst>['app'], r: RuleRow) {
  await app.datastore().table(RULES).insertRow({
    ROWID: r.rowId,
    RuleId: r.id,
    OwnerId: r.ownerId,
    Name: r.name,
    Description: r.description,
    TaskId: r.taskId,
    TriggerType: r.triggerType,
    RuleStatus: r.status,
    Urgency: r.urgency,
    OffsetValue: String(r.offsetValue),
    OffsetUnit: r.offsetUnit,
    OffsetSteps: r.offsetSteps.join(','),
    NotifyInApp: String(r.notifyInApp),
    NotifyBrowser: String(r.notifyBrowser),
    NotifyEmail: String(r.notifyEmail),
    OwnerTimezone: r.ownerTimezone,
    OwnerEmail: r.ownerEmail,
  });
}

describe('offsetMs', () => {
  it('converts each unit', () => {
    expect(offsetMs(rule({ offsetValue: 30, offsetUnit: 'minutes' }))).toBe(1_800_000);
    expect(offsetMs(rule({ offsetValue: 2, offsetUnit: 'hours' }))).toBe(7_200_000);
    expect(offsetMs(rule({ offsetValue: 1, offsetUnit: 'days' }))).toBe(86_400_000);
  });

  it('treats a negative offset as none', () => {
    // A rule set to fire "-5 minutes before" would otherwise fire after the
    // due time, which is not what anyone asked for.
    expect(offsetMs(rule({ offsetValue: -5 }))).toBe(0);
  });
});

describe('appliesTo', () => {
  it('applies to every task when no task is named', () => {
    expect(appliesTo(rule({ taskId: '' }), 'anything')).toBe(true);
  });

  it('applies only to the named task otherwise', () => {
    expect(appliesTo(rule({ taskId: 't1' }), 't1')).toBe(true);
    expect(appliesTo(rule({ taskId: 't1' }), 't2')).toBe(false);
  });
});

describe('fireAtFor', () => {
  it('fires a due-date rule the offset before the due instant', () => {
    const at = fireAtFor(rule(), task(), IST, NOW);
    expect(new Date(at!).toISOString()).toBe('2030-06-15T08:30:00.000Z');
  });

  it('fires an overdue rule at the due instant itself', () => {
    const at = fireAtFor(rule({ triggerType: 'overdue' }), task(), IST, NOW);
    expect(at).toBe(DUE_AT);
  });

  it('fires a status-change rule now', () => {
    expect(fireAtFor(rule({ triggerType: 'status-change' }), task(), IST, NOW)).toBe(NOW);
  });

  it('treats a task with no time as due at the end of its day', () => {
    const at = fireAtFor(rule({ offsetValue: 0 }), task({ dueTime: undefined }), IST, NOW);
    // 23:59 IST is 18:29 UTC.
    expect(new Date(at!).toISOString()).toBe('2030-06-15T18:29:00.000Z');
  });

  it('has nothing to fire for a completed task', () => {
    expect(fireAtFor(rule(), task({ status: 'DONE' }), IST, NOW)).toBeNull();
    expect(fireAtFor(rule({ triggerType: 'status-change' }), task({ status: 'done' }), IST, NOW))
      .toBeNull();
  });

  it('has nothing to fire for a task with no due date', () => {
    expect(fireAtFor(rule(), task({ dueDate: undefined }), IST, NOW)).toBeNull();
    expect(fireAtFor(rule({ triggerType: 'overdue' }), task({ dueDate: undefined }), IST, NOW))
      .toBeNull();
  });
});

describe('syncTaskRules', () => {
  it('costs one query and nothing else when the owner has no rules', async () => {
    const fake = fakeCatalyst();

    const out = await syncTaskRules(fake.app, ctx, task(), NOW);

    expect(out.evaluated).toBe(0);
    expect(fake.tables[QUEUE_TABLE]).toHaveLength(0);
  });

  it('queues a due-date rule against the task', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule());

    const out = await syncTaskRules(fake.app, ctx, task(), NOW);

    expect(out.enqueued).toBe(1);
    const row = fake.tables[QUEUE_TABLE][0];
    expect(row.SourceType).toBe('RULE');
    // Scoped to the task, so one task's cancel cannot withdraw another's.
    expect(row.SourceId).toBe('r1:t1');
    expect(new Date(Number(row.FireAt)).toISOString()).toBe('2030-06-15T08:30:00.000Z');
  });

  it('ignores a rule bound to a different task', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule({ taskId: 't2' }));

    const out = await syncTaskRules(fake.app, ctx, task({ id: 't1' }), NOW);

    expect(out.evaluated).toBe(0);
    expect(fake.tables[QUEUE_TABLE]).toHaveLength(0);
  });

  it('ignores a rule whose trigger is a schedule, not a task', async () => {
    // A recurring rule is planned by the sweep from NextTriggerAt. Picking it
    // up here too would fire it on every task write as well.
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule({ triggerType: 'recurring' }));

    const out = await syncTaskRules(fake.app, ctx, task(), NOW);

    expect(out.evaluated).toBe(0);
    expect(fake.tables[QUEUE_TABLE]).toHaveLength(0);
  });

  it('ignores a paused rule', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule({ status: 'paused' }));

    expect((await syncTaskRules(fake.app, ctx, task(), NOW)).evaluated).toBe(0);
  });

  it('does not queue twice when the task is saved again', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule());

    await syncTaskRules(fake.app, ctx, task(), NOW);
    const again = await syncTaskRules(fake.app, ctx, task({ title: 'Renamed' }), NOW);

    expect(again.enqueued).toBe(0);
    expect(fake.tables[QUEUE_TABLE]).toHaveLength(1);
  });

  it('re-arms and withdraws the old firing when the due date moves', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule());

    await syncTaskRules(fake.app, ctx, task(), NOW);
    const moved = await syncTaskRules(fake.app, ctx, task({ dueDate: '2030-06-20' }), NOW);

    expect(moved.enqueued).toBe(1);
    expect(moved.cancelled).toBe(1);
    expect(await findPendingForSource(fake.app, 'RULE', 'r1:t1')).toHaveLength(1);
  });

  it('withdraws the firing when the task is completed', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule());
    await syncTaskRules(fake.app, ctx, task(), NOW);

    const done = await syncTaskRules(fake.app, ctx, task({ status: 'DONE' }), NOW);

    expect(done.cancelled).toBe(1);
    expect(await findPendingForSource(fake.app, 'RULE', 'r1:t1')).toHaveLength(0);
  });
});

describe('status-change', () => {
  const changeRule = rule({ triggerType: 'status-change' });

  it('fires when the status actually moves', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, changeRule);

    const out = await syncTaskRules(
      fake.app, { ...ctx, previousStatus: 'TODO' }, task({ status: 'IN_PROGRESS' }), NOW,
    );

    expect(out.enqueued).toBe(1);
  });

  it('does not fire when the task is saved with the same status', async () => {
    // The property that keeps this feature usable. Firing on every save trains
    // the user to ignore the bell.
    const fake = fakeCatalyst();
    await seedRule(fake.app, changeRule);

    const out = await syncTaskRules(
      fake.app, { ...ctx, previousStatus: 'TODO' }, task({ status: 'TODO' }), NOW,
    );

    expect(out.enqueued).toBe(0);
    expect(fake.tables[QUEUE_TABLE]).toHaveLength(0);
  });

  it('does not fire on creation, where there is no previous status', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, changeRule);

    const out = await syncTaskRules(fake.app, ctx, task(), NOW);

    expect(out.enqueued).toBe(0);
  });

  it('fires again on a later transition', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, changeRule);

    await syncTaskRules(
      fake.app, { ...ctx, previousStatus: 'TODO' }, task({ status: 'IN_PROGRESS' }), NOW,
    );
    const second = await syncTaskRules(
      fake.app, { ...ctx, previousStatus: 'IN_PROGRESS' }, task({ status: 'TODO' }), NOW + 60_000,
    );

    // Each transition is its own instant and its own key, so neither
    // supersedes the other.
    expect(second.enqueued).toBe(1);
    expect(fake.tables[QUEUE_TABLE]).toHaveLength(2);
  });
});

describe('cancelTaskRules', () => {
  it('withdraws a deleted task\'s firings', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule());
    await syncTaskRules(fake.app, ctx, task(), NOW);

    expect(await cancelTaskRules(fake.app, 'user-1', 't1')).toBe(1);
    expect(await findPendingForSource(fake.app, 'RULE', 'r1:t1')).toHaveLength(0);
  });

  it('leaves another task\'s firing from the same rule alone', async () => {
    // The reason SourceId is scoped per task rather than being the rule id.
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule());
    await syncTaskRules(fake.app, ctx, task({ id: 't1' }), NOW);
    await syncTaskRules(fake.app, ctx, task({ id: 't2' }), NOW);

    await cancelTaskRules(fake.app, 'user-1', 't1');

    expect(await findPendingForSource(fake.app, 'RULE', 'r1:t2')).toHaveLength(1);
  });
});

describe('taskRuleDedupeKey', () => {
  it('is stable for the same firing and distinct across tasks', () => {
    expect(taskRuleDedupeKey('r1', 't1', 100)).toBe(taskRuleDedupeKey('r1', 't1', 100));
    expect(taskRuleDedupeKey('r1', 't1', 100)).not.toBe(taskRuleDedupeKey('r1', 't2', 100));
    expect(taskRuleDedupeKey('r1', 't1', 100)).not.toBe(taskRuleDedupeKey('r1', 't1', 200));
  });
});

describe('backfillTaskRules', () => {
  /** A rule created today has to reach the tasks that already exist. */
  it('applies one rule to every task the owner already has', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule());

    const out = await backfillTaskRules(
      fake.app, ctx,
      [task({ id: 't1' }), task({ id: 't2' }), task({ id: 't3' })],
      NOW,
    );

    expect(out.enqueued).toBe(3);
    expect(fake.tables[QUEUE_TABLE].map((r) => r.SourceId).sort())
      .toEqual(['r1:t1', 'r1:t2', 'r1:t3']);
  });

  it('enqueues nothing the second time', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule());

    await backfillTaskRules(fake.app, ctx, [task()], NOW);
    const again = await backfillTaskRules(fake.app, ctx, [task()], NOW);

    expect(again.enqueued).toBe(0);
    expect(fake.tables[QUEUE_TABLE]).toHaveLength(1);
  });

  // A lead-time warning delivered after the moment it warned about is not
  // news, it is wrong: "due in 30 minutes" for something due yesterday.
  it('skips a lead-time firing whose moment has passed', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule({ triggerType: 'due-date' }));

    const afterDue = DUE_AT + 60 * 60_000;
    const out = await backfillTaskRules(fake.app, ctx, [task()], afterDue);

    expect(out.enqueued).toBe(0);
    expect(fake.tables[QUEUE_TABLE]).toHaveLength(0);
  });

  // An overdue notice is still true however late it arrives — catching up is
  // the entire point of it.
  it('still queues an overdue firing for a task already past due', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule({ triggerType: 'overdue', offsetValue: 0 }));

    const afterDue = DUE_AT + 60 * 60_000;
    const out = await backfillTaskRules(fake.app, ctx, [task()], afterDue);

    expect(out.enqueued).toBe(1);
    expect(Number(fake.tables[QUEUE_TABLE][0].FireAt)).toBe(DUE_AT);
  });

  it('leaves a completed task alone', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule({ triggerType: 'overdue' }));

    const out = await backfillTaskRules(fake.app, ctx, [task({ status: 'DONE' })], NOW);

    expect(out.enqueued).toBe(0);
    expect(fake.tables[QUEUE_TABLE]).toHaveLength(0);
  });

  it('does not fire status-change rules, which need a real transition', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule({ triggerType: 'status-change' }));

    const out = await backfillTaskRules(fake.app, ctx, [task()], NOW);

    expect(out.enqueued).toBe(0);
  });

  it('costs one rules query however many tasks there are', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule());

    const before = fake.queries.length;
    await backfillTaskRules(fake.app, ctx, [task({ id: 'a' }), task({ id: 'b' })], NOW);

    const ruleQueries = fake.queries
      .slice(before)
      .filter((q) => q.includes('KaizenAutomationRules'));
    expect(ruleQueries).toHaveLength(1);
  });
});

describe('firingsFor — several steps in one rule', () => {
  const steps = rule({ offsetSteps: [-60, -5, 0, 30] });

  it('fires once per step, relative to the due instant', () => {
    const out = firingsFor(steps, task(), IST, NOW);

    expect(out.map((f) => f.step)).toEqual([-60, -5, 0, 30]);
    expect(out.map((f) => f.fireAt - DUE_AT)).toEqual([
      -60 * 60_000, -5 * 60_000, 0, 30 * 60_000,
    ]);
  });

  it('gives a completed task nothing, however many steps the rule has', () => {
    expect(firingsFor(steps, task({ status: 'DONE' }), IST, NOW)).toEqual([]);
  });

  it('gives a task with no due date nothing', () => {
    expect(firingsFor(steps, task({ dueDate: undefined }), IST, NOW)).toEqual([]);
  });
});

describe('syncTaskRules — several steps', () => {
  it('queues one entry per step', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule({ offsetSteps: [-60, -5, 0] }));

    const out = await syncTaskRules(fake.app, ctx, task(), NOW);

    expect(out.enqueued).toBe(3);
    expect(fake.tables[QUEUE_TABLE].map((r) => Number(r.FireAt) - DUE_AT).sort((a, b) => a - b))
      .toEqual([-60 * 60_000, -5 * 60_000, 0]);
  });

  /**
   * The bug this change could easily have introduced: the supersede pass used
   * to keep one dedupe key, so each step would have cancelled its siblings and
   * a four-step rule would have delivered once.
   */
  it('leaves its own sibling steps pending on a re-save', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule({ offsetSteps: [-60, -5, 0] }));

    await syncTaskRules(fake.app, ctx, task(), NOW);
    const again = await syncTaskRules(fake.app, ctx, task(), NOW);

    expect(again.enqueued).toBe(0);
    expect(again.cancelled).toBe(0);
    const pending = await findPendingForSource(fake.app, 'RULE', 'r1:t1');
    expect(pending).toHaveLength(3);
  });

  it('replaces every step when the due date moves', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule({ offsetSteps: [-60, -5] }));

    await syncTaskRules(fake.app, ctx, task(), NOW);
    const moved = await syncTaskRules(fake.app, ctx, task({ dueDate: '2030-06-16' }), NOW);

    expect(moved.enqueued).toBe(2);
    expect(moved.cancelled).toBe(2);
    const pending = await findPendingForSource(fake.app, 'RULE', 'r1:t1');
    expect(pending).toHaveLength(2);
  });

  it('withdraws every step once the task is done', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule({ offsetSteps: [-60, -5, 0] }));

    await syncTaskRules(fake.app, ctx, task(), NOW);
    const done = await syncTaskRules(fake.app, ctx, task({ status: 'DONE' }), NOW);

    expect(done.cancelled).toBe(3);
    expect(await findPendingForSource(fake.app, 'RULE', 'r1:t1')).toHaveLength(0);
  });

  it('says how far off each firing is, rather than "this automation fired"', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule({ description: '', offsetSteps: [-60, 0, 30] }));

    await syncTaskRules(fake.app, ctx, task(), NOW);

    expect(fake.tables[QUEUE_TABLE].map((r) => r.Body).sort()).toEqual([
      'Due in 1 hour — Prepare the deck',
      'Due now — Prepare the deck',
      'Overdue by 30 minutes — Prepare the deck',
    ]);
  });
});

describe('backfillTaskRules — several steps', () => {
  const afterDue = DUE_AT + 60 * 60_000;

  it('skips the lead-time steps that have passed and keeps the overdue ones', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule({ offsetSteps: [-60, -5, 0, 30, 120] }));

    // An hour past due: -60, -5, 0 and +30 are behind us; only +120 is ahead.
    const out = await backfillTaskRules(fake.app, ctx, [task()], afterDue);

    expect(fake.tables[QUEUE_TABLE].map((r) => Number(r.FireAt) - DUE_AT).sort((a, b) => a - b))
      .toEqual([0, 30 * 60_000, 120 * 60_000]);
    expect(out.enqueued).toBe(3);
  });

  it('does not cancel the steps it deliberately skipped', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule({ offsetSteps: [-60, 30] }));

    await syncTaskRules(fake.app, ctx, task(), NOW);      // both queued, before due
    const out = await backfillTaskRules(fake.app, ctx, [task()], afterDue);

    expect(out.cancelled).toBe(0);
    expect(await findPendingForSource(fake.app, 'RULE', 'r1:t1')).toHaveLength(2);
  });
});

/**
 * With realistic ids the per-task SourceId is 73 characters, which Catalyst
 * stores as 64. Short test ids like 'r1:t1' hid that these never cancelled.
 */
describe('realistic ids — firings are withdrawn', () => {
  const RULE_ID = '5f0c9a2e-8d1b-4e6f-9a3c-2b7d4e1f8a90';
  const TASK_ID = 'c3e1b7d2-4a5f-4c8e-9b1d-7f2a6e3c5b41';
  const pending = (fake: ReturnType<typeof fakeCatalyst>) =>
    fake.tables[QUEUE_TABLE].filter((r) => r.Status === 'PENDING');

  it('replaces the old steps when the due date moves', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule({ id: RULE_ID, offsetSteps: [-60, -5] }));

    await syncTaskRules(fake.app, ctx, task({ id: TASK_ID }), NOW);
    const moved = await syncTaskRules(fake.app, ctx, task({ id: TASK_ID, dueDate: '2030-06-16' }), NOW);

    expect(moved.cancelled).toBe(2);
    expect(pending(fake)).toHaveLength(2);
  });

  it('withdraws every step once the task is done', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule({ id: RULE_ID, offsetSteps: [-60, -5, 0] }));

    await syncTaskRules(fake.app, ctx, task({ id: TASK_ID }), NOW);
    const done = await syncTaskRules(fake.app, ctx, task({ id: TASK_ID, status: 'DONE' }), NOW);

    expect(done.cancelled).toBe(3);
    expect(pending(fake)).toHaveLength(0);
  });

  it('withdraws them when the task is deleted', async () => {
    const fake = fakeCatalyst();
    await seedRule(fake.app, rule({ id: RULE_ID, offsetSteps: [-60, -5] }));

    await syncTaskRules(fake.app, ctx, task({ id: TASK_ID }), NOW);
    expect(await cancelTaskRules(fake.app, ctx.ownerId, TASK_ID)).toBe(2);
    expect(pending(fake)).toHaveLength(0);
  });
});
