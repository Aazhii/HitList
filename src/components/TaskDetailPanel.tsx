import React, { useState, useCallback, useEffect } from 'react';
import {
  X,
  Check,
  Circle,
  Loader2,
  Trash2,
  CalendarClock,
  Clock,
  AlertCircle,
  ArrowRight,
  FileText,
  Tag,
  Bell,
  BellOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { FileText as FileTextIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { CATEGORIES, QUADRANTS, getCategoryConfig, getQuadrantConfig } from '@/types/todo';
import type { Todo, TodoStatus, Quadrant } from '@/types/todo';
import { getDueInfo } from '@/components/MatrixTaskCard';

import { REMINDER_OPTIONS, DEFAULT_REMINDER_MINUTES, isNotificationSupported } from '@/lib/notifications';
import type { ReminderMinutes } from '@/lib/notifications';

interface TaskDetailPanelProps {
  todo: Todo | null;
  open: boolean;
  onClose: () => void;
  onUpdate: (id: string, changes: Partial<Todo>) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: TodoStatus) => void;
  notificationPermission?: NotificationPermission;
  defaultReminderMinutes?: ReminderMinutes;
  /** Opens the note a task was added from. */
  onOpenNote?: (noteId: string) => void;
}

function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatCreated(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const STATUS_OPTIONS: { value: TodoStatus; label: string; icon: React.ReactNode }[] = [
  { value: 'todo', label: 'To do', icon: <Circle className="size-3.5 text-muted-foreground" /> },
  { value: 'in-progress', label: 'In progress', icon: <Loader2 className="size-3.5 text-primary animate-spin" /> },
  { value: 'done', label: 'Done', icon: <Check className="size-3.5 text-primary" /> },
];

export function TaskDetailPanel({
  todo,
  open,
  onClose,
  onUpdate,
  onDelete,
  onStatusChange,
  notificationPermission,
  defaultReminderMinutes = DEFAULT_REMINDER_MINUTES,
  onOpenNote,
}: TaskDetailPanelProps) {
  const [text, setText] = useState(todo?.text ?? '');
  const [note, setNote] = useState(todo?.note ?? '');
  const [dueDate, setDueDate] = useState(todo?.dueDate ?? '');
  const [dueTime, setDueTime] = useState(todo?.dueTime ?? '');
  const [category, setCategory] = useState(todo?.category ?? '');
  const [quadrant, setQuadrant] = useState<Quadrant>(todo?.quadrant ?? 'schedule');
  const [status, setStatus] = useState<TodoStatus>(todo?.status ?? 'todo');
  const [reminderEnabled, setReminderEnabled] = useState(todo?.reminderEnabled ?? false);
  const [reminderMinutes, setReminderMinutes] = useState<ReminderMinutes>(
    (todo?.reminderMinutesBefore as ReminderMinutes) ?? defaultReminderMinutes
  );
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
    setQuadrant(todo.quadrant ?? 'schedule');
    setStatus(todo.status ?? 'todo');
    setReminderEnabled(todo.reminderEnabled ?? false);
    setReminderMinutes((todo.reminderMinutesBefore as ReminderMinutes) ?? defaultReminderMinutes);
    setIsDirty(false);
    setConfirmDelete(false);
  }, [todoId]);

  const markDirty = useCallback(() => setIsDirty(true), []);

  const handleSave = useCallback(() => {
    if (!todo || !text.trim()) return;
    const changes: Partial<Todo> = {
      text: text.trim(),
      note: note.trim() || undefined,
      dueDate: dueDate || undefined,
      dueTime: dueTime || undefined,
      category: category || undefined,
      quadrant,
      reminderEnabled,
      reminderMinutesBefore: reminderMinutes,
    };
    // Handle status change separately (for streak tracking)
    if (status !== todo.status) {
      onStatusChange(todo.id, status);
    }
    onUpdate(todo.id, changes);
    setIsDirty(false);
  }, [todo, text, note, dueDate, dueTime, category, quadrant, status, reminderEnabled, reminderMinutes, onUpdate, onStatusChange]);

  const handleDelete = useCallback(() => {
    if (!todo) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    onDelete(todo.id);
    onClose();
  }, [todo, confirmDelete, onDelete, onClose]);

  // Auto-save on close if dirty
  const handleClose = useCallback(() => {
    if (isDirty && todo && text.trim()) {
      handleSave();
    }
    onClose();
  }, [isDirty, todo, text, handleSave, onClose]);

  if (!todo) return null;

  const isDone = status === 'done';
  const dueInfo = getDueInfo(dueDate || undefined, dueTime || undefined);
  const quadrantConfig = getQuadrantConfig(quadrant);
  const categoryConfig = getCategoryConfig(category);

  return (
    <Sheet open={open} onOpenChange={(v) => !v && handleClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full sm:max-w-md flex flex-col p-0 gap-0 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-card flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {/* Quadrant badge */}
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide flex-shrink-0',
                quadrantConfig.badgeClass
              )}
            >
              {quadrantConfig.label}
            </span>
            {isDirty && (
              <span className="text-[10px] text-muted-foreground animate-fade-in">Unsaved</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {isDirty && (
              <Button
                size="sm"
                onClick={handleSave}
                className="h-7 px-3 text-xs rounded-lg animate-fade-in"
              >
                Save
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleClose}
              aria-label="Close panel"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-5 py-5 space-y-6">

            {/* Due alert banner */}
            {dueInfo && !isDone && (dueInfo.isOverdue || dueInfo.isUrgentSoon) && (
              <div
                className={cn(
                  'flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-medium animate-fade-in',
                  dueInfo.isOverdue
                    ? 'bg-destructive/10 text-destructive border border-destructive/20'
                    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                )}
              >
                {dueInfo.isOverdue ? (
                  <AlertCircle className="size-4 flex-shrink-0" />
                ) : (
                  <Clock className="size-4 flex-shrink-0 animate-pulse" />
                )}
                <span>{dueInfo.isOverdue ? 'Overdue' : 'Due soon'} — {dueInfo.label}</span>
              </div>
            )}

            {/* Task title */}
            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Task
              </Label>
              <Textarea
                value={text}
                onChange={(e) => { setText(e.target.value); markDirty(); }}
                placeholder="What needs to be done?"
                className={cn(
                  'resize-none text-sm font-medium leading-relaxed border-0 bg-muted/30 rounded-xl px-3 py-2.5 min-h-[72px]',
                  'focus-visible:ring-1 focus-visible:ring-primary/40',
                  isDone && 'line-through text-muted-foreground'
                )}
                aria-label="Task title"
              />
            </div>

            {/* Status */}
            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Status
              </Label>
              <div className="flex gap-2">
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => { setStatus(opt.value); markDirty(); }}
                    className={cn(
                      'flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium border transition-all duration-150',
                      status === opt.value
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-border bg-card text-muted-foreground hover:border-border/80 hover:text-foreground'
                    )}
                    aria-pressed={status === opt.value}
                  >
                    {opt.icon}
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Quadrant */}
            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                <ArrowRight className="size-3" />
                Priority Quadrant
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {QUADRANTS.map((q) => (
                  <button
                    key={q.id}
                    onClick={() => { setQuadrant(q.id); markDirty(); }}
                    className={cn(
                      'flex flex-col items-start rounded-xl px-3 py-2.5 text-left border transition-all duration-150',
                      quadrant === q.id
                        ? cn('border-primary/40 bg-primary/8 ring-1 ring-primary/20')
                        : 'border-border bg-card hover:border-border/80'
                    )}
                    aria-pressed={quadrant === q.id}
                  >
                    <span className="text-xs font-semibold text-foreground">{q.label}</span>
                    <span className="text-[10px] text-muted-foreground mt-0.5">{q.subtitle}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Due date + time */}
            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                <CalendarClock className="size-3" />
                Due Date & Time
              </Label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input
                    type="date"
                    value={dueDate}
                    min={getTodayStr()}
                    onChange={(e) => { setDueDate(e.target.value); markDirty(); }}
                    className="h-9 text-xs rounded-xl bg-muted/30 border-0 focus-visible:ring-1 focus-visible:ring-primary/40"
                    aria-label="Due date"
                  />
                </div>
                <div className="w-28">
                  <Input
                    type="time"
                    value={dueTime}
                    onChange={(e) => { setDueTime(e.target.value); markDirty(); }}
                    className="h-9 text-xs rounded-xl bg-muted/30 border-0 focus-visible:ring-1 focus-visible:ring-primary/40"
                    aria-label="Due time"
                    disabled={!dueDate}
                  />
                </div>
                {dueDate && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => { setDueDate(''); setDueTime(''); markDirty(); }}
                    aria-label="Clear due date"
                    className="text-muted-foreground hover:text-foreground flex-shrink-0"
                  >
                    <X className="size-3.5" />
                  </Button>
                )}
              </div>
              {dueInfo && !isDone && (
                <p
                  className={cn(
                    'text-[11px] font-medium animate-fade-in',
                    dueInfo.isOverdue ? 'text-destructive' : dueInfo.isUrgentSoon ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
                  )}
                >
                  {dueInfo.label}
                </p>
              )}
            </div>

            {/* Reminder */}
            {isNotificationSupported() && notificationPermission === 'granted' && dueDate && !isDone && (
              <div className="space-y-2">
                <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  <Bell className="size-3" />
                  Reminder
                </Label>
                <div className="flex items-center gap-3 rounded-xl bg-muted/30 px-3.5 py-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={reminderEnabled}
                    onClick={() => { setReminderEnabled((v) => !v); markDirty(); }}
                    className={cn(
                      'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      reminderEnabled ? 'bg-primary' : 'bg-muted-foreground/30'
                    )}
                  >
                    <span
                      className={cn(
                        'pointer-events-none inline-block size-4 rounded-full bg-white shadow-lg ring-0 transition-transform duration-200',
                        reminderEnabled ? 'translate-x-4' : 'translate-x-0'
                      )}
                    />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground">
                      {reminderEnabled ? 'Reminder on' : 'No reminder'}
                    </p>
                    {reminderEnabled && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Notify me before this task is due
                      </p>
                    )}
                  </div>
                  {reminderEnabled && (
                    <Select
                      value={String(reminderMinutes)}
                      onValueChange={(v) => { setReminderMinutes(Number(v) as ReminderMinutes); markDirty(); }}
                    >
                      <SelectTrigger className="h-8 w-32 text-xs rounded-lg flex-shrink-0 bg-card border-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {REMINDER_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={String(opt.value)} className="text-xs">
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            )}

            {/* Reminder — permission not granted */}
            {isNotificationSupported() && notificationPermission !== 'granted' && dueDate && !isDone && (
              <div className="rounded-xl bg-muted/30 px-3.5 py-3 flex items-center gap-2.5">
                <BellOff className="size-4 text-muted-foreground flex-shrink-0" />
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {notificationPermission === 'denied'
                    ? 'Notifications are blocked. Enable them in browser settings to set reminders.'
                    : 'Enable notifications in the Reminders panel to set task reminders.'}
                </p>
              </div>
            )}

            {/* Category */}
            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                <Tag className="size-3" />
                Category
              </Label>
              <Select
                value={category || '__none__'}
                onValueChange={(v) => { setCategory(v === '__none__' ? '' : v); markDirty(); }}
              >
                <SelectTrigger className="h-9 text-xs rounded-xl bg-muted/30 border-0 focus-visible:ring-1 focus-visible:ring-primary/40 w-full">
                  <SelectValue placeholder="No category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    <span className="text-muted-foreground">No category</span>
                  </SelectItem>
                  {CATEGORIES.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', cat.color)}>
                        {cat.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {categoryConfig && (
                <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium animate-fade-in', categoryConfig.color)}>
                  {categoryConfig.label}
                </span>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                <FileText className="size-3" />
                Notes
              </Label>
              <Textarea
                value={note}
                onChange={(e) => { setNote(e.target.value); markDirty(); }}
                placeholder="Add context, links, or thoughts…"
                className="resize-none text-sm leading-relaxed border-0 bg-muted/30 rounded-xl px-3 py-2.5 min-h-[120px] focus-visible:ring-1 focus-visible:ring-primary/40"
                aria-label="Task notes"
              />
            </div>

            {/* Metadata */}
            <div className="rounded-xl bg-muted/30 px-3.5 py-3 space-y-1.5">
              <p className="text-[10px] text-muted-foreground/60 uppercase tracking-widest font-semibold">Info</p>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  <span className="text-muted-foreground/60">Created</span>{' '}
                  {formatCreated(todo.createdAt)}
                </p>
                {todo.completedAt && (
                  <p className="text-xs text-muted-foreground">
                    <span className="text-muted-foreground/60">Completed</span>{' '}
                    {formatCreated(todo.completedAt)}
                  </p>
                )}
                {todo.sourceNoteId && onOpenNote && (
                  <button
                    type="button"
                    onClick={() => onOpenNote(todo.sourceNoteId!)}
                    className="flex items-center gap-1.5 text-xs text-a-accent-700 hover:underline"
                  >
                    <FileTextIcon className="size-3" aria-hidden /> Open the note this came from
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-border bg-card flex-shrink-0">
          <div>
            {confirmDelete ? (
              <div className="flex items-center gap-2 animate-fade-in">
                <span className="text-xs text-destructive font-medium">Delete this task?</span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDelete}
                  className="h-7 px-3 text-xs rounded-lg"
                >
                  Yes, delete
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                  className="h-7 px-3 text-xs rounded-lg"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                className="h-7 px-3 text-xs rounded-lg text-muted-foreground hover:text-destructive gap-1.5"
              >
                <Trash2 className="size-3.5" />
                Delete
              </Button>
            )}
          </div>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!isDirty || !text.trim()}
            className="h-7 px-4 text-xs rounded-lg"
          >
            Save changes
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
