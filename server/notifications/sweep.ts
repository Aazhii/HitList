/**
 * The sweep — what a cron tick actually runs.
 *
 * Two phases:
 *
 *   DRAIN  deliver everything in the queue whose FireAt has arrived
 *   PURGE  clear delivered rows past the retention window
 *
 * (A PLAN phase, evaluating automation rules to enqueue their next firing,
 * joins this once rules move server-side. The shape is deliberately ready for
 * it: planning is just another producer of queue rows.)
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
  purgeOldEntries,
  SWEEP_LIMIT,
  type QueueRow,
} from './queue.ts';
import { deliver, summarise } from './channels.ts';

export interface SweepReport {
  /** Rows found due on this tick. */
  due: number;
  delivered: number;
  failed: number;
  /** Delivered rows removed past the retention window. */
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
    due: 0, delivered: 0, failed: 0, purged: 0, durationMs: 0, details: [],
  };

  const dueRows = await findDue(app, now, limit);
  report.due = dueRows.length;

  for (const row of dueRows) {
    await deliverOne(app, row, report);
  }

  if (!options.skipPurge) {
    try {
      report.purged = await purgeOldEntries(app, now);
    } catch (e) {
      // Housekeeping must never fail a tick that delivered successfully.
      report.details.push(`purge failed: ${String(e)}`);
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

/** One-line summary for the server log. */
export function describeSweep(report: SweepReport): string {
  return `due=${report.due} delivered=${report.delivered} failed=${report.failed} ` +
    `purged=${report.purged} in ${report.durationMs}ms`;
}
