import React, { useState, useCallback, useEffect } from 'react';
import { CircleAlert, Clock, FileText, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RECURRENCE_OPTIONS, type Recurrence } from '@/lib/recurrence';
import { getDefaultReminderMinutes, REMINDER_OPTIONS } from '@/lib/notifications';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { BTN_MD, topBarPill, topBarPrimary } from '@/components/shell/TopBar';
import { QuadrantPicker } from '@/components/tasks/QuadrantPicker';
import { CATEGORIES, getQuadrantConfig } from '@/types/todo';
import type { Todo, TodoStatus, Quadrant } from '@/types/todo';
import { getDueInfo } from '@/components/MatrixTaskCard';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { memberLabel } from '@/lib/workspaceMessage';
import { TaskFieldsSection } from '@/components/fields/TaskFieldsSection';
import type { FieldDef, FieldValue } from '@/types/fields';

interface TaskDetailPanelProps {
  todo: Todo | null;
  open: boolean;
  onClose: () => void;
  onUpdate: (id: string, changes: Partial<Todo>) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: TodoStatus) => void;
  /** Opens the note a task was added from. */
  onOpenNote?: (noteId: string) => void;
  /** The list the task is in, for the delete confirmation's wording. */
  listName?: string;
  /** Custom fields. The section is left out when this is not given. */
  fields?: {
    defs: FieldDef[];
    values: Record<string, Record<string, FieldValue>>;
    online: boolean;
    loading: boolean;
    onSetValue: (taskId: string, fieldId: string, value: FieldValue | null) => void;
    onManage: () => void;
  };
}

/** "Sun, Sep 27" — the wording of the overdue banner (showcase 1025). */
function weekdayDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

