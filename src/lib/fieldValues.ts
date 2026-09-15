/**
 * Displaying custom field values. Token classes only, so option colours follow
 * the light and dark palettes.
 */
import type { FieldDef, FieldOption, FieldValue, OptionColor } from '@/types/fields';

export const OPTION_CHIP_CLASS: Record<OptionColor, string> = {
  accent: 'bg-a-accent-tint text-a-accent-700',
  sage: 'bg-a-sage-tint text-a-sage-ink',
  do: 'bg-q-do-bg text-q-do',
  schedule: 'bg-q-schedule-bg text-q-schedule',
  delegate: 'bg-q-delegate-bg text-q-delegate',
  eliminate: 'bg-q-eliminate-bg text-q-eliminate',
};

export const OPTION_DOT_CLASS: Record<OptionColor, string> = {
  accent: 'bg-a-accent',
  sage: 'bg-a-sage',
  do: 'bg-q-do',
  schedule: 'bg-q-schedule',
  delegate: 'bg-q-delegate',
  eliminate: 'bg-q-eliminate',
};

/** The options a select or multi value refers to, in the field's order. Removed options are skipped. */
export function selectedOptions(def: FieldDef, value: FieldValue | undefined): FieldOption[] {
  if (value === undefined) return [];
  const chosen = new Set(Array.isArray(value) ? value : typeof value === 'string' ? [value] : []);
  return def.options.filter((o) => chosen.has(o.id));
}

function formatDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

/**
 * A short label for a card chip, or null when there is nothing to show.
 * Select and multi values are shown as coloured chips instead — see selectedOptions.
 */
export function valueLabel(def: FieldDef, value: FieldValue | undefined): string | null {
  if (value === undefined) return null;
  switch (def.kind) {
    case 'number': return typeof value === 'number' ? `${def.name}: ${value.toLocaleString()}` : null;
    case 'date': return typeof value === 'string' ? `${def.name}: ${formatDate(value)}` : null;
    case 'checkbox': return value === true ? `✓ ${def.name}` : null;
    case 'text': {
      if (typeof value !== 'string' || !value.trim()) return null;
      const t = value.trim();
      return t.length > 28 ? `${t.slice(0, 27)}…` : t;
    }
    default: return null;
  }
}
