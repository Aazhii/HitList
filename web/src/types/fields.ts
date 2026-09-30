/** Custom task fields, as the client sees them. */

export type FieldKind = 'select' | 'multi' | 'number' | 'date' | 'checkbox' | 'text' | 'longtext';
/**
 * `accent`/`sage`/`do`/`schedule`/`delegate`/`eliminate` are legacy: options
 * created before the dedicated tag palette below. Kept so those options keep
 * rendering — `OPTION_COLORS` (what a new option offers) no longer includes
 * them.
 */
export type OptionColor =
  | 'accent' | 'sage' | 'do' | 'schedule' | 'delegate' | 'eliminate'
  | 'gray' | 'brown' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'red';

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
  longtext: 'Text area',
};

/**
 * Kinds that store a plain string and accept the same values, so switching
 * between them keeps every cell's contents. The server agrees — see
 * WorkspaceService.interchangeable(), which is what stops the type change from
 * cloaking the column.
 */
export const TEXTUAL_KINDS: readonly FieldKind[] = ['text', 'longtext'];

export const OPTION_COLORS: OptionColor[] = [
  'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red',
];