const STATUS_OPTIONS: { value: TodoStatus; label: string }[] = [
  { value: 'todo', label: 'To do' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
];

// Field labels are the DS label: 13px / 500 ink, sentence case.
const LABEL = 'text-[13px] font-medium leading-[1.35] text-a-ink';

/** Quadrant → the DS Badge tone the header uses (showcase 1019): Do first reads as danger. */
const QUADRANT_BADGE: Record<Quadrant, string> = {
  do: 'bg-a-red-tint text-a-red-ink',
  schedule: 'bg-a-blue-tint text-a-accent-700',
  delegate: 'bg-q-delegate-bg text-q-delegate',
  eliminate: 'bg-q-eliminate-bg text-q-eliminate',
};

/**
 * The task detail panel — a peek panel, not a modal: 440px, right-anchored under the
 * 52px chrome, **no scrim**, and the page behind it stays interactive (showcase
 * 1016–1045). Changes save when it closes; Save closes it too.
 */
export function TaskDetailPanel({
  todo,
  open,
  onClose,
  onUpdate,
  onDelete,
  onStatusChange,
  onOpenNote,
  listName,
  fields,
}: TaskDetailPanelProps) {
  const [text, setText] = useState(todo?.text ?? '');
  const [note, setNote] = useState(todo?.note ?? '');
  const [dueDate, setDueDate] = useState(todo?.dueDate ?? '');
  const [dueTime, setDueTime] = useState(todo?.dueTime ?? '');
  const [category, setCategory] = useState(todo?.category ?? '');
  const [assignee, setAssignee] = useState(todo?.assigneeUserId ?? '');
  const workspaces = useWorkspaces();
  const members = workspaces.current && workspaces.current.state === 'active' ? workspaces.current.members : [];
  const [quadrant, setQuadrant] = useState<Quadrant>(todo?.quadrant ?? 'schedule');
  const [status, setStatus] = useState<TodoStatus>(todo?.status ?? 'todo');
  /** 'off', or the minutes before the due time the reminder fires. */
  const [reminder, setReminder] = useState<string>(todo?.reminderEnabled ? String(todo.reminderMinutesBefore ?? getDefaultReminderMinutes()) : 'off');
  const [recurrence, setRecurrence] = useState<Recurrence | ''>(todo?.recurrence ?? '');
  const [isDirty, setIsDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Sync state when todo changes (different task opened)
  const todoId = todo?.id;

  useEffect(() => {
    if (!todo) return;
    setText(todo.text ?? '');
    setNote(todo.note ?? '');
    setDueDate(todo.dueDate ?? '');
    setDueTime(todo.dueTime ?? '');
    setCategory(todo.category ?? '');
    setAssignee(todo.assigneeUserId ?? '');
    setQuadrant(todo.quadrant ?? 'schedule');
    setStatus(todo.status ?? 'todo');
    setReminder(todo.reminderEnabled ? String(todo.reminderMinutesBefore ?? getDefaultReminderMinutes()) : 'off');
    setRecurrence(todo.recurrence ?? '');
    setIsDirty(false);
    setConfirmDelete(false);
  }, [todoId]);

  const markDirty = useCallback(() => setIsDirty(true), []);

  const handleSave = useCallback(() => {
    if (!todo || !text.trim()) return;
    const changes: Partial<Todo> = {
      text: text.trim(),
      note: note.trim() || undefined,
      dueDate,
      dueTime: dueDate ? dueTime : '',
      category: category || undefined,
      // Only sent in a shared workspace, and only when it changed: '' means "no one".
      ...(members.length > 0 && assignee !== (todo.assigneeUserId ?? '')
        ? { assigneeUserId: assignee, assigneeName: assignee ? memberLabel(members.find((m) => m.userId === assignee) ?? {}) : '' }
        : {}),
      quadrant,
      // A repeat needs a date to repeat from.
      recurrence: dueDate ? recurrence : '',
      reminderEnabled: reminder !== 'off' && !!dueDate,
      ...(reminder !== 'off' ? { reminderMinutesBefore: Number(reminder) } : {}),
    };
    // Handle status change separately (for streak tracking)
    if (status !== todo.status) {
      onStatusChange(todo.id, status);
    }
    onUpdate(todo.id, changes);
    setIsDirty(false);
  }, [todo, text, note, dueDate, dueTime, category, assignee, members, quadrant, status, reminder, recurrence, onUpdate, onStatusChange]);

  // Auto-save on close if dirty
  const handleClose = useCallback(() => {
    if (isDirty && todo && text.trim()) {
      handleSave();
    }
    onClose();
  }, [isDirty, todo, text, handleSave, onClose]);

  // Explicit Save saves and closes (showcase 1042).
  const handleSaveAndClose = useCallback(() => {
    if (isDirty) handleSave();
    onClose();
  }, [isDirty, handleSave, onClose]);

  if (!todo || !open) return null;

  const isDone = status === 'done';
  const dueInfo = getDueInfo(dueDate || undefined, dueTime || undefined);
  const quadrantConfig = getQuadrantConfig(quadrant);
  const banner = dueInfo && !isDone && (dueInfo.isOverdue || dueInfo.isUrgentSoon) ? dueInfo : null;

  return (
    <>
      {/* Opening the delete confirmation hides the panel; "Keep task" brings it back (showcase 962). */}
      {!confirmDelete && <aside
        role="dialog"
        aria-label="Task details"
        onKeyDown={(e) => { if (e.key === 'Escape') handleClose(); }}
        className="fixed top-[52px] right-0 bottom-0 z-40 flex w-[440px] max-w-full flex-col border-l border-a-line bg-a-surface text-[13px] leading-normal text-a-ink shadow-[var(--a-shadow-xl)] animate-in slide-in-from-right duration-[260ms]"
      >
        <header className="flex flex-shrink-0 items-center gap-2 border-b border-a-line px-4 py-3">
          {/* design-check-ignore: pill — the DS Badge is a pill (showcase 1019). */}
          <span className={cn('rounded-full border border-transparent px-2 py-[3px] text-[11px] font-semibold leading-none', QUADRANT_BADGE[quadrant])}>
            {quadrantConfig.label}
          </span>
          <span className="text-[12px] text-a-faint">Changes save when you close</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close panel"
            className="flex size-7 items-center justify-center rounded-[4px] text-a-muted transition-colors duration-[120ms] hover:bg-a-line-soft hover:text-a-ink active:bg-a-line"
          >
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-auto p-4">
          {banner && (
            <div
              className={cn(
                'flex gap-2.5 rounded-[6px] border px-3 py-2.5 font-medium',
                banner.isOverdue
                  ? 'border-a-red-border bg-a-red-tint text-a-red-ink'
                  : 'border-a-amber-line bg-a-amber-tint text-a-amber-ink',
              )}
              role="status"
            >
              {banner.isOverdue
                ? <CircleAlert className="size-4 flex-shrink-0" strokeWidth={1.75} aria-hidden />
                : <Clock className="size-4 flex-shrink-0" strokeWidth={1.75} aria-hidden />}
              <span>
                {banner.isOverdue && dueDate ? `Overdue — was due ${weekdayDate(dueDate)}` : `Due soon — ${banner.label}`}
              </span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label className={LABEL} htmlFor="detail-task">Task</Label>
            <Textarea
              id="detail-task"
              value={text}
              onChange={(e) => { setText(e.target.value); markDirty(); }}
              placeholder="What needs to be done?"
              rows={2}
              className={cn('min-h-[72px]', isDone && 'line-through text-a-faint')}
              aria-label="Task title"
            />
          </div>

          <div>
            <div className="mb-1.5 font-medium">Status</div>
            <div className="flex gap-2">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { setStatus(opt.value); markDirty(); }}
                  aria-pressed={status === opt.value}
                  className={cn(
                    'inline-flex h-[30px] items-center gap-1.5 rounded-[6px] border px-3 font-medium transition-colors duration-[120ms]',
                    status === opt.value
                      ? 'border-a-blue-line bg-a-blue-tint text-a-accent-700'
                      : 'border-a-line bg-a-surface text-a-muted hover:bg-a-bg',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 font-medium">Priority quadrant</div>
            <QuadrantPicker value={quadrant} onChange={(q) => { setQuadrant(q); markDirty(); }} />
          </div>

          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div className="flex flex-col gap-2">
              <Label className={LABEL} htmlFor="detail-date">Due date</Label>
              <Input
                id="detail-date"
                type="date"
                value={dueDate}
                onChange={(e) => { setDueDate(e.target.value); markDirty(); }}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label className={LABEL} htmlFor="detail-time">Time</Label>
              <Input
                id="detail-time"
                type="time"
                value={dueTime}
                onChange={(e) => { setDueTime(e.target.value); markDirty(); }}
                disabled={!dueDate}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label className={LABEL}>Reminder</Label>
            <Select value={reminder} onValueChange={(v) => { setReminder(v); markDirty(); }} disabled={!dueDate}>
              <SelectTrigger className="w-full" aria-label="Reminder">
                <SelectValue placeholder="Off" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off"><span className="text-a-faint">Off</span></SelectItem>
                {REMINDER_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label className={LABEL}>Repeat</Label>
            <Select value={recurrence || 'none'} onValueChange={(v) => { setRecurrence(v === 'none' ? '' : (v as Recurrence)); markDirty(); }} disabled={!dueDate}>
              <SelectTrigger className="w-full" aria-label="Repeat">
                <SelectValue placeholder="Does not repeat" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none"><span className="text-a-faint">Does not repeat</span></SelectItem>
                {RECURRENCE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!dueDate && <p className="text-[12px] text-a-faint">Set a due date to repeat a task.</p>}
          </div>

          <div className="flex flex-col gap-2">
            <Label className={LABEL}>Category</Label>
            <Select
              value={category || '__none__'}
              onValueChange={(v) => { setCategory(v === '__none__' ? '' : v); markDirty(); }}
            >
              <SelectTrigger className="w-full" aria-label="Category">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__"><span className="text-a-faint">None</span></SelectItem>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>{cat.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {members.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label className={LABEL}>Assigned to</Label>
              <Select value={assignee || '__none__'} onValueChange={(v) => { setAssignee(v === '__none__' ? '' : v); markDirty(); }}>
                <SelectTrigger className="w-full" aria-label="Assigned to">
                  <SelectValue placeholder="No one" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__"><span className="text-a-faint">No one</span></SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>{memberLabel(m)}{m.userId === workspaces.me?.userId ? ' (you)' : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {fields && (
            <TaskFieldsSection
              fields={fields.defs}
              values={fields.values[todo.id]}
              online={fields.online}
              loading={fields.loading}
              onSetValue={(fieldId, value) => fields.onSetValue(todo.id, fieldId, value)}
              onManage={fields.onManage}
            />
          )}

          <div className="flex flex-col gap-2">
            <Label className={LABEL} htmlFor="detail-notes">Notes</Label>
            <Textarea
              id="detail-notes"
              value={note}
              onChange={(e) => { setNote(e.target.value); markDirty(); }}
              placeholder="Add context, links, or thoughts…"
              rows={4}
              className="min-h-[96px]"
              aria-label="Task notes"
            />
          </div>

          {todo.sourceNoteId && onOpenNote && (
            <div className="flex items-center gap-2 text-a-accent-600">
              <FileText className="size-3.5" strokeWidth={1.75} aria-hidden />
              Added from note
              <button type="button" onClick={() => onOpenNote(todo.sourceNoteId!)} className="font-semibold hover:underline">
                Open note
              </button>
            </div>
          )}
        </div>

        <footer className="flex flex-shrink-0 items-center gap-2 border-t border-a-line px-4 py-3">
          <button type="button" onClick={() => setConfirmDelete(true)} className={cn(topBarPill, BTN_MD)}>
            <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
            Delete
          </button>
          <div className="flex-1" />
          <button type="button" onClick={handleSaveAndClose} disabled={!text.trim()} className={cn(topBarPrimary, BTN_MD, 'disabled:opacity-50')}>
            Save
          </button>
        </footer>
      </aside>}

      {/* ov-delete — showcase 962–964 */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete this task?</DialogTitle>
            <DialogDescription>
              “{todo.text}” will be removed{listName ? ` from ${listName}` : ''}.
              {todo.sourceNoteId && ' Its chip in the note it came from stays, and reads “Task removed”.'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-end gap-2">
            <button type="button" className={cn(topBarPill, BTN_MD)} onClick={() => setConfirmDelete(false)}>
              Keep task
            </button>
            <button
              type="button"
              className={cn(
                'flex flex-shrink-0 items-center gap-2 border border-transparent bg-a-red-line font-semibold whitespace-nowrap text-white transition-colors duration-[120ms] hover:bg-a-red-ink active:bg-a-red-ink',
                BTN_MD,
              )}
              onClick={() => { onDelete(todo.id); setConfirmDelete(false); onClose(); }}
            >
              Delete task
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
