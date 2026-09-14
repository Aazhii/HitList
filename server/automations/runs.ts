/**
 * The audit trail — what fired, when, and whether it worked.
 *
 * `useAutomationRuns` in the client has been polling `/api/automation-runs/recent`
 * every 30 seconds against a server with no such route, so this is the table it
 * was always meant to read.
 *
 * It exists for a reason beyond display. Everything else in this system is
 * designed to fail quietly — a reminder that cannot be scheduled must not fail
 * the user's save, a rule that cannot be planned must not abandon the batch —
 * and quiet failure with no record is indistinguishable from nothing having
 * happened. This is where "it did not fire, and here is why" is written down.
 */
import type { CatalystApp } from '../notifications/types.ts';
import { RUNS_TABLE } from '../catalyst/schema.ts';
import { zcqlString, unwrapRows, str, num } from '../notifications/zcql.ts';

export const RUN_STATUSES = ['SUCCESS', 'FAILED', 'SKIPPED'] as const;
export type RunStatus = typeof RUN_STATUSES[number];

export const TRIGGER_SOURCES = ['scheduler', 'manual'] as const;
export type TriggerSource = typeof TRIGGER_SOURCES[number];

export interface AutomationRun {
  id: string;
  ownerId: string;
  ruleId: string;
  /**
   * The rule's name, copied in rather than looked up.
   *
   * The audit trail has to stay readable after the rule is deleted, which is
   * exactly when someone is most likely to be reading it.
   */
  ruleName: string;
  triggeredAt: number;
  status: RunStatus;
  source: TriggerSource;
  detail: string;
  channels: string[];
}

/** How many runs the client can ask for at once. */
export const RUNS_LIMIT = 100;

/**
 * How long runs are kept.
 *
 * Shorter than the queue's retention: a run is diagnostic, and a fortnight is
 * long enough to answer "why did my rule not fire on Tuesday" while keeping
 * the table from becoming the next scaling problem.
 */
export const RUN_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

const SELECT_COLUMNS =
  'ROWID,RunId,OwnerId,RuleId,RuleName,TriggeredAt,RunStatus,TriggerSource,Detail,Channels';

function toRun(row: Record<string, unknown>): AutomationRun {
  return {
    id: str(row['RunId']),
    ownerId: str(row['OwnerId']),
    ruleId: str(row['RuleId']),
    ruleName: str(row['RuleName']),
    triggeredAt: num(row['TriggeredAt']),
    status: str(row['RunStatus']) as RunStatus,
    source: (str(row['TriggerSource']) || 'scheduler') as TriggerSource,
    detail: str(row['Detail']),
    channels: str(row['Channels']).split(',').map((c) => c.trim()).filter(Boolean),
  };
}

export interface RunInput {
  ownerId: string;
  ruleId: string;
  ruleName: string;
  triggeredAt: number;
  status: RunStatus;
  /** Defaults to 'scheduler'; the "Run now" button passes 'manual'. */
  source?: TriggerSource;
  detail: string;
  channels: string[];
}

/**
 * Writes one line of the audit trail.
 *
 * Never throws. This is bookkeeping about something that has already happened,
 * and failing the caller because the record could not be written would turn a
 * successful firing into a reported failure.
 */
export async function recordRun(app: CatalystApp, run: RunInput): Promise<boolean> {
  try {
    await app.datastore().table(RUNS_TABLE).insertRow({
      RunId: crypto.randomUUID(),
      OwnerId: run.ownerId,
      RuleId: run.ruleId,
      RuleName: run.ruleName.slice(0, 255),
      TriggeredAt: String(run.triggeredAt),
      RunStatus: run.status,
      TriggerSource: run.source ?? 'scheduler',
      Detail: run.detail,
      Channels: run.channels.join(','),
    });
    return true;
  } catch (e) {
    console.warn(`[kaizen] could not record automation run for ${run.ruleId}: ${String(e)}`);
    return false;
  }
}

/** Recent runs for one owner, newest first. */
export async function listRuns(
  app: CatalystApp, ownerId: string, limit = 20,
): Promise<AutomationRun[]> {
  const capped = Math.max(1, Math.min(limit, RUNS_LIMIT));
  const results = await app.zcql().executeZCQLQuery(
    `SELECT ${SELECT_COLUMNS} FROM ${RUNS_TABLE} ` +
    `WHERE OwnerId = ${zcqlString(ownerId)} ` +
    `ORDER BY TriggeredAt DESC LIMIT ${capped}`,
  );
  return unwrapRows(results, RUNS_TABLE).map(toRun);
}

/** Recent runs for one rule, newest first. */
export async function listRunsForRule(
  app: CatalystApp, ownerId: string, ruleId: string, limit = 20,
): Promise<AutomationRun[]> {
  const capped = Math.max(1, Math.min(limit, RUNS_LIMIT));
  const results = await app.zcql().executeZCQLQuery(
    `SELECT ${SELECT_COLUMNS} FROM ${RUNS_TABLE} ` +
    `WHERE OwnerId = ${zcqlString(ownerId)} AND RuleId = ${zcqlString(ruleId)} ` +
    `ORDER BY TriggeredAt DESC LIMIT ${capped}`,
  );
  return unwrapRows(results, RUNS_TABLE).map(toRun);
}

/**
 * Clears runs past the retention window.
 *
 * Bounded per tick, like the queue's purge: housekeeping should not be able to
 * turn one tick into a long-running job.
 */
export async function purgeOldRuns(
  app: CatalystApp, now = Date.now(), limit = RUNS_LIMIT,
): Promise<number> {
  const cutoff = now - RUN_RETENTION_MS;
  const results = await app.zcql().executeZCQLQuery(
    `SELECT ROWID FROM ${RUNS_TABLE} WHERE TriggeredAt < ${cutoff} LIMIT ${limit}`,
  );
  const rows = unwrapRows(results, RUNS_TABLE);

  const table = app.datastore().table(RUNS_TABLE);
  for (const row of rows) {
    await table.deleteRow(str(row['ROWID']));
  }
  return rows.length;
}
