/**
 * Automation rules, in the database.
 *
 * Until now these lived only in the browser's localStorage, which meant a rule
 * could not fire unless the tab that created it was open — and nothing ever
 * read one anyway. Moving them server-side is what makes them executable.
 *
 * The shape mirrors src/types/automation.ts closely enough that the existing
 * UI keeps working, with the column names the datastore forces on us
 * (`RuleStatus` rather than `Status`, which the queue already uses for
 * something different; see server/catalyst/schema.ts).
 */
import type { CatalystApp } from '../notifications/types.ts';
import { RULES_TABLE } from '../catalyst/schema.ts';
import { zcqlString, unwrapRows, str, num } from '../notifications/zcql.ts';
import type { RecurrenceFrequency } from './recurrence.ts';

export const TRIGGER_TYPES = [
  'due-date', 'overdue', 'recurring', 'status-change', 'daily-digest',
] as const;
export type TriggerType = typeof TRIGGER_TYPES[number];

export const RULE_STATUSES = ['active', 'paused', 'draft'] as const;
export type RuleStatus = typeof RULE_STATUSES[number];

export const URGENCIES = ['low', 'medium', 'high', 'critical'] as const;
export type Urgency = typeof URGENCIES[number];

export const OFFSET_UNITS = ['minutes', 'hours', 'days'] as const;
export type OffsetUnit = typeof OFFSET_UNITS[number];

export interface AutomationRule {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  /** Empty means the rule applies to every task the owner has. */
  taskId: string;
  triggerType: TriggerType;
  status: RuleStatus;
  urgency: Urgency;
  offsetValue: number;
  offsetUnit: OffsetUnit;
  recurrenceFreq: RecurrenceFrequency;
  recurrenceTime: string;
  recurrenceDayOfWeek: number;
  recurrenceDayOfMonth: number;
  notifyInApp: boolean;
  notifyBrowser: boolean;
  notifyEmail: boolean;
  /**
   * The owner's context, captured when the rule is written.
   *
   * The tick runs as the cron with no user session, so it cannot look either
   * of these up. Capturing them on the rule is what lets a rule fire at the
   * right local time and reach the right address without one.
   */
  ownerTimezone: string;
  ownerEmail: string;
  lastTriggeredAt: number;
  /** The planning index. The tick asks for rules due, not for every rule. */
  nextTriggerAt: number;
  createdAt: number;
  updatedAt: number;
}

/** Catalyst's internal row id, which updates and deletes need. */
export interface RuleRow extends AutomationRule {
  rowId: string;
}

const SELECT_COLUMNS =
  'ROWID,RuleId,OwnerId,Name,Description,TaskId,TriggerType,RuleStatus,Urgency,' +
  'OffsetValue,OffsetUnit,RecurrenceFreq,RecurrenceTime,RecurrenceDayOfWeek,' +
  'RecurrenceDayOfMonth,NotifyInApp,NotifyBrowser,NotifyEmail,OwnerTimezone,' +
  'OwnerEmail,LastTriggeredAt,NextTriggerAt,CreatedAt,UpdatedAt';

/**
 * The datastore hands booleans back inconsistently across SDK versions —
 * `true`, `'true'`, and `'1'` have all been observed — so normalise rather
 * than trusting any single form.
 */
function bool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  const s = str(v).toLowerCase();
  return s === 'true' || s === '1';
}

export function toRule(row: Record<string, unknown>): RuleRow {
  return {
    rowId: str(row['ROWID']),
    id: str(row['RuleId']),
    ownerId: str(row['OwnerId']),
    name: str(row['Name']),
    description: str(row['Description']),
    taskId: str(row['TaskId']),
    triggerType: str(row['TriggerType']) as TriggerType,
    status: str(row['RuleStatus']) as RuleStatus,
    urgency: str(row['Urgency']) as Urgency,
    offsetValue: num(row['OffsetValue']),
    offsetUnit: (str(row['OffsetUnit']) || 'minutes') as OffsetUnit,
    recurrenceFreq: (str(row['RecurrenceFreq']) || 'daily') as RecurrenceFrequency,
    recurrenceTime: str(row['RecurrenceTime']),
    recurrenceDayOfWeek: num(row['RecurrenceDayOfWeek']),
    recurrenceDayOfMonth: num(row['RecurrenceDayOfMonth']),
    notifyInApp: bool(row['NotifyInApp']),
    notifyBrowser: bool(row['NotifyBrowser']),
    notifyEmail: bool(row['NotifyEmail']),
    ownerTimezone: str(row['OwnerTimezone']),
    ownerEmail: str(row['OwnerEmail']),
    lastTriggeredAt: num(row['LastTriggeredAt']),
    nextTriggerAt: num(row['NextTriggerAt']),
    createdAt: num(row['CreatedAt']),
    updatedAt: num(row['UpdatedAt']),
  };
}

