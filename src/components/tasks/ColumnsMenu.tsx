/**
 * Which columns a table shows, and in what order.
 *
 * Reordering is up/down buttons rather than dragging: this list lives inside a
 * popover, and a drag inside a popover fights the popover's own dismissal. The
 * buttons also work from the keyboard, which a drag does not.
 *
 * Title is always shown — a table of untitled rows is unreadable — so it has no
 * switch. The choices are saved with a view when one is open, and otherwise
 * remembered for the list in the browser.
 */
import { ArrowDown, ArrowUp, Columns3, Eye, EyeOff, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface ColumnChoice {
  id: string;
  label: string;
  /** Title cannot be hidden. */
  fixed?: boolean;
}

export interface ColumnsMenuProps {
  /** Every column, already in the order the table shows them. */
  columns: ColumnChoice[];
  hidden: string[];
  onToggle: (columnId: string) => void;
  onMove: (columnId: string, direction: -1 | 1) => void;
  onReset: () => void;
}

export function ColumnsMenu({ columns, hidden, onToggle, onMove, onReset }: ColumnsMenuProps) {
  const hiddenSet = new Set(hidden);
  const hiddenCount = columns.filter((c) => !c.fixed && hiddenSet.has(c.id)).length;
  const changed = hiddenCount > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-8 flex-shrink-0 items-center gap-1.5 rounded-full px-3 text-[13.5px] transition-colors duration-150',
            'shadow-[inset_0_0_0_1px_var(--a-line)]',
            changed ? 'text-a-ink' : 'text-a-muted hover:text-a-ink',
          )}
          aria-label={`Columns${hiddenCount ? ` (${hiddenCount} hidden)` : ''}`}
        >
          <Columns3 className="size-3.5" strokeWidth={2.5} aria-hidden />
          <span className="hidden sm:inline">Columns</span>
          {hiddenCount > 0 && (
            <span className="flex min-w-[18px] items-center justify-center rounded-full bg-a-accent px-1 text-[11px] font-bold leading-[18px] text-a-bg">
              {hiddenCount}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[260px] p-2">
        <ul className="space-y-0.5">
          {columns.map((column, i) => {
            const isHidden = !column.fixed && hiddenSet.has(column.id);
            return (
              <li key={column.id} className="flex items-center gap-1 rounded-[10px] px-1 py-0.5 hover:bg-a-row-hover">
                <span className={cn('min-w-0 flex-1 truncate text-[13.5px]', isHidden ? 'text-a-faint' : 'text-a-ink')}>
                  {column.label}
                </span>

                <button
                  type="button"
                  onClick={() => onMove(column.id, -1)}
                  disabled={i === 0}
                  aria-label={`Move ${column.label} left`}
                  className="flex size-6 items-center justify-center rounded-[7px] text-a-faint transition-colors duration-150 hover:text-a-ink disabled:opacity-30"
                >
                  <ArrowUp className="size-3.5" strokeWidth={2.5} />
                </button>
                <button
                  type="button"
                  onClick={() => onMove(column.id, 1)}
                  disabled={i === columns.length - 1}
                  aria-label={`Move ${column.label} right`}
                  className="flex size-6 items-center justify-center rounded-[7px] text-a-faint transition-colors duration-150 hover:text-a-ink disabled:opacity-30"
                >
                  <ArrowDown className="size-3.5" strokeWidth={2.5} />
                </button>

                {column.fixed ? (
                  <span className="flex size-6 items-center justify-center text-a-faint/50" title="Always shown">
                    <Eye className="size-3.5" strokeWidth={2.5} aria-hidden />
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onToggle(column.id)}
                    aria-label={isHidden ? `Show ${column.label}` : `Hide ${column.label}`}
                    aria-pressed={!isHidden}
                    className="flex size-6 items-center justify-center rounded-[7px] text-a-faint transition-colors duration-150 hover:text-a-ink"
                  >
                    {isHidden
                      ? <EyeOff className="size-3.5" strokeWidth={2.5} />
                      : <Eye className="size-3.5" strokeWidth={2.5} />}
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          onClick={onReset}
          className="mt-1.5 flex w-full items-center gap-1.5 rounded-[10px] px-2 py-1.5 text-left text-[13px] text-a-muted transition-colors duration-150 hover:bg-a-row-hover hover:text-a-ink"
        >
          <RotateCcw className="size-3.5" strokeWidth={2.5} aria-hidden />
          Show all, in field order
        </button>
      </PopoverContent>
    </Popover>
  );
}
