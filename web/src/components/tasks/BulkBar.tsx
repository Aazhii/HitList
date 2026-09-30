/**
 * The bar over the task table while rows are selected (P6.3): set a status, move to a quadrant, set or
 * clear the due date, or delete, for all of them at once.
 */
import { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { QUADRANTS, type Quadrant, type TodoStatus } from '@/types/todo';
import { taskCountLabel } from '@/lib/bulkSelection';

export interface BulkChange {
  status?: TodoStatus;
  quadrant?: Quadrant;
  /** '' clears the date. */
  dueDate?: string;
}

interface BulkBarProps {
  count: number;
  onChange: (change: BulkChange) => void;
  onDelete: () => void;
  onClear: () => void;
}

const STATUSES: Array<{ value: TodoStatus; label: string }> = [
  { value: 'todo', label: 'To do' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
];

const BAR_BUTTON = 'inline-flex h-7 items-center gap-1.5 rounded-[3px] px-2.5 text-[12px] font-semibold transition-colors duration-[120ms]';

export function BulkBar({ count, onChange, onDelete, onClear }: BulkBarProps) {
  const [confirming, setConfirming] = useState(false);
  // The selects are actions, not fields: they show their label again after each use.
  const [resetKey, setResetKey] = useState(0);
  const apply = (change: BulkChange) => { onChange(change); setResetKey((k) => k + 1); };

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="mb-2 flex flex-wrap items-center gap-2 rounded-[8px] border border-a-line bg-a-surface px-3 py-2 shadow-[var(--a-shadow-sm)]"
    >
      <span className="mr-1 text-[13px] font-semibold text-a-ink">{count} selected</span>

      {confirming ? (
        <>
          <span className="text-[13px] text-a-muted">Delete {taskCountLabel(count)}? This cannot be undone.</span>
          <button type="button" onClick={() => { setConfirming(false); onDelete(); }} className={cn(BAR_BUTTON, 'bg-a-attention text-a-surface hover:opacity-90')}>
            Delete
          </button>
          <button type="button" onClick={() => setConfirming(false)} className={cn(BAR_BUTTON, 'text-a-muted hover:bg-a-line-soft')}>Cancel</button>
        </>
      ) : (
        <>
          <Select key={`s${resetKey}`} onValueChange={(v) => apply({ status: v as TodoStatus })}>
            <SelectTrigger size="sm" className="h-7 w-[124px] text-[12px]" aria-label="Set status"><SelectValue placeholder="Set status" /></SelectTrigger>
            <SelectContent>{STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select key={`q${resetKey}`} onValueChange={(v) => apply({ quadrant: v as Quadrant })}>
            <SelectTrigger size="sm" className="h-7 w-[132px] text-[12px]" aria-label="Move to quadrant"><SelectValue placeholder="Move to" /></SelectTrigger>
            <SelectContent>{QUADRANTS.map((q) => <SelectItem key={q.id} value={q.id}>{q.label}</SelectItem>)}</SelectContent>
          </Select>
          <input
            key={`d${resetKey}`}
            type="date"
            aria-label="Set due date"
            onChange={(e) => { if (e.target.value) apply({ dueDate: e.target.value }); }}
            className="h-7 rounded-[4px] border border-a-line-strong bg-a-surface px-2 text-[12px] text-a-ink outline-none focus-visible:border-a-accent"
          />
          <button type="button" onClick={() => apply({ dueDate: '' })} className={cn(BAR_BUTTON, 'text-a-muted hover:bg-a-line-soft')}>
            Clear date
          </button>
          <div className="flex-1" />
          <button type="button" onClick={() => setConfirming(true)} className={cn(BAR_BUTTON, 'text-a-attention hover:bg-a-red-tint')}>
            <Trash2 className="size-[14px]" strokeWidth={1.75} aria-hidden /> Delete
          </button>
          <button type="button" onClick={onClear} aria-label="Clear selection" className="flex size-7 items-center justify-center rounded-[4px] text-a-faint hover:bg-a-line-soft hover:text-a-ink">
            <X className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        </>
      )}
    </div>
  );
}
