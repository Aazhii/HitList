/** A task's custom field values as chips on its card or row — only fields marked "Show on card". */
import { cn } from '@/lib/utils';
import { OPTION_CHIP_CLASS, selectedOptions, valueLabel } from '@/lib/fieldValues';
import type { FieldDef, FieldValue } from '@/types/fields';

interface FieldChipsProps {
  fields: FieldDef[];
  values: Record<string, FieldValue> | undefined;
  /** The host's chip shape, so these match its other chips. */
  chipClass: string;
}

export function FieldChips({ fields, values, chipClass }: FieldChipsProps) {
  if (!values) return null;
  const chips: React.ReactNode[] = [];

  for (const field of fields) {
    if (!field.showOnCard) continue;
    const value = values[field.id];
    if (value === undefined) continue;

    if (field.kind === 'select' || field.kind === 'multi') {
      for (const option of selectedOptions(field, value)) {
        chips.push(
          <span key={`${field.id}:${option.id}`} className={cn(chipClass, OPTION_CHIP_CLASS[option.color])} title={field.name}>
            {option.label}
          </span>,
        );
      }
    } else {
      const label = valueLabel(field, value);
      if (label) {
        chips.push(
          <span key={field.id} className={cn(chipClass, 'text-a-muted shadow-[inset_0_0_0_1px_var(--a-line)]')} title={field.name}>
            {label}
          </span>,
        );
      }
    }
  }

  return chips.length ? <>{chips}</> : null;
}
