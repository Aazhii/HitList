/**
 * Repeating tasks (P6.2). The server owns the behaviour — finishing a repeating task creates the next one —
 * so this is only the vocabulary: the four choices, their labels, and the wire spelling.
 */
export type Recurrence = 'daily' | 'weekdays' | 'weekly' | 'monthly';

export const RECURRENCE_OPTIONS: ReadonlyArray<{ value: Recurrence; label: string }> = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Every weekday' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
];

/** '' (or undefined) is a task that does not repeat. */
export const recurrenceLabel = (r: Recurrence | '' | undefined): string =>
  RECURRENCE_OPTIONS.find((o) => o.value === r)?.label ?? 'Does not repeat';

export const toApiRecurrence = (r: Recurrence | ''): string => r.toUpperCase();

export function fromApiRecurrence(value: string | null | undefined): Recurrence | undefined {
  const v = (value ?? '').toLowerCase();
  return RECURRENCE_OPTIONS.some((o) => o.value === v) ? (v as Recurrence) : undefined;
}
