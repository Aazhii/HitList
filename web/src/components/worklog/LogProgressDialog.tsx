/**
 * Log progress: press `l` or ⌘L anywhere, type one line about what moved, press ↵. Stays open so a
 * work session's second and third line are one keystroke away. Finished or not, it all counts for Monday.
 */
import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useProgressLog } from '@/hooks/useProgressLog';
import type { ProgressState } from '@/lib/api';
import { cn } from '@/lib/utils';

export const STATE_LABEL: Record<ProgressState, string> = { moved: 'Moved', discussed: 'Discussed', blocked: 'Blocked', done: 'Done' };
const STATES: ProgressState[] = ['moved', 'discussed', 'blocked', 'done'];

export interface LogProgressDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The task this line is about, when opened from a task. */
  task?: { id: string; title: string } | null;
}

export function LogProgressDialog({ open, onOpenChange, task }: LogProgressDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="top-[18vh] max-w-[560px] translate-y-0 gap-0 rounded-[12px] p-0 sm:max-w-[560px]">
        <DialogTitle className="sr-only">Log progress</DialogTitle>
        <DialogDescription className="sr-only">One line about what moved today, finished or not. It feeds your weekly update.</DialogDescription>
        {/* Its own component, so each opening starts with an empty box. */}
        <Body task={task ?? null} />
      </DialogContent>
    </Dialog>
  );
}

function Body({ task }: { task: { id: string; title: string } | null }) {
  const [text, setText] = useState('');
  const [state, setState] = useState<ProgressState>('moved');
  const [dayStart] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); });
  const log = useProgressLog(dayStart);
  const today = useMemo(() => [...log.entries].reverse(), [log.entries]);

  const save = () => {
    const line = text.trim();
    if (!line) return;
    void log.addEntry({ text: line, state, taskId: task?.id });
    setText('');
  };

  return (
    <>
      <div className="flex flex-col gap-2 border-b border-a-line-soft px-4 py-3">
        {task && <p className="text-[12px] text-a-muted">About <span className="font-semibold text-a-ink">{task.title}</span></p>}
        <input
          autoFocus
          value={text}
          maxLength={500}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
          placeholder="What moved? e.g. Discussed with @naga, looping him in, still open"
          aria-label="Progress line"
          className="h-10 min-w-0 bg-transparent text-[14px] text-a-ink outline-none placeholder:text-a-faint"
        />
        <div className="flex items-center gap-1.5" role="radiogroup" aria-label="State">
          {STATES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={state === s}
              onClick={() => setState(s)}
              className={cn('h-[26px] rounded-[4px] border px-2.5 text-[12px] font-semibold transition-colors duration-[120ms]',
                state === s ? 'border-a-accent bg-a-accent text-white' : 'border-a-line-strong text-a-muted hover:bg-a-bg')}
            >
              {STATE_LABEL[s]}
            </button>
          ))}
          <kbd className="ml-auto font-mono text-[11px] text-a-faint">↵</kbd>
        </div>
      </div>
      <div className="max-h-[220px] overflow-auto px-4 py-2" aria-live="polite">
        {log.waiting > 0 && <p className="pb-1 text-[12px] text-a-attention">{log.waiting} {log.waiting === 1 ? 'line is' : 'lines are'} saved on this computer and will be sent when HitList can reach its storage.</p>}
        {today.length === 0 ? (
          <p className="py-1 text-[12px] text-a-faint">Nothing logged today yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {today.map((e) => (
              <li key={e.id} className="flex items-baseline gap-2 text-[13px] text-a-ink">
                <span className="w-[68px] flex-shrink-0 text-[11px] font-semibold uppercase text-a-faint">{STATE_LABEL[e.state] ?? e.state}</span>
                <span className="[overflow-wrap:anywhere]">{e.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
