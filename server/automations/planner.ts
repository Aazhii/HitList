/**
 * Turning a rule into work.
 *
 * The sweep's PLAN phase: for each rule whose NextTriggerAt has arrived,
 * enqueue what it should deliver and advance it to its next firing. Planning is
 * just another producer of queue rows — everything downstream (claiming,
 * delivery, retries, exactly-once) is the machinery the reminders already use.
 *
 * The ordering here is the whole safety argument, and it is the opposite of
 * the obvious one:
 *
 *   1. enqueue (idempotent, guarded by a unique DedupeKey)
 *   2. advance NextTriggerAt
 *
 * If we advanced first and then crashed, the firing would be lost with nothing
 * to show for it. Enqueuing first means a crash between the two leaves the rule
 * due again, the same DedupeKey is computed, and the duplicate enqueue is
 * refused. Late and correct beats early and missing.
 *
 * The failure this deliberately does not repeat is in the dead Java scheduler:
 * it set `lastTriggeredAt` on a detached JPA entity and never saved it, so its
 * throttle always read null and every rule fired once a minute forever. The
 * throttle here is a row in the database — NextTriggerAt — plus the DedupeKey,
 * not a field in memory.
 */
import type { CatalystApp } from '../notifications/types.ts';
import { enqueue, type QueueEntry } from '../notifications/queue.ts';
import { nextRecurrence, recurrenceDedupeKey, type Recurrence } from './recurrence.ts';
import { markTriggered, parkRule, type RuleRow } from './rules.ts';
import { recordRun } from './runs.ts';

/** How many rules one tick will plan. Bounds the work a single tick can do. */
export const PLAN_LIMIT = 100;

/** Who the rule fires for, and in which zone its clock runs. */
export interface PlanContext {
  timeZone: string;
  /** Delivery address; empty means the email channel skips. */
  email: string;
}

export interface PlanOutcome {
  ruleId: string;
  /** A queue row was written. */
  enqueued: boolean;
  /** The instant the rule fires next, or 0 when it has been parked. */
  nextTriggerAt: number;
  detail: string;
  error?: string;
}

/** The channels a rule asked for, in the queue's vocabulary. */
export function channelsFor(rule: RuleRow): string[] {
  const channels: string[] = [];
  // In-app is the default when a rule asks for nothing: a rule that fires and
  // delivers nowhere is indistinguishable from one that did not fire.
  if (rule.notifyInApp || (!rule.notifyBrowser && !rule.notifyEmail)) channels.push('inapp');
  if (rule.notifyBrowser) channels.push('webpush');
  if (rule.notifyEmail) channels.push('email');
  return channels;
}

/** The recurrence a rule describes. */
export function recurrenceOf(rule: RuleRow): Recurrence {
  return {
    frequency: rule.recurrenceFreq,
    time: rule.recurrenceTime,
    dayOfWeek: rule.recurrenceDayOfWeek,
    dayOfMonth: rule.recurrenceDayOfMonth,
  };
}

/**
 * The instant a rule first becomes due, when it is created or edited.
 *
 * Only the schedule-driven triggers get one. `due-date` and `overdue` hang off
 * a task's own dates and are planned from the task write path, and
 * `status-change` is an event rather than a schedule — giving any of them a
 * NextTriggerAt would put them in the planning query, where they have nothing
 * to do.
 */
export function initialTrigger(rule: RuleRow, timeZone: string, from = Date.now()): number {
  if (rule.status !== 'active') return 0;
  if (rule.triggerType !== 'recurring' && rule.triggerType !== 'daily-digest') return 0;
  return nextRecurrence(recurrenceOf(rule), timeZone, from) ?? 0;
}

/** What the notification says. Rendered here so the sweep does no formatting. */
export function renderRule(rule: RuleRow): { title: string; body: string } {
  const title = rule.name || 'Automation';

  if (rule.triggerType === 'daily-digest') {
    return {
      title,
      body: rule.description || 'Your daily summary is ready.',
    };
  }

  return {
    title,
    body: rule.description || 'This automation fired.',
  };
}

/**
 * Plans one rule: enqueue its firing, then advance it.
 *
 * Never throws. One rule that cannot be planned must not abandon the rest of
 * the batch, and a tick that delivered successfully must not be failed by
 * bookkeeping afterwards.
 */
export async function planRule(
  app: CatalystApp,
  rule: RuleRow,
  ctx: PlanContext,
  now = Date.now(),
): Promise<PlanOutcome> {
  try {
    const fireAt = rule.nextTriggerAt;
    const upcoming = nextRecurrence(recurrenceOf(rule), ctx.timeZone, Math.max(fireAt, now));

    if (upcoming === null) {
      // The schedule cannot be computed — a malformed time, most likely. Park
      // it rather than leaving it due, or it would be re-read and fail
      // identically on every tick from now on.
      await parkRule(app, rule.rowId);
      await recordRun(app, {
        ownerId: rule.ownerId, ruleId: rule.id, ruleName: rule.name, triggeredAt: now,
        status: 'SKIPPED', detail: 'schedule could not be computed; rule parked',
        channels: channelsFor(rule),
      });
      return {
        ruleId: rule.id, enqueued: false, nextTriggerAt: 0,
        detail: 'schedule could not be computed; parked',
      };
    }

    const { title, body } = renderRule(rule);
    const entry: QueueEntry = {
      ownerId: rule.ownerId,
      fireAt,
      dedupeKey: recurrenceDedupeKey(rule.id, fireAt),
      kind: rule.triggerType === 'daily-digest' ? 'DIGEST' : 'AUTOMATION',
      sourceType: 'RULE',
      sourceId: rule.id,
      channels: channelsFor(rule),
      title,
      body,
      payload: {
        email: ctx.email,
        ruleId: rule.id,
        urgency: rule.urgency,
        ...(rule.taskId ? { taskId: rule.taskId } : {}),
      },
    };

    // Enqueue BEFORE advancing. A crash between the two leaves the rule due,
    // recomputes the same DedupeKey, and the duplicate is refused — so the
    // firing is delivered late rather than lost.
    const enqueued = await enqueue(app, entry);
    await markTriggered(app, rule.rowId, now, upcoming);

    await recordRun(app, {
      ownerId: rule.ownerId, ruleId: rule.id, ruleName: rule.name, triggeredAt: now,
      status: 'SUCCESS',
      detail: enqueued ? 'queued for delivery' : 'already queued for this firing',
      channels: entry.channels,
    });

    return {
      ruleId: rule.id,
      enqueued,
      nextTriggerAt: upcoming,
      detail: `${enqueued ? 'queued' : 'already queued'}; next ${new Date(upcoming).toISOString()}`,
    };
  } catch (e) {
    const detail = describe(e);
    // Best-effort audit line. If this write is what failed, there is nothing
    // more to be done than report it upward.
    await recordRun(app, {
      ownerId: rule.ownerId, ruleId: rule.id, ruleName: rule.name, triggeredAt: now,
      status: 'FAILED', detail, channels: channelsFor(rule),
    }).catch(() => { /* already failing */ });

    return {
      ruleId: rule.id, enqueued: false, nextTriggerAt: rule.nextTriggerAt,
      detail: `plan failed: ${detail}`, error: detail,
    };
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
