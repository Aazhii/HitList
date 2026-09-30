/**
 * One record on a board (showcase 755): a white bordered card with the title and one grey line of
 * the fields marked "show on card", joined with commas — not chips.
 *
 * Deliberately not MatrixTaskCard: a task has a status, a due date and a note link; a record has
 * none of them.
 */
import { cn } from '@/lib/utils';
import type { ApiDatabaseRow } from '@/lib/api';
import type { FieldDef, FieldValue } from '@/types/fields';

export interface RecordCardProps {
  record: ApiDatabaseRow;
  fields: FieldDef[];
  values: Record<string, FieldValue> | undefined;
  /** The field the board's lanes come from: already said by the lane, so not repeated. */
  laneFieldId?: string;
  className?: string;
}

/** "Software, Product" — what a card's second line says. */
export function cardMeta(fields: FieldDef[], values: Record<string, FieldValue> | undefined, laneFieldId?: string): string {
  if (!values) return '';
  return fields
    .filter((f) => f.showOnCard && f.id !== laneFieldId && values[f.id] !== undefined && values[f.id] !== null)
    .map((f) => {
      const v = values[f.id];
      if (f.kind === 'select' || f.kind === 'multi') {
        const ids = Array.isArray(v) ? v : [String(v)];
        return ids.map((id) => f.options.find((o) => o.id === id)?.label).filter(Boolean).join(', ');
      }
      if (f.kind === 'checkbox') return v === true ? f.name : '';
      return String(v);
    })
    .filter(Boolean)
    .join(', ');
}

export function RecordCard({ record, fields, values, laneFieldId, className }: RecordCardProps) {
  const meta = cardMeta(fields, values, laneFieldId);
  return (
    <article className={cn('rounded-[8px] border border-a-line bg-a-surface px-3 py-2.5', className)}>
      <div className="text-[13px] font-medium text-a-ink">{record.title}</div>
      {meta && <div className="mt-1 text-[12px] text-a-faint">{meta}</div>}
    </article>
  );
}
