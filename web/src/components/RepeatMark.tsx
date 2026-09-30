import { Repeat } from 'lucide-react';
import { recurrenceLabel } from '@/lib/recurrence';
import type { Recurrence } from '@/lib/recurrence';

/** A small repeat glyph beside a due date, for a task that repeats. Nothing for one that does not. */
export function RepeatMark({ recurrence }: { recurrence?: Recurrence | '' }) {
  if (!recurrence) return null;
  return (
    <Repeat
      className="ml-1 inline-block size-3 align-[-1px]"
      strokeWidth={1.75}
      role="img"
      aria-label={recurrenceLabel(recurrence)}
    />
  );
}
