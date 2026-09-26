/**
 * The escalation steps of an automation rule, as the editor talks about them.
 *
 * A step is signed minutes from the task's due instant: -60 is an hour before,
 * 0 is the moment it falls due, 30 is half an hour after. The backend stores
 * exactly these numbers — a unit is not
 * stored, because "1 hour" and "60 minutes" are the same instant and picking
 * the larger exact unit back out reads the way the user typed it.
 */

export type StepUnit = 'minutes' | 'hours' | 'days';
export type StepDirection = 'before' | 'after';

export const UNIT_MINUTES: Record<StepUnit, number> = {
  minutes: 1,
  hours: 60,
  days: 24 * 60,
};

/** Matches the backend cap. Every step is a notification. */
export const MAX_STEPS = 8;
export const MAX_STEP_MINUTES = 365 * 24 * 60;

export interface StepParts {
  value: number;
  unit: StepUnit;
  direction: StepDirection;
}

/** The signed minutes a row of the editor describes. */
export function toMinutes({ value, unit, direction }: StepParts): number {
  const magnitude = Math.abs(Math.round(value)) * UNIT_MINUTES[unit];
  return direction === 'before' ? -magnitude : magnitude;
}

/**
 * The editor row for a stored step: the largest unit that divides it exactly,
 * so 60 comes back as "1 hour" rather than "60 minutes".
 */
export function splitMinutes(minutes: number): StepParts {
  const n = Math.round(minutes);
  const direction: StepDirection = n < 0 ? 'before' : 'after';
  const magnitude = Math.abs(n);

  if (magnitude === 0) return { value: 0, unit: 'minutes', direction: 'after' };
  if (magnitude % UNIT_MINUTES.days === 0) {
    return { value: magnitude / UNIT_MINUTES.days, unit: 'days', direction };
  }
  if (magnitude % UNIT_MINUTES.hours === 0) {
    return { value: magnitude / UNIT_MINUTES.hours, unit: 'hours', direction };
  }
  return { value: magnitude, unit: 'minutes', direction };
}

/** A span in words: "45 minutes", "1 hour", "2 days". Mirrors the server. */
export function humanDuration(minutes: number): string {
  const n = Math.abs(Math.round(minutes));
  if (n === 0) return 'no time';
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  if (n % UNIT_MINUTES.days === 0) return plural(n / UNIT_MINUTES.days, 'day');
  if (n % UNIT_MINUTES.hours === 0) return plural(n / UNIT_MINUTES.hours, 'hour');
  return plural(n, 'minute');
}

/** One step in words: "1 hour before due", "when it falls due". */
export function formatStep(minutes: number): string {
  const n = Math.round(minutes);
  if (n === 0) return 'when it falls due';
  return n < 0 ? `${humanDuration(n)} before due` : `${humanDuration(n)} after due`;
}

/** The whole schedule in one line, for a rule's summary. */
export function summarise(steps: readonly number[]): string {
  const ordered = normaliseSteps(steps);
  if (ordered.length === 0) return 'No steps yet';
  return ordered.map(formatStep).join(', then ');
}

/**
 * What gets sent: whole minutes, in range, no duplicates, earliest first,
 * capped. The backend normalises again — this is for the preview and for
 * keeping the editor honest, not a substitute for validation.
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

/** The quick-add chips above the step list. */
export const STEP_PRESETS: ReadonlyArray<{ label: string; minutes: number }> = [
  { label: '5 min before', minutes: -5 },
  { label: '15 min before', minutes: -15 },
  { label: '1 hour before', minutes: -60 },
  { label: '1 day before', minutes: -1440 },
  { label: 'When due', minutes: 0 },
  { label: '30 min after', minutes: 30 },
];
