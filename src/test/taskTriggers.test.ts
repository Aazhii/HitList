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
