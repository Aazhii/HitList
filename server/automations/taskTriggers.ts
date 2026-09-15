/**
 * The rules that hang off a task rather than off a clock.
 *
 * Three of the five trigger types cannot be found by NextTriggerAt, because
 * they have no schedule of their own:
 *
 *   due-date       fire an offset before the task's due date
 *   overdue        fire once the task's due date passes
 *   status-change  fire when the task's status changes — an event, not a time
 *
 * All three are therefore evaluated from the task write path, where the task's
 * dates and its previous status are both in hand. The first two turn into
 * ordinary queue rows with a future FireAt; the third is enqueued for now.
 *
 * The cost discipline is the same as everywhere else: one query for the
 * owner's task-driven rules, and nothing at all when they have none. A user
 * with no automations pays one indexed read per task write that returns no
 * rows.
 *
 * As with reminders.ts, nothing here throws. It runs inside the user's save,
 * and an automation that cannot be scheduled must not cost them their task.
 */
import type { CatalystApp } from '../notifications/types.ts';
import { enqueue, cancelSupersededFor, cancelPendingFor } from '../notifications/queue.ts';
import { zcqlString, unwrapRows } from '../notifications/zcql.ts';
import { RULES_TABLE } from '../catalyst/schema.ts';
import { toRule, ruleColumns, type RuleRow } from './rules.ts';
import { stepsForRule } from './steps.ts';
import { channelsFor, renderRule } from './planner.ts';
import { recordRun } from './runs.ts';
import { zonedToEpoch, END_OF_DAY, type SchedulableTask } from '../notifications/schedule.ts';

/** The triggers this module owns. */
const TASK_TRIGGERS = ['due-date', 'overdue', 'status-change'] as const;

/**
 * The owner's active task-driven rules, in one query.
 *
 * All three trigger types come back together rather than in three round trips:
 * this runs on every task write, so the query count is what it costs.
 */
export async function findTaskRules(app: CatalystApp, ownerId: string): Promise<RuleRow[]> {
  const list = TASK_TRIGGERS.map(zcqlString).join(', ');
  const results = await app.zcql().executeZCQLQuery(
    `SELECT ${ruleColumns()} FROM ${RULES_TABLE} ` +
    `WHERE OwnerId = ${zcqlString(ownerId)} AND RuleStatus = 'active' ` +
    `AND TriggerType IN (${list})`,
  );
  return unwrapRows(results, RULES_TABLE).map(toRule);
}

/** The offset in milliseconds. */
export function offsetMs(rule: RuleRow): number {
  const unit = rule.offsetUnit === 'hours' ? 3_600_000
    : rule.offsetUnit === 'days' ? 86_400_000
    : 60_000;
  return Math.max(0, rule.offsetValue) * unit;
}

/** Does this rule apply to this task? An empty TaskId means every task. */
export function appliesTo(rule: RuleRow, taskId: string): boolean {
  return rule.taskId === '' || rule.taskId === taskId;
}

/** A rule's firing for one task is keyed by the rule, the task, and the instant. */
export function taskRuleDedupeKey(ruleId: string, taskId: string, fireAt: number): string {
  return `rule:${ruleId}:task:${taskId}:at:${fireAt}`;
}

export interface TaskTriggerContext {
  ownerId: string;
  timeZone: string;
  email: string;
  /** The task's status before this write, when it is known. */
  previousStatus?: string;
}

export interface TaskTriggerResult {
  evaluated: number;
  enqueued: number;
  cancelled: number;
  details: string[];
  error?: string;
}

/**
 * Works out when a rule fires for a task, or null when it does not.
 *
 * Returns an absolute instant, resolved through the owner's zone, so the queue
 * only ever compares integers — see server/notifications/schedule.ts.
 */
export function fireAtFor(
  rule: RuleRow,
  task: SchedulableTask,
  timeZone: string,
  now: number,
): number | null {
  const firings = firingsFor(rule, task, timeZone, now);
  return firings.length ? firings[0].fireAt : null;
}

