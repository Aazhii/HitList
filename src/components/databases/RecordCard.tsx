/**
 * One record on a board: its title, and chips for the fields marked "show on
 * card".
 *
 * Deliberately not MatrixTaskCard. That card is a status box, a due chip, a
 * reminder bell, a category and a link back to a note — a task has all of those
 * and a record has none of them. What they share is FieldChips, which already
 * filters on showOnCard, so a field looks the same wherever it appears.
 */
import { cn } from '@/lib/utils';
import { FieldChips } from '@/components/fields/FieldChips';
import type { ApiDatabaseRow } from '@/lib/api';
import type { FieldDef, FieldValue } from '@/types/fields';

const CHIP = 'inline-flex items-center rounded-full px-2.5 py-[3px] text-[12px] leading-none whitespace-nowrap';

export interface RecordCardProps {
  record: ApiDatabaseRow;
  fields: FieldDef[];
  values: Record<string, FieldValue> | undefined;
  className?: string;
}

export function RecordCard({ record, fields, values, className }: RecordCardProps) {
  return (
    <article
      className={cn(
        'flex flex-col gap-[7px] rounded-[14px] bg-a-bg px-[14px] py-[10px]',
        'shadow-[inset_0_0_0_1px_var(--a-line-soft)]',
        className,
      )}
    >
      <p className="text-[14.5px] leading-snug text-a-ink">{record.title}</p>

      <div className="flex flex-wrap items-center gap-1.5 empty:hidden">
        <FieldChips fields={fields} values={values} chipClass={CHIP} />
      </div>
    </article>
  );
}
