/**
 * A rule's firing steps.
 *
 * A step is signed minutes relative to the task's due instant: -60 is an hour
 * before, 0 is the moment it falls due, 30 is half an hour after. A rule holds
 * a list of them, which is what lets one rule escalate — an hour before, then
 * five minutes before, then again once it is overdue — where it used to fire
 * exactly once.
 *
 * The list is stored in one column as `-60,-5,0,30`. That column was added
 * after launch, so a rule written before it has an empty value and is read
 * through `stepsForRule()`, which reconstructs the single step the old columns
 * described. Nothing has to be rewritten for old rules to keep behaving
 * identically.
 */

/** A year either side. Beyond that the arithmetic is meaningless, not useful. */
export const MAX_STEP_MINUTES = 365 * 24 * 60;

/**
 * How many steps one rule may hold.
 *
 * A cap exists because every step is a notification: the failure mode of an
 * unbounded list is a user who turns the whole feature off.
 */
export const MAX_STEPS = 8;

/** The shape `stepsForRule` needs. A subset of RuleRow, so tests need no fixture. */
export interface StepSource {
  triggerType: string;
  offsetValue: number;
  offsetUnit: string;
  offsetSteps?: number[];
}

const UNIT_MINUTES: Record<string, number> = {
  minutes: 1,
  hours: 60,
  days: 24 * 60,
};

/** Minutes for a legacy value + unit pair. Unknown units read as minutes. */
export function legacyOffsetMinutes(value: number, unit: string): number {
  return Math.max(0, Math.round(value)) * (UNIT_MINUTES[unit] ?? 1);
}

/**
 * Tidies a list into what is stored: whole minutes, in range, no duplicates,
 * earliest first, capped.
 *
 * Sorting matters beyond neatness — the first step is mirrored into the legacy
 * columns, so it has to be the earliest firing for an older build to do
 * something sensible with it.
 */
export function normaliseSteps(steps: readonly number[]): number[] {
  const seen = new Set<number>();
  for (const raw of steps) {
    if (!Number.isFinite(raw)) continue;
    const n = Math.round(raw);
    if (Math.abs(n) > MAX_STEP_MINUTES) continue;
    seen.add(n);
  }
  return [...seen].sort((a, b) => a - b).slice(0, MAX_STEPS);
}

/** Reads the stored column. Junk is dropped rather than failing the read. */
export function parseSteps(raw: unknown): number[] {
  const text = String(raw ?? '').trim();
  if (!text) return [];
  return normaliseSteps(
    text.split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '')
      .map(Number),
  );
}

/** Writes the column. */
export function formatSteps(steps: readonly number[]): string {
  return normaliseSteps(steps).join(',');
}

/**
 * The steps a rule fires at, including rules written before the column existed.
 *
 * The derivation is the old behaviour exactly: a `due-date` rule fired once, its
 * offset before the due instant; an `overdue` rule fired at the due instant and
 * ignored its offset entirely.
 */
export function stepsForRule(rule: StepSource): number[] {
  if (rule.offsetSteps && rule.offsetSteps.length > 0) return rule.offsetSteps;
  if (rule.triggerType === 'overdue') return [0];
  if (rule.triggerType === 'due-date') {
    return [-legacyOffsetMinutes(rule.offsetValue, rule.offsetUnit)];
  }
  return [];
}

/**
 * The legacy columns to write beside the list, so a rolled-back server still
 * fires something sensible: the earliest step, in the largest unit that divides
 * it exactly.
 */
export function legacyColumnsFor(steps: readonly number[]): { value: number; unit: string } {
  const first = normaliseSteps(steps)[0];
  if (first === undefined) return { value: 0, unit: 'minutes' };
  const minutes = Math.abs(first);
  if (minutes === 0) return { value: 0, unit: 'minutes' };
  if (minutes % UNIT_MINUTES.days === 0) return { value: minutes / UNIT_MINUTES.days, unit: 'days' };
  if (minutes % UNIT_MINUTES.hours === 0) return { value: minutes / UNIT_MINUTES.hours, unit: 'hours' };
  return { value: minutes, unit: 'minutes' };
}