/** One firing of a rule against a task: the step, and when it lands. */
export interface Firing {
  /** Signed minutes from the due instant; undefined for a status change. */
  step?: number;
  fireAt: number;
}

/**
 * Every instant a rule fires for a task.
 *
 * A due-date rule used to fire once. It now fires once per step, which is what
 * lets one rule escalate — an hour before, then five minutes before, then again
 * when it is overdue — instead of needing a rule per notification.
 *
 * An empty list means the rule has nothing to fire for this task: no due date,
 * the task is done, or the date will not parse.
 */
export function firingsFor(
  rule: RuleRow,
  task: SchedulableTask,
  timeZone: string,
  now: number,
): Firing[] {
  // A completed task has nothing left to remind anyone about.
  if (task.status === 'DONE' || task.status === 'done') return [];

  // An event, not a schedule. It fires now, and only when the status actually
  // moved — re-saving a task with the same status must not produce a
  // notification; the caller checks that.
  if (rule.triggerType === 'status-change') return [{ fireAt: now }];

  if (rule.triggerType !== 'due-date' && rule.triggerType !== 'overdue') return [];
  if (!task.dueDate) return [];

  const dueAt = zonedToEpoch(task.dueDate, task.dueTime || END_OF_DAY, timeZone);
  if (dueAt === null) return [];

  return stepsForRule(rule).map((step) => ({ step, fireAt: dueAt + step * 60_000 }));
}

/**
 * Brings the queue in line with the owner's task-driven rules for one task.
 *
 * Safe to call on every task write, like syncTaskReminder(): it recomputes
 * what each rule implies, enqueues that, and cancels anything superseded. A
 * title change recomputes the same DedupeKey and does nothing.
 */
export async function syncTaskRules(
  app: CatalystApp,
  ctx: TaskTriggerContext,
  task: SchedulableTask,
  now = Date.now(),
): Promise<TaskTriggerResult> {
  const result: TaskTriggerResult = { evaluated: 0, enqueued: 0, cancelled: 0, details: [] };

  try {
    const rules = await findTaskRules(app, ctx.ownerId);
    if (rules.length === 0) return result;

    for (const rule of rules) {
      await applyRuleToTask(app, ctx, rule, task, now, result);
    }

    return result;
  } catch (e) {
    return { ...result, error: describe(e) };
  }
}

/**
 * Applies the rules a user already has to the tasks they already have.
 *
 * Rules are evaluated on the task write path, which means a rule created today
 * reaches none of the tasks written before it — the rule looks active and does
 * nothing. This closes that gap the same way backfillReminders() closes it for
 * reminders: the owner's own client asks once, on sign-in, where the timezone
 * and the delivery address are available.
 *
 * Idempotent: each firing re-derives the DedupeKey it would have had all
 * along, so a second call enqueues nothing.
 *
 * `stale` is the one behaviour that differs from a task write. A lead-time
 * warning whose moment has passed — "due in 1 day" for something due
 * yesterday — is not news, it is misinformation, so it is skipped. An overdue
 * notice is still true however late it arrives, which is the whole point of
 * catching up, so it is kept.
 */
export async function backfillTaskRules(
  app: CatalystApp,
  ctx: TaskTriggerContext,
  tasks: SchedulableTask[],
  now = Date.now(),
): Promise<TaskTriggerResult> {
  const result: TaskTriggerResult = { evaluated: 0, enqueued: 0, cancelled: 0, details: [] };

  try {
    // Once for every task, rather than once per task: this walks the whole
    // task list, so the per-write query count is not the right trade here.
    const rules = await findTaskRules(app, ctx.ownerId);
    if (rules.length === 0) return result;

    for (const task of tasks) {
      for (const rule of rules) {
        await applyRuleToTask(app, ctx, rule, task, now, result, { skipStaleLeadTime: true });
      }
    }

    return result;
  } catch (e) {
    return { ...result, error: describe(e) };
  }
}

