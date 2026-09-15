/**
 * Trial features: app-wide switches for the parts of HitList that cost money to
 * keep running.
 *
 * One row per feature in KaizenTrialFeatures, edited by hand in the Data Store
 * console. There are no per-user rows — a switch turns a feature on or off for
 * everyone.
 *
 *   notifications  the five-minute sweep and the hourly tick. Off: the timer is
 *                  not started (or is stopped), and the tick does nothing, so
 *                  nothing keeps AppSail busy between people's own requests.
 *                  Reminders are still written to the queue when tasks change,
 *                  so switching back on delivers the ones still worth sending.
 *   automations    rules. Off: the sweep plans no rule and withdraws rule
 *                  firings as they come due, and "Run now" is refused. Rules
 *                  are still kept in step with task edits, so switching back
 *                  on picks up from the current state of every task.
 *
 * A missing row, or a value that is neither true nor false, counts as ON. That
 * keeps a fresh project — or a typo in the console — behaving the way HitList
 * always has, rather than silently dropping everyone's reminders.
 */
import type { CatalystApp } from './notifications/types.ts';
import type { SweepOptions } from './notifications/sweep.ts';
import { TRIAL_FEATURES_TABLE } from './catalyst/schema.ts';
import { unwrapRows, str } from './notifications/zcql.ts';

export const TRIAL_FEATURE_KEYS = ['notifications', 'automations'] as const;
export type TrialFeatureKey = typeof TRIAL_FEATURE_KEYS[number];
export type TrialFeatures = Record<TrialFeatureKey, boolean>;

/** How long a read is trusted. Turning a feature back on takes at most this long. */
export const TRIAL_FEATURES_CACHE_MS = 60 * 1000;

export const ALL_ENABLED: TrialFeatures = { notifications: true, automations: true };

/** 'true' / 'false' in any case, else null. The SDK hands booleans back as strings. */
export function parseEnabled(value: unknown): boolean | null {
  const v = str(value).trim().toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
}

/** Reads every switch. Throws if the table cannot be read. */
export async function readTrialFeatures(app: CatalystApp): Promise<TrialFeatures> {
  const results = await app.zcql().executeZCQLQuery(
    `SELECT FeatureKey, Enabled FROM ${TRIAL_FEATURES_TABLE} LIMIT 100`,
  );
  const flags: TrialFeatures = { ...ALL_ENABLED };
  for (const row of unwrapRows(results, TRIAL_FEATURES_TABLE)) {
    const key = str(row['FeatureKey']).trim().toLowerCase() as TrialFeatureKey;
    if (!TRIAL_FEATURE_KEYS.includes(key)) continue;
    const enabled = parseEnabled(row['Enabled']);
    if (enabled === null) {
      console.warn(`[kaizen] trial feature ${key}: Enabled is ${JSON.stringify(str(row['Enabled']))}, not true/false — treating as on`);
      continue;
    }
    flags[key] = enabled;
  }
  return flags;
}

export interface TrialFeatureCache {
  /** The switches, re-read from the table once the cached copy is older than the TTL. */
  get: (app: CatalystApp) => Promise<TrialFeatures>;
}

/**
 * A short-lived cache in front of the table, so a request does not cost a query.
 *
 * Concurrent misses share one read. A failed read keeps the last value that was
 * read successfully; with none, everything counts as on — the same answer as an
 * empty table — and the next call tries again.
 */
export function createTrialFeatureCache(
  ttlMs: number = TRIAL_FEATURES_CACHE_MS,
  clock: () => number = Date.now,
): TrialFeatureCache {
  let value: TrialFeatures | null = null;
  let readAt = 0;
  let inFlight: Promise<TrialFeatures> | null = null;

  return {
    get(app) {
      if (value && clock() - readAt < ttlMs) return Promise.resolve(value);
      inFlight ??= readTrialFeatures(app)
        .then((flags) => {
          value = flags;
          readAt = clock();
          return flags;
        })
        .catch((e: unknown) => {
          console.warn(`[kaizen] could not read ${TRIAL_FEATURES_TABLE}: ${String((e as { message?: string })?.message ?? e)}`);
          return value ?? { ...ALL_ENABLED };
        })
        .finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}

/** What one sweep may do under these switches; null means do not sweep at all. */
export function sweepOptionsFor(flags: TrialFeatures): SweepOptions | null {
  if (!flags.notifications) return null;
  return flags.automations ? {} : { skipPlan: true, withdrawRules: true };
}
