/** Who a task in a shared workspace is for: a small round initial and the name. Nothing is drawn for an unassigned task. */
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { initialOf } from '@/lib/workspaceMessage';
import { cn } from '@/lib/utils';

export function AssigneeChip({ userId, name, className }: { userId?: string; name?: string; className?: string }) {
  const { me } = useWorkspaces();
  if (!userId || !name) return null;
  const mine = me?.userId === userId;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[4px] border px-2 py-[3px] text-[11px] font-medium whitespace-nowrap',
        mine ? 'border-a-accent text-a-accent-700' : 'border-a-line text-a-muted',
        className,
      )}
      title={mine ? 'Assigned to you' : `Assigned to ${name}`}
    >
      <span className="flex size-[14px] items-center justify-center rounded-full bg-a-line text-[11px] text-a-ink" aria-hidden>{initialOf(name)}</span>
      {mine ? 'You' : name}
      <span className="sr-only">{mine ? ' (assigned to you)' : ' (assignee)'}</span>
    </span>
  );
}