/** One rule against one task, across every step it fires at. */
async function applyRuleToTask(
  app: CatalystApp,
  ctx: TaskTriggerContext,
  rule: RuleRow,
  task: SchedulableTask,
  now: number,
  result: TaskTriggerResult,
  { skipStaleLeadTime = false }: { skipStaleLeadTime?: boolean } = {},
): Promise<void> {
  if (!appliesTo(rule, task.id)) return;
  result.evaluated++;

  // status-change fires only on an actual transition. Without this, every
  // save of an unchanged task would notify.
  if (rule.triggerType === 'status-change') {
    if (ctx.previousStatus === undefined || ctx.previousStatus === task.status) return;
  }

  const firings = firingsFor(rule, task, ctx.timeZone, now);

  if (firings.length === 0) {
    // The rule no longer has anything to fire for this task — the due date
    // was cleared, or the task was completed. Withdraw what it had queued.
    result.cancelled += await cancelPendingFor(app, 'RULE', `${rule.id}:${task.id}`);
    return;
  }

  const channels = channelsFor(rule);
  // Every step's key, so the supersede pass below keeps the siblings and
  // cancels only rows from a schedule that no longer applies.
  const live: string[] = [];

  for (const { step, fireAt } of firings) {
    const dedupeKey = taskRuleDedupeKey(rule.id, task.id, fireAt);
    live.push(dedupeKey);

    // Catching up on an existing task: a lead-time warning whose moment has
    // gone is not news, it is wrong ("due in 1 day" for yesterday). An at- or
    // after-due firing is still true however late it is, which is the point.
    if (skipStaleLeadTime && fireAt < now && (step ?? 0) < 0) continue;

    const { title, body } = renderRule(rule, step);

    const enqueued = await enqueue(app, {
      ownerId: ctx.ownerId,
      fireAt,
      dedupeKey,
      kind: 'AUTOMATION',
      sourceType: 'RULE',
      // Scoped to the task, so cancelling one task's firing cannot withdraw
      // the same rule's firing for a different task.
      sourceId: `${rule.id}:${task.id}`,
      channels,
      title,
      body: `${body} — ${task.title}`,
      payload: {
        email: ctx.email,
        ruleId: rule.id,
        taskId: task.id,
        urgency: rule.urgency,
        step,
      },
    });

    if (enqueued) {
      result.enqueued++;
      result.details.push(`${rule.id} → ${task.id} at ${new Date(fireAt).toISOString()}`);
      await recordRun(app, {
        ownerId: ctx.ownerId, ruleId: rule.id, ruleName: rule.name, triggeredAt: now,
        status: 'SUCCESS', detail: `queued for ${task.title}`, channels,
      });
    }
  }

  // status-change fires once per event, so there is nothing to supersede:
  // each transition is its own instant and its own key.
  if (rule.triggerType !== 'status-change') {
    result.cancelled += await cancelSupersededFor(app, 'RULE', `${rule.id}:${task.id}`, live);
  }
}

/** Withdraws every task-rule firing queued for a deleted task. */
export async function cancelTaskRules(
  app: CatalystApp,
  ownerId: string,
  taskId: string,
): Promise<number> {
  try {
    const rules = await findTaskRules(app, ownerId);
    let cancelled = 0;
    for (const rule of rules) {
      if (!appliesTo(rule, taskId)) continue;
      cancelled += await cancelPendingFor(app, 'RULE', `${rule.id}:${taskId}`);
    }
    return cancelled;
  } catch (e) {
    console.warn(`[kaizen] could not withdraw task rules for ${taskId}: ${String(e)}`);
    return 0;
  }
}

/** Renders a thrown value usefully; the SDK throws plain objects. */
function describe(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    const parts = [o['code'], o['statusCode'], o['message']]
      .filter((v) => v !== undefined && v !== null)
      .map(String);
    if (parts.length) return parts.join(' | ');
  }
  return String(e);
}
