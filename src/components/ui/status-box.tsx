/**
 * The one status control.
 *
 * A task row, a matrix card and a note's to-do block all render this, so a task
 * looks the same wherever it appears. Before it there were three: a round
 * lucide Circle in the (unmounted) task row, a smaller round one on matrix
 * cards, and a square hand-rolled SVG tick in notes.
 *
 * 19px box, 6px radius. The hit area is 44px, made with padding and an equal
 * negative margin so the control is easy to hit without the box pushing the
 * row's layout around.
 *
 * Colours come from the organic tokens rather than literals, so the ring and
 * fill stay correct under the dark palette.
 */
import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export type StatusBoxState = 'todo' | 'in-progress' | 'done';

export interface StatusBoxProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  state: StatusBoxState;
  /** Accessible name — usually the task or to-do text. */
  label: string;
}

export const StatusBox = React.forwardRef<HTMLButtonElement, StatusBoxProps>(
  function StatusBox({ state, label, className, ...props }, ref) {
    // `mixed` is the honest ARIA value for a task that is started but not done.
    const ariaChecked = state === 'done' ? true : state === 'in-progress' ? 'mixed' : false;

    return (
      <button
        ref={ref}
        type="button"
        role="checkbox"
        aria-checked={ariaChecked}
        aria-label={label}
        className={cn(
          'group/status relative inline-flex flex-shrink-0 items-center justify-center',
          // 19px box + 12.5px padding each side = 44px target, cancelled by margin.
          '-m-[12.5px] p-[12.5px] cursor-pointer',
          'focus-visible:outline-none',
          className,
        )}
        {...props}
      >
        <span
          aria-hidden
          data-state={state}
          className={cn(
            'flex size-[19px] items-center justify-center rounded-[6px] transition-[background-color,box-shadow] duration-150',
            'group-focus-visible/status:outline-2 group-focus-visible/status:outline-offset-2 group-focus-visible/status:outline-a-accent',
            state === 'todo' && [
              'shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--a-ink)_28%,transparent)]',
              'group-hover/status:shadow-[inset_0_0_0_1.5px_var(--a-accent),0_0_0_3px_color-mix(in_srgb,var(--a-accent)_16%,transparent)]',
            ],
            state === 'in-progress' && 'shadow-[inset_0_0_0_1.5px_var(--a-accent)]',
            state === 'done' && 'bg-a-accent',
          )}
        >
          {state === 'in-progress' && <span className="size-[9px] rounded-[3px] bg-a-accent" />}
          {state === 'done' && <Check className="size-3 text-a-bg" strokeWidth={3.4} />}
        </span>
      </button>
    );
  },
);
