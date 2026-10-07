/**
 * The pop-up when a task is completed while tasks it needs first are still open. It names them and leaves the choice to the person:
 * finish those too, complete anyway, or not yet. Cancel is the first button, so it is the one Enter would press.
 */
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BTN_MD, topBarPill, topBarPrimary } from '@/components/shell/TopBar';
import { needsTitle } from '@/lib/taskNeeds';
import { cn } from '@/lib/utils';
import type { Todo } from '@/types/todo';

export type NeedsDecision = 'finish' | 'anyway' | 'cancel';

export interface NeedsGroup {
  task: Todo;
  /** Its prerequisites that are still open. */
  open: Todo[];
}

export interface NeedsFirstDialogProps {
  /** The tasks being completed that still wait on something; null when the pop-up is closed. */
  groups: NeedsGroup[] | null;
  /** How many tasks were being completed in all (more than the groups when only some are blocked). */
  total: number;
  listName: (listId: string) => string | undefined;
  onDecide: (decision: NeedsDecision) => void;
}

function dueLabel(t: Todo): string {
  if (!t.dueDate) return '';
  const d = new Date(`${t.dueDate}T12:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function NeedsFirstDialog({ groups, total, listName, onDecide }: NeedsFirstDialogProps) {
  const open = !!groups && groups.length > 0;
  const single = groups?.length === 1;
  const waiting = groups ?? [];
  const prerequisites = new Set(waiting.flatMap((g) => g.open.map((o) => o.id))).size;
  const title = single
    ? needsTitle(waiting[0].task.text, waiting[0].open.length)
    : `${waiting.length} of the ${total} selected tasks still need other tasks first`;

  const row = (t: Todo) => {
    const meta = [listName(t.listId), dueLabel(t) && `due ${dueLabel(t)}`].filter(Boolean).join(' · ');
    return (
      <li key={t.id} className="flex items-baseline gap-2 text-[13px] text-a-ink">
        <span className="size-[6px] flex-shrink-0 translate-y-[-1px] rounded-full bg-a-attention" aria-hidden />
        <span className="[overflow-wrap:anywhere]">{t.text}</span>
        {meta && <span className="flex-shrink-0 text-[12px] text-a-faint">{meta}</span>}
      </li>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onDecide('cancel'); }}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{single ? 'These are not done yet:' : 'These tasks are not done yet:'}</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[260px] flex-col gap-3 overflow-auto">
          {single ? (
            <ul className="flex flex-col gap-1.5">{waiting[0].open.map(row)}</ul>
          ) : (
            waiting.map((g) => (
              <div key={g.task.id} className="flex flex-col gap-1">
                <p className="text-[13px] font-semibold text-a-ink [overflow-wrap:anywhere]">{g.task.text} needs first:</p>
                <ul className="flex flex-col gap-1.5 pl-3">{g.open.map(row)}</ul>
              </div>
            ))
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className={cn(topBarPill, BTN_MD)} onClick={() => onDecide('cancel')}>Cancel</button>
          <button type="button" className={cn(topBarPill, BTN_MD)} onClick={() => onDecide('anyway')}>
            {single ? 'Complete anyway' : 'Complete them anyway'}
          </button>
          <button type="button" className={cn(topBarPrimary, BTN_MD)} onClick={() => onDecide('finish')}>
            {prerequisites === 1 ? 'Finish it too' : 'Finish them too'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
