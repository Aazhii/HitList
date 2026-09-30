import { X } from 'lucide-react';

interface DailyLineProps {
  /** Yesterday's result, or null when there is nothing to say about it. */
  yesterday: string | null;
  /** The task Today names as the one thing. */
  focus: string | null;
  onDismiss: () => void;
  onTurnOff: () => void;
}

/** A quiet line above the plan, once a day. Not a dialog, not a toast; it stays until dismissed. */
export function DailyLine({ yesterday, focus, onDismiss, onTurnOff }: DailyLineProps) {
  if (!yesterday && !focus) return null;
  return (
    <div role="note" aria-label="Daily summary" className="mb-4 flex items-start gap-3 rounded-[8px] bg-a-line-soft px-3 py-2.5">
      <p className="min-w-0 flex-1 text-[13px] leading-[1.5] text-a-muted [overflow-wrap:anywhere]">
        {yesterday} {focus && <>Today's one thing: <span className="font-semibold text-a-ink">{focus}</span>.</>}
      </p>
      <button type="button" onClick={onTurnOff} className="flex-shrink-0 text-[12px] text-a-faint hover:text-a-ink hover:underline">
        Turn off
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss for today"
        className="flex size-5 flex-shrink-0 items-center justify-center rounded-[3px] text-a-faint transition-colors duration-[120ms] hover:bg-a-row-hover hover:text-a-ink"
      >
        <X className="size-[14px]" strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  );
}
