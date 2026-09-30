/**
 * The chip on a note block that was added to a quadrant.
 *
 * It reads the task live — quadrant, list and done state come from the task,
 * never from a copy in the note — so moving or completing the task in Tasks
 * shows here straight away.
 */
import { Check, ExternalLink, Loader2, Unlink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getDueInfo } from '@/lib/dueInfo';
import { getQuadrantConfig, type KaizenList, type Todo } from '@/types/todo';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface LinkedTaskChipProps {
  /** Undefined while the task is being created or when it no longer exists. */
  task: Todo | undefined;
  lists: KaizenList[];
  pending?: boolean;
  onOpen?: (taskId: string) => void;
  onUnlink: () => void;
}

// Showcase 327: 22px, 6px radius, 12px / 500, a 6px dot; "Schedule · Work · Oct 2".
const CHIP = cn(
  'inline-flex h-[22px] max-w-[260px] items-center gap-1.5 rounded-[6px] px-2 text-[12px] font-medium leading-none whitespace-nowrap',
  'transition-colors duration-[120ms]',
);

export function LinkedTaskChip({ task, lists, pending, onOpen, onUnlink }: LinkedTaskChipProps) {
  if (pending) {
    return (
      <span className={cn(CHIP, 'text-a-faint shadow-[inset_0_0_0_1px_var(--a-line)]')}>
        <Loader2 className="size-3 animate-spin" aria-hidden /> Adding…
      </span>
    );
  }

  const quad = task ? getQuadrantConfig(task.quadrant) : null;
  const list = task ? lists.find((l) => l.id === task.listId) : undefined;
  const done = task?.status === 'done';
  const due = task && !done ? getDueInfo(task.dueDate, task.dueTime)?.label : undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          // The textarea keeps focus: opening the menu must not blur the block.
          onMouseDown={(e) => e.preventDefault()}
          className={cn(
            CHIP,
            quad ? cn(quad.tintClass, quad.inkClass) : 'text-a-faint shadow-[inset_0_0_0_1px_var(--a-line)]',
            'hover:brightness-[0.97] data-[state=open]:brightness-[0.97]',
          )}
          aria-label={task ? `In ${quad!.label}${list ? `, ${list.name}` : ''}. Task options` : 'Linked task removed. Options'}
        >
          {quad ? (
            <>
              {done
                ? <Check className="size-3 flex-shrink-0" strokeWidth={1.75} aria-hidden />
                : <span className={cn('size-1.5 flex-shrink-0 rounded-full', quad.dotClass)} aria-hidden />}
              {/* One run of text, "Schedule · Work · Oct 2", as in the prototype. */}
              <span className={cn('min-w-0 truncate', done && 'line-through decoration-[1.5px]')}>
                {[quad.label, list?.name, due].filter(Boolean).join(' · ')}
              </span>
            </>
          ) : (
            <span>Task removed</span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {task && onOpen && (
          <>
            <DropdownMenuItem onClick={() => onOpen(task.id)}>
              <ExternalLink className="size-3.5" /> Open in Tasks
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={onUnlink}>
          <Unlink className="size-3.5" /> Unlink {task ? '(keeps the task)' : ''}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
