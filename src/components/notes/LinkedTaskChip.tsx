/**
 * The chip on a note block that was added to a quadrant.
 *
 * It reads the task live — quadrant, list and done state come from the task,
 * never from a copy in the note — so moving or completing the task in Tasks
 * shows here straight away.
 */
import { Check, ExternalLink, Loader2, Unlink } from 'lucide-react';
import { cn } from '@/lib/utils';
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

const CHIP = cn(
  'inline-flex max-w-[260px] items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[12px] leading-none whitespace-nowrap',
  'transition-colors duration-150',
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
                ? <Check className="size-3 flex-shrink-0" strokeWidth={3} aria-hidden />
                : <span className={cn('size-1.5 flex-shrink-0 rounded-full', quad.dotClass)} aria-hidden />}
              <span className={cn('font-semibold', done && 'line-through decoration-[1.5px]')}>{quad.label}</span>
              {list && <span className="min-w-0 truncate opacity-80">· {list.name}</span>}
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
