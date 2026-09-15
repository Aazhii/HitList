/**
 * Driving the sweep from inside the server.
 *
 * The plan for this work said an in-process interval was the wrong answer,
 * because AppSail auto-scales to 1–5 instances and an interval would run on
 * every one of them and fire each reminder up to five times.
 *
 * The first half of that is true. The second is not, and the difference is the
 * claim: a sweep writes a ClaimToken and re-reads it before touching any
 * channel, so of N sweeps racing the same row, exactly one delivers. That is
 * not an assumption — src/test/sweep.test.ts runs two sweeps concurrently and
 * asserts one email and one inbox row. Concurrency here is wasteful, not
 * unsafe: the cost of a second instance is one indexed query that returns
 * nothing.
 *
 * What made this necessary is that Catalyst's crons could not be made to run
 * every five minutes:
 *
 *   - `Periodic` refuses any interval under 60 minutes
 *   - `CronExpression` accepts a five-minute step expression and never fires —
 *     created with cron_status true, it sat at success_count 0, failure_count 0
 *   - an `AppSail` target fails on invocation, where a `Webhook` target to the
 *     same URL succeeds
 *
 * So the interval is the primary driver, and an hourly webhook cron is the
 * backstop for the case this cannot cover: a container that has been idle long
 * enough to be stopped has no interval running either. See
 * scripts/register-cron.ts.
 *
 * POST /api/internal/tick remains, and is what the backstop calls.
 */
import type { CatalystApp } from './types.ts';
import { runSweep, describeSweep, type SweepReport, type SweepOptions } from './sweep.ts';

/**
 * How often the sweep runs.
 *
 * The one number that governs both precision and cost. Every tick is one
 * indexed query that normally returns nothing, so five minutes means a
 * reminder is at worst five minutes early — which nobody notices — at 288
 * queries a day per instance.
 */
export const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/** Don't let a misconfiguration turn this into a busy loop. */
const MIN_INTERVAL_MS = 30 * 1000;

export interface SchedulerOptions {
  intervalMs?: number;
  /** Called after each tick. Defaults to logging anything interesting. */
  onTick?: (report: SweepReport) => void;
  onError?: (error: unknown) => void;
  /**
   * Runs before each tick with the resolved app. Returns the options for this
   * sweep, or null to skip the tick. How the trial-feature switches reach the
   * timer — see server/trialFeatures.ts.
   */
  prepareTick?: (app: CatalystApp) => Promise<SweepOptions | null>;
}

export interface Scheduler {
  stop: () => void;
  /** Runs one tick immediately, outside the schedule. */
  runNow: () => Promise<void>;
}

/** The interval, from SWEEP_INTERVAL_MS, clamped to something sane. */
export function intervalFromEnv(): number {
  const raw = Number(process.env['SWEEP_INTERVAL_MS'] ?? '');
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, raw);
}

/** True unless SWEEP_DISABLED is set to something truthy. */
export function schedulerEnabled(): boolean {
  const raw = (process.env['SWEEP_DISABLED'] ?? '').trim().toLowerCase();
  return raw !== '1' && raw !== 'true' && raw !== 'yes';
}

function defaultOnTick(report: SweepReport): void {
  // A quiet tick says nothing. At 288 ticks a day per instance, logging every
  // one would bury the ticks that did something.
  if (report.due === 0 && report.rulesDue === 0 && report.reclaimed === 0 && report.discarded === 0) return;

  console.log(`[kaizen] sweep ${describeSweep(report)}`);
  for (const line of report.details) console.log(`[kaizen]   ${line}`);
}

/**
 * Starts sweeping on an interval.
 *
 * Ticks never overlap: a tick that is still running when the next is due skips
 * that slot rather than stacking. Overlapping ticks would be safe — the claim
 * sees to that — but they would also mean a slow datastore quietly turning
 * into an unbounded number of in-flight sweeps.
 *
 * The timer is unref'd so it cannot by itself keep the process alive. A server
 * that is otherwise finished should exit, not linger because a sweep is
 * pending.
 */
export function startScheduler(
  resolveApp: () => CatalystApp,
  options: SchedulerOptions = {},
): Scheduler {
  const intervalMs = options.intervalMs ?? intervalFromEnv();
  const onTick = options.onTick ?? defaultOnTick;
  const onError = options.onError
    ?? ((e: unknown) => console.warn(`[kaizen] sweep failed: ${String(e)}`));

  let running = false;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const app = resolveApp();
      const sweepOptions = options.prepareTick ? await options.prepareTick(app) : {};
      if (sweepOptions) onTick(await runSweep(app, sweepOptions));
    } catch (e) {
      // A failed tick must never take the server down with it. The next one
      // picks up whatever this one left, because the queue is state in the
      // database rather than in this process.
      onError(e);
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => { void tick(); }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  return {
    stop: () => clearInterval(timer),
    runNow: tick,
  };
}
