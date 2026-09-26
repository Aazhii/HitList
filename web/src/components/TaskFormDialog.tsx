import React, { useState, useEffect } from 'react';
import { CalendarIcon, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { CATEGORIES, getCategoryConfig } from '@/types/todo';
import type { Todo, TodoStatus } from '@/types/todo';

interface TaskFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** If provided, dialog is in edit mode */
  editTodo?: Todo | null;
  onSubmit: (data: TaskFormData) => void;
}

export interface TaskFormData {
  text: string;
  note?: string;
  dueDate?: string;
  category?: string;
  status?: TodoStatus;
}

function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function TaskFormDialog({ open, onOpenChange, editTodo, onSubmit }: TaskFormDialogProps) {
  const isEdit = !!editTodo;

  // Derive initial form values from editTodo — reset key forces re-mount on open
  const [text, setText] = useState(editTodo?.text ?? '');
  const [note, setNote] = useState(editTodo?.note ?? '');
  const [dueDate, setDueDate] = useState(editTodo?.dueDate ?? '');
  const [category, setCategory] = useState(editTodo?.category ?? '');
  const [status, setStatus] = useState<TodoStatus>(editTodo?.status ?? 'todo');
  const [errors, setErrors] = useState<{ text?: string; dueDate?: string }>({});

  const validate = (): boolean => {
    const newErrors: { text?: string; dueDate?: string } = {};
    if (!text.trim()) {
      newErrors.text = 'Task description is required.';
    }
    // Warn (not block) if due date is in the past for new tasks
    if (!isEdit && dueDate && dueDate < getTodayStr()) {
      newErrors.dueDate = 'Due date is in the past — are you sure?';
      // This is a warning, not a hard block — we still allow submit
    }
    setErrors(newErrors);
    return !newErrors.text; // only text is a hard block
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    onSubmit({
      text: text.trim(),
      note: note.trim() || undefined,
      dueDate: dueDate || undefined,
      category: category || undefined,
      status: isEdit ? status : undefined,
    });
    onOpenChange(false);
  };

  const selectedCategory = getCategoryConfig(category);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            {isEdit ? 'Edit task' : 'New task'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Task text */}
          <div className="space-y-1.5">
            <Label htmlFor="task-text" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Task
            </Label>
            <Textarea
              id="task-text"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (errors.text) setErrors((prev) => ({ ...prev, text: undefined }));
              }}
              placeholder="What's your next small step?"
              className={cn(
                'resize-none min-h-[72px] rounded-2xl text-sm leading-relaxed',
                errors.text && 'border-destructive focus-visible:ring-destructive/30'
              )}
              maxLength={200}
              autoFocus
            />
            {errors.text && (
              <p className="text-xs text-destructive animate-fade-in">{errors.text}</p>
            )}
          </div>

          {/* Note */}
          <div className="space-y-1.5">
            <Label htmlFor="task-note" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Note <span className="normal-case font-normal">(optional)</span>
            </Label>
            <Input
              id="task-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Any extra context…"
              className="rounded-2xl text-sm"
              maxLength={200}
            />
          </div>

          {/* Category + Due date row */}
          <div className="grid grid-cols-2 gap-3">
            {/* Category */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <Tag className="size-3" /> Category
              </Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-full rounded-2xl text-sm h-9">
                  <SelectValue placeholder="None">
                    {selectedCategory ? (
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', selectedCategory.color)}>
                        {selectedCategory.label}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">None</span>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none-clear">
                    <span className="text-muted-foreground">No category</span>
                  </SelectItem>
                  {CATEGORIES.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', cat.color)}>
                        {cat.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Due date */}
            <div className="space-y-1.5">
              <Label htmlFor="task-due" className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <CalendarIcon className="size-3" /> Due date
              </Label>
              <Input
                id="task-due"
                type="date"
                value={dueDate}
                onChange={(e) => {
                  setDueDate(e.target.value);
                  if (errors.dueDate) setErrors((prev) => ({ ...prev, dueDate: undefined }));
                }}
                className={cn(
                  'rounded-2xl text-sm h-9',
                  errors.dueDate && 'border-amber-400 focus-visible:ring-amber-400/30'
                )}
              />
              {errors.dueDate && (
                <p className="text-xs text-amber-500 animate-fade-in">{errors.dueDate}</p>
              )}
            </div>
          </div>

          {/* Status (edit mode only) */}
          {isEdit && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Status
              </Label>
              <Select value={status} onValueChange={(v) => setStatus(v as TodoStatus)}>
                <SelectTrigger className="w-full rounded-2xl text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todo">To do</SelectItem>
                  <SelectItem value="in-progress">In progress</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <DialogFooter className="pt-1 gap-2">
            <Button
              type="button"
              variant="ghost"
              className="rounded-2xl"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="rounded-2xl flex-1">
              {isEdit ? 'Save changes' : 'Add task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
