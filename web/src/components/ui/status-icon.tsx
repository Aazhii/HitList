/**
 * The per-row status glyph the design uses in the matrix, the list and the board
 * (showcase 1275): `circle` / `loader` / `circle-check` at 17px, coloured
 * `--gray-400`-ish / brand blue / data-valid green. Clicking advances the status.
 *
 * The note editor's to-do block keeps `StatusBox` (a checkbox); this is for task rows.
 */
import type { MouseEvent } from 'react';
import { Circle, CircleCheck, Loader } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TodoStatus } from '@/types/todo';

export interface StatusIconProps {
  status: TodoStatus;
  label: string;
  disabled?: boolean;
  onClick: (e: MouseEvent) => void;
  className?: string;
}

export function StatusIcon({ status, label, disabled, onClick, className }: StatusIconProps) {
  const Icon = status === 'done' ? CircleCheck : status === 'in-progress' ? Loader : Circle;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={status === 'done' ? true : status === 'in-progress' ? 'mixed' : false}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn('flex flex-shrink-0 items-center justify-center', disabled ? 'cursor-default' : 'cursor-pointer', className)}
    >
      <Icon
        className={cn(
          'size-[17px]',
          status === 'done' ? 'text-a-dq-valid' : status === 'in-progress' ? 'text-a-accent' : 'text-a-faint',
        )}
        strokeWidth={1.75}
      />
    </button>
  );
}
