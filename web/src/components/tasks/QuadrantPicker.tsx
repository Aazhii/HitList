/**
 * The four-quadrant radio grid used by Add task (showcase 944–948) and the task
 * detail panel (1028): 6px tiles, `8px 12px`, ink text on white; the selected tile
 * takes the quadrant's tint and a 1.5px ink border.
 */
import { cn } from '@/lib/utils';
import { QUADRANTS, type Quadrant } from '@/types/todo';

interface QuadrantPickerProps {
  value: Quadrant;
  onChange: (quadrant: Quadrant) => void;
  label?: string;
}

export function QuadrantPicker({ value, onChange, label = 'Priority quadrant' }: QuadrantPickerProps) {
  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={label}>
      {QUADRANTS.map((q) => {
        const selected = value === q.id;
        return (
          <button
            key={q.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(q.id)}
            className={cn(
              'rounded-[6px] px-3 py-2 text-left leading-[normal] transition-colors duration-[120ms]',
              q.inkClass,
              selected
                ? cn(q.tintClass, 'border-[1.5px] border-current')
                : 'border border-a-line bg-a-surface hover:bg-a-bg',
            )}
          >
            <div className="font-semibold">{q.label}</div>
            <div className="text-[12px] opacity-85">{q.subtitle}</div>
          </button>
        );
      })}
    </div>
  );
}
