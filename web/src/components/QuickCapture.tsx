/**
 * Quick capture (P6.1): press `c` or ⌘⇧N anywhere, type one line, press ↵. The line's date, time and
 * quadrant are read as you type and shown under the box, so there is no surprise about what gets saved.
 */
import { useMemo, useState } from 'react';
import { CalendarDays, Clock, Plus, Repeat } from 'lucide-react';
import { recurrenceLabel } from '@/lib/recurrence';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { parseQuickCapture, type CapturedTask } from '@/lib/quickCapture';
import { resolveNeeds } from '@/lib/taskNeeds';
import type { Todo } from '@/types/todo';
import { getQuadrantConfig } from '@/types/todo';
import { cn } from '@/lib/utils';

export interface QuickCaptureProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Name of the list the task will land in. */
  listName?: string;
  /** The open tasks, so ">Write notes" can say whether it links one that exists or makes a new task. */
  openTasks?: readonly Todo[];
  onAdd: (task: CapturedTask) => void;
}

function dateLabel(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function timeLabel(hhmm: string): string {
  return new Date(`2000-01-01T${hhmm}:00`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function QuickCapture({ open, onOpenChange, listName, openTasks, onAdd }: QuickCaptureProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The body is its own component so each opening starts with an empty box. */}
      <DialogContent
        showCloseButton={false}
        className="top-[18vh] max-w-[560px] translate-y-0 gap-0 rounded-[12px] p-0 sm:max-w-[560px]"
      >
        <DialogTitle className="sr-only">Quick add</DialogTitle>
        <DialogDescription className="sr-only">Type a task. Add a date, a time or a quadrant in the same line.</DialogDescription>
        <CaptureBody listName={listName} openTasks={openTasks} onAdd={(t) => { onOpenChange(false); onAdd(t); }} />
      </DialogContent>
    </Dialog>
  );
}

function CaptureBody({ listName, openTasks, onAdd }: { listName?: string; openTasks?: readonly Todo[]; onAdd: (task: CapturedTask) => void }) {
  const [text, setText] = useState('');
  const [now] = useState(() => new Date());
  const parsed = useMemo(() => (text.trim() ? parseQuickCapture(text, now) : null), [text, now]);
  const needs = useMemo(() => (parsed?.needs?.length ? resolveNeeds(parsed.needs, openTasks ?? []) : null), [parsed, openTasks]);

  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-a-line-soft px-4">
        <Plus className="size-4 flex-shrink-0 text-a-faint" strokeWidth={1.75} aria-hidden />
        <input
          autoFocus
          value={text}
          maxLength={200}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && parsed) { e.preventDefault(); onAdd(parsed); } }}
          placeholder="Add a task, e.g. Send invoice fri 3pm !do"
          aria-label="New task"
          className="h-12 min-w-0 flex-1 bg-transparent text-[14px] text-a-ink outline-none placeholder:text-a-faint"
        />
        <kbd className="font-mono text-[11px] text-a-faint">↵</kbd>
      </div>
      <div className="flex min-h-[40px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-[12px] text-a-muted" aria-live="polite">
        {parsed ? (
          <>
            <span className="font-semibold text-a-ink [overflow-wrap:anywhere]">{parsed.title}</span>
            {parsed.dueDate && (
              <span className="inline-flex items-center gap-1"><CalendarDays className="size-[14px]" strokeWidth={1.75} aria-hidden />{dateLabel(parsed.dueDate)}</span>
            )}
            {parsed.dueTime && (
              <span className="inline-flex items-center gap-1"><Clock className="size-[14px]" strokeWidth={1.75} aria-hidden />{timeLabel(parsed.dueTime)}</span>
            )}
            {parsed.recurrence && (
              <span className="inline-flex items-center gap-1"><Repeat className="size-[14px]" strokeWidth={1.75} aria-hidden />{recurrenceLabel(parsed.recurrence)}</span>
            )}
            <span className={cn('rounded-[3px] px-1.5 py-0.5 font-semibold', getQuadrantConfig(parsed.quadrant ?? 'do').badgeClass)}>
              {getQuadrantConfig(parsed.quadrant ?? 'do').label}
            </span>
            {listName && <span>in {listName}</span>}
            {needs && (
              <span className="w-full">
                Needs first: {[
                  ...needs.ids.map((id) => `${openTasks?.find((t) => t.id === id)?.text ?? ''} (existing)`),
                  ...needs.newTitles.map((title) => `${title} (new)`),
                ].join(' · ')}
              </span>
            )}
          </>
        ) : (
          <span className="text-a-faint">Dates, times and !do / !schedule / !delegate / !eliminate are read from the line. {'>'}Task makes it need that task first.</span>
        )}
      </div>
    </>
  );
}
