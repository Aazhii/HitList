/**
 * The small "Waiting on 2" mark on a task that still needs other tasks first. The counts are worked out once in App and shared
 * through a context, so no list, card or board component needs another prop.
 */
import { createContext, useContext } from 'react';
import { Hourglass } from 'lucide-react';
import { cn } from '@/lib/utils';

export const WaitingCountsContext = createContext<ReadonlyMap<string, number>>(new Map());

export function WaitingBadge({ taskId, className }: { taskId: string; className?: string }) {
  const count = useContext(WaitingCountsContext).get(taskId) ?? 0;
  if (count <= 0) return null;
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-[4px] border border-a-line px-2 py-[3px] text-[11px] font-medium whitespace-nowrap text-a-attention', className)}
      title={`Needs ${count === 1 ? '1 task' : `${count} tasks`} done first`}
    >
      <Hourglass className="size-3 flex-shrink-0" strokeWidth={1.75} aria-hidden />
      Waiting on {count}
    </span>
  );
}

/** Whether the task is waiting on anything, for layouts that decide whether to show a meta row at all. */
export function useIsWaiting(taskId: string): boolean {
  return (useContext(WaitingCountsContext).get(taskId) ?? 0) > 0;
}
