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
import { toRule, type RuleRow } from './rules.ts';
import { channelsFor, renderRule } from './planner.ts';
import { recordRun } from './runs.ts';
import { zonedToEpoch, END_OF_DAY, type SchedulableTask } from '../notifications/schedule.ts';

/** The triggers this module owns. */
const TASK_TRIGGERS = ['due-date', 'overdue', 'status-change'] as const;

const SELECT_COLUMNS =
  'ROWID,RuleId,OwnerId,Name,Description,TaskId,TriggerType,RuleStatus,Urgency,' +
  'OffsetValue,OffsetUnit,RecurrenceFreq,RecurrenceTime,RecurrenceDayOfWeek,' +
  'RecurrenceDayOfMonth,NotifyInApp,NotifyBrowser,NotifyEmail,OwnerTimezone,' +
  'OwnerEmail,LastTriggeredAt,NextTriggerAt,CreatedAt,UpdatedAt';

/**
 * The owner's active task-driven rules, in one query.
 *
 * All three trigger types come back together rather than in three round trips:
 * this runs on every task write, so the query count is what it costs.
 */
export async function findTaskRules(app: CatalystApp, ownerId: string): Promise<RuleRow[]> {
  const list = TASK_TRIGGERS.map(zcqlString).join(', ');
  const results = await app.zcql().executeZCQLQuery(
    `SELECT ${SELECT_COLUMNS} FROM ${RULES_TABLE} ` +
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
  // A completed task has nothing left to remind anyone about.
  if (task.status === 'DONE' || task.status === 'done') return null;

  switch (rule.triggerType) {
    case 'due-date': {
      if (!task.dueDate) return null;
      const dueAt = zonedToEpoch(task.dueDate, task.dueTime || END_OF_DAY, timeZone);
      return dueAt === null ? null : dueAt - offsetMs(rule);
    }

    case 'overdue': {
      if (!task.dueDate) return null;
      const dueAt = zonedToEpoch(task.dueDate, task.dueTime || END_OF_DAY, timeZone);
      // Fires at the due instant itself: "overdue" begins the moment it passes.
      return dueAt;
    }

    case 'status-change': {
      // An event, not a schedule. It fires now, and only when the status
      // actually moved — re-saving a task with the same status must not
      // produce a notification.
      return now;
    }

    default:
      return null;
  }
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
      if (!appliesTo(rule, task.id)) continue;
      result.evaluated++;

      // status-change fires only on an actual transition. Without this, every
      // save of an unchanged task would notify.
      if (rule.triggerType === 'status-change') {
        if (ctx.previousStatus === undefined || ctx.previousStatus === task.status) continue;
      }

      const fireAt = fireAtFor(rule, task, ctx.timeZone, now);

      if (fireAt === null) {
        // The rule no longer has anything to fire for this task — the due date
        // was cleared, or the task was completed. Withdraw what it had queued.
        const cancelled = await cancelPendingFor(app, 'RULE', `${rule.id}:${task.id}`);
        result.cancelled += cancelled;
        continue;
      }

      const { title, body } = renderRule(rule);
      const channels = channelsFor(rule);
      const dedupeKey = taskRuleDedupeKey(rule.id, task.id, fireAt);

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
        },
      });

      // status-change fires once per event, so there is nothing to supersede:
      // each transition is its own instant and its own key.
      if (rule.triggerType !== 'status-change') {
        result.cancelled += await cancelSupersededFor(
          app, 'RULE', `${rule.id}:${task.id}`, dedupeKey,
        );
      }

      if (enqueued) {
        result.enqueued++;
        result.details.push(
          `${rule.id} → ${task.id} at ${new Date(fireAt).toISOString()}`,
        );
        await recordRun(app, {
          ownerId: ctx.ownerId, ruleId: rule.id, ruleName: rule.name, triggeredAt: now,
          status: 'SUCCESS', detail: `queued for ${task.title}`, channels,
        });
      }
    }

    return result;
  } catch (e) {
    return { ...result, error: describe(e) };
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