export function toRow(rule: AutomationRule): Record<string, string> {
  return {
    RuleId: rule.id,
    OwnerId: rule.ownerId,
    Name: rule.name.slice(0, 255),
    Description: rule.description,
    TaskId: rule.taskId,
    TriggerType: rule.triggerType,
    RuleStatus: rule.status,
    Urgency: rule.urgency,
    OffsetValue: String(rule.offsetValue),
    OffsetUnit: rule.offsetUnit,
    RecurrenceFreq: rule.recurrenceFreq,
    RecurrenceTime: rule.recurrenceTime,
    RecurrenceDayOfWeek: String(rule.recurrenceDayOfWeek),
    RecurrenceDayOfMonth: String(rule.recurrenceDayOfMonth),
    NotifyInApp: String(rule.notifyInApp),
    NotifyBrowser: String(rule.notifyBrowser),
    NotifyEmail: String(rule.notifyEmail),
    OwnerTimezone: rule.ownerTimezone,
    OwnerEmail: rule.ownerEmail,
    LastTriggeredAt: String(rule.lastTriggeredAt),
    NextTriggerAt: String(rule.nextTriggerAt),
    CreatedAt: String(rule.createdAt),
    UpdatedAt: String(rule.updatedAt),
  };
}

// ── Reading ───────────────────────────────────────────────────────────────────

export async function listRules(app: CatalystApp, ownerId: string): Promise<RuleRow[]> {
  const results = await app.zcql().executeZCQLQuery(
    `SELECT ${SELECT_COLUMNS} FROM ${RULES_TABLE} ` +
    `WHERE OwnerId = ${zcqlString(ownerId)} ORDER BY CreatedAt DESC`,
  );
  return unwrapRows(results, RULES_TABLE).map(toRule);
}

/** Scoped by owner as well as id: an id alone must not reach another's rule. */
export async function getRule(
  app: CatalystApp, ownerId: string, ruleId: string,
): Promise<RuleRow | null> {
  const results = await app.zcql().executeZCQLQuery(
    `SELECT ${SELECT_COLUMNS} FROM ${RULES_TABLE} ` +
    `WHERE RuleId = ${zcqlString(ruleId)} AND OwnerId = ${zcqlString(ownerId)} LIMIT 1`,
  );
  const rows = unwrapRows(results, RULES_TABLE);
  return rows.length ? toRule(rows[0]) : null;
}

/**
 * Rules that are due to be planned, across every owner.
 *
 * This is the query the tick runs, and the reason NextTriggerAt exists: it
 * asks for the rules that need work rather than walking every rule in the
 * project. A quiet tick reads no rows however many rules exist.
 *
 * `<=` rather than `=` so a missed tick is a late rule, not a lost one — the
 * same self-healing property the queue has.
 */
export async function findDueRules(
  app: CatalystApp, now: number, limit = 100,
): Promise<RuleRow[]> {
  const results = await app.zcql().executeZCQLQuery(
    `SELECT ${SELECT_COLUMNS} FROM ${RULES_TABLE} ` +
    `WHERE RuleStatus = 'active' AND NextTriggerAt > 0 AND NextTriggerAt <= ${Math.floor(now)} ` +
    `ORDER BY NextTriggerAt ASC LIMIT ${limit}`,
  );
  return unwrapRows(results, RULES_TABLE).map(toRule);
}

/**
 * Active rules for one owner, for the event-driven triggers.
 *
 * `status-change` is not a schedule — it fires from the task write path — so
 * it cannot be found by NextTriggerAt and needs this instead.
 */
export async function findRulesByTrigger(
  app: CatalystApp, ownerId: string, triggerType: TriggerType,
): Promise<RuleRow[]> {
  const results = await app.zcql().executeZCQLQuery(
    `SELECT ${SELECT_COLUMNS} FROM ${RULES_TABLE} ` +
    `WHERE OwnerId = ${zcqlString(ownerId)} AND RuleStatus = 'active' ` +
    `AND TriggerType = ${zcqlString(triggerType)}`,
  );
  return unwrapRows(results, RULES_TABLE).map(toRule);
}

// ── Writing ───────────────────────────────────────────────────────────────────

export async function insertRule(app: CatalystApp, rule: AutomationRule): Promise<void> {
  await app.datastore().table(RULES_TABLE).insertRow(toRow(rule));
}

export async function updateRule(
  app: CatalystApp, rowId: string, rule: AutomationRule,
): Promise<void> {
  await app.datastore().table(RULES_TABLE).updateRow({ ROWID: rowId, ...toRow(rule) });
}

/**
 * Records that a rule fired and when it fires next.
 *
 * A narrow update rather than a whole-row write, so it cannot clobber an edit
 * the user made while the tick was running. The old Java scheduler set
 * lastTriggeredAt on a detached entity and never saved it, so its throttle
 * always read null and every rule fired once a minute forever — this is the
 * write that was missing.
 */
export async function markTriggered(
  app: CatalystApp, rowId: string, firedAt: number, nextTriggerAt: number,
): Promise<void> {
  await app.datastore().table(RULES_TABLE).updateRow({
    ROWID: rowId,
    LastTriggeredAt: String(firedAt),
    NextTriggerAt: String(nextTriggerAt),
    UpdatedAt: String(Date.now()),
  });
}

/**
 * Stops a rule being selected again without deleting it.
 *
 * For a rule whose schedule cannot be computed — a malformed time, say. Left
 * due, it would be re-read on every tick forever and fail identically each
 * time; NextTriggerAt = 0 takes it out of the planning query while leaving it
 * visible and editable in the UI.
 */
export async function parkRule(app: CatalystApp, rowId: string): Promise<void> {
  await app.datastore().table(RULES_TABLE).updateRow({
    ROWID: rowId,
    NextTriggerAt: '0',
    UpdatedAt: String(Date.now()),
  });
}

export async function deleteRule(app: CatalystApp, rowId: string): Promise<void> {
  await app.datastore().table(RULES_TABLE).deleteRow(rowId);
}
