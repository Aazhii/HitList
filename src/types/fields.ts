/** Custom task fields, as the client sees them. Mirrors server/fields.ts. */

export type FieldKind = 'select' | 'multi' | 'number' | 'date' | 'checkbox' | 'text';
export type OptionColor = 'accent' | 'sage' | 'do' | 'schedule' | 'delegate' | 'eliminate';

export interface FieldOption { id: string; label: string; color: OptionColor }

export interface FieldDef {
  id: string;
  name: string;
  kind: FieldKind;
  options: FieldOption[];
  fieldOrder: number;
  showOnCard: boolean;
  createdAt: number;
  updatedAt: number;
}

export type FieldValue = string | number | boolean | string[];

/** taskId → fieldId → value. A missing entry means no value. */
export type TaskFieldValues = Record<string, Record<string, FieldValue>>;

export const FIELD_KIND_LABELS: Record<FieldKind, string> = {
  select: 'Select',
  multi: 'Multi-select',
  number: 'Number',
  date: 'Date',
  checkbox: 'Checkbox',
  text: 'Text',
};

export const OPTION_COLORS: OptionColor[] = ['accent', 'sage', 'do', 'schedule', 'delegate', 'eliminate'];
