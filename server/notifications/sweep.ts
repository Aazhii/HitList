/**
 * The sweep — what a cron tick actually runs.
 *
 * Four phases:
 *
 *   RECLAIM return rows abandoned mid-delivery to the queue
 *   DRAIN  deliver everything in the queue whose FireAt has arrived
 *   PLAN   enqueue the next firing of every automation rule that is due
 *   PURGE  clear delivered rows and old run records past retention
 *
 * DRAIN runs before PLAN deliberately. A rule planned this tick sets a FireAt
 * in the future, so draining first costs nothing — while planning first would
 * occasionally deliver a rule in the same tick that scheduled it, making the
 * rule's timing depend on the order two phases happen to run in.
 *
 * The whole design rests on this being cheap. A tick with nothing due runs one
 * indexed query that returns no rows and stops — which is what makes it
 * affordable to run every few minutes, and what keeps the cost flat as the
 * database grows.
 *
 * Ordering matters for safety: each row is CLAIMED before anything is
 * delivered. A message sent twice cannot be recalled, whereas a row left in
 * SENDING can be picked up later. See queue.ts.
 */
import type { CatalystApp } from './types.ts';
import {
  findDue,
  claim,
  markSent,
  markFailed,
  markUndeliverable,
  reclaimStale,
  purgeOldEntries,
  SWEEP_LIMIT,
  type QueueRow,
} from './queue.ts';
import { deliver, summarise } from './channels.ts';
import { findDueRules } from '../automations/rules.ts';
import { planRule, PLAN_LIMIT } from '../automations/planner.ts';
import { purgeOldRuns } from '../automations/runs.ts';

export interface SweepReport {
  /** Rows found due on this tick. */
  due: number;
  delivered: number;
  failed: number;
  /** Automation rules whose NextTriggerAt had arrived. */
  rulesDue: number;
  /** Rules that enqueued a firing. */
  rulesPlanned: number;
  /** Rows abandoned mid-delivery and returned to the queue. */
  reclaimed: number;
  /** Delivered rows and old runs removed past their retention windows. */
  purged: number;
  /** Milliseconds the tick took, so a slow sweep is visible in the logs. */
  durationMs: number;
  details: string[];
}

export interface SweepOptions {
  now?: number;
  limit?: number;
  /** Skip retention this tick. */
  skipPurge?: boolean;
  /** Skip rule planning this tick. */
  skipPlan?: boolean;
  /** Skip reclaiming abandoned rows this tick. */
  skipReclaim?: boolean;
}

/**
 * Runs one tick.
 *
 * Never throws for a per-row failure: one bad entry must not abandon the rest
 * of the batch. A failure that is worth retrying returns the row to PENDING,
 * and the next tick picks it up.
 */
export async function runSweep(
  app: CatalystApp,
  options: SweepOptions = {},
): Promise<SweepReport> {
  const startedAt = Date.now();
  const now = options.now ?? startedAt;
  const limit = options.limit ?? SWEEP_LIMIT;

  const report: SweepReport = {
    due: 0, delivered: 0, failed: 0, rulesDue: 0, rulesPlanned: 0,
    reclaimed: 0, purged: 0, durationMs: 0, details: [],
  };

  // ── RECLAIM ──
  // Before draining, so a row freed this tick is delivered on this tick rather
  // than waiting for the next one.
  if (!options.skipReclaim) {
    try {
      report.reclaimed = await reclaimStale(app, now, limit);
      if (report.reclaimed > 0) {
        report.details.push(`reclaimed ${report.reclaimed} abandoned mid-delivery`);
      }
    } catch (e) {
      // Never fail a tick over the backstop; the rows stay stranded one longer.
      report.details.push(`reclaim failed: ${String(e)}`);
    }
  }

  // ── DRAIN ──
  const dueRows = await findDue(app, now, limit);
  report.due = dueRows.length;

  for (const row of dueRows) {
    await deliverOne(app, row, report);
  }

  // ── PLAN ──
  if (!options.skipPlan) {
    try {
      await planDueRules(app, now, report);
    } catch (e) {
      // A planning failure must not cost the deliveries this tick already
      // made, nor stop the purge that keeps the tables bounded.
      report.details.push(`planning failed: ${String(e)}`);
    }
  }

  // ── PURGE ──
  if (!options.skipPurge) {
    try {
      report.purged = await purgeOldEntries(app, now);
    } catch (e) {
      // Housekeeping must never fail a tick that delivered successfully.
      report.details.push(`purge failed: ${String(e)}`);
    }
    try {
      report.purged += await purgeOldRuns(app, now);
    } catch (e) {
      report.details.push(`run purge failed: ${String(e)}`);
    }
  }

  report.durationMs = Date.now() - startedAt;
  return report;
}

async function deliverOne(app: CatalystApp, row: QueueRow, report: SweepReport): Promise<void> {
  // Claim FIRST, and only proceed if we actually won the row. This is what
  // stops two AppSail instances, or a retried tick, delivering the same
  // reminder twice.
  let won = false;
  try {
    won = await claim(app, row);
  } catch (e) {
    report.details.push(`${row.queueId} claim errored: ${String(e)}`);
    return;
  }
  if (!won) {
    // Another sweep got there first. Expected, not an error.
    report.details.push(`${row.queueId} claimed by another sweep`);
    return;
  }

  const result = await deliver(app, row);
  const summary = summarise(result);

  if (result.anyDelivered) {
    await markSent(app, row);
    report.delivered++;
    report.details.push(`${row.queueId} sent — ${summary}`);
    return;
  }

  if (result.anyRetryable) {
    await markFailed(app, row, summary);
    report.failed++;
    report.details.push(`${row.queueId} failed — ${summary}`);
    return;
  }

  // Nothing delivered and nothing worth retrying: every channel was disabled,
  // unknown, or missing configuration. Retrying cannot fix any of those, so the
  // row is failed outright rather than being returned to PENDING to fail
  // identically on every tick until its attempts run out. Marking it sent would
  // be a lie; the reason is recorded so the cause is visible.
  await markUndeliverable(app, row, `no channel could deliver — ${summary}`);
  report.failed++;
  report.details.push(`${row.queueId} undeliverable — ${summary}`);
}

/**
 * Plans every rule whose NextTriggerAt has arrived.
 *
 * The owner's timezone and address come off the rule itself, captured when it
 * was written from a signed-in request. The cron has no session, so there is
 * nowhere else they could come from — see the OwnerTimezone column in
 * server/catalyst/schema.ts.
 */
async function planDueRules(app: CatalystApp, now: number, report: SweepReport): Promise<void> {
  const rules = await findDueRules(app, now, PLAN_LIMIT);
  report.rulesDue = rules.length;

  for (const rule of rules) {
    const outcome = await planRule(app, rule, {
      // UTC is a visible wrong answer rather than a crash, for a rule written
      // before the column existed. The backfill refreshes it.
      timeZone: rule.ownerTimezone || 'UTC',
      email: rule.ownerEmail,
    }, now);

    if (outcome.enqueued) report.rulesPlanned++;
    if (outcome.error || outcome.enqueued) {
      report.details.push(`rule ${outcome.ruleId} ${outcome.detail}`);
    }
  }
}

/** One-line summary for the server log. */
export function describeSweep(report: SweepReport): string {
  return `due=${report.due} delivered=${report.delivered} failed=${report.failed} ` +
    `rulesDue=${report.rulesDue} rulesPlanned=${report.rulesPlanned} ` +
    `reclaimed=${report.reclaimed} purged=${report.purged} in ${report.durationMs}ms`;
}
