import { useState, useEffect } from 'react';
import { AlarmClock, Newspaper, Repeat, Repeat2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import type {
  AutomationRule,
  AutomationRuleFormValues,
  TriggerType,
  UrgencyLevel,
  RecurrenceFrequency,
} from '@/types/automation';
import { URGENCY_LABELS } from '@/types/automation';
import { ReminderStepList } from '@/components/automations/ReminderStepList';
import { MAX_STEPS, normaliseSteps, toMinutes } from '@/lib/reminderSteps';

// ── Default form values ───────────────────────────────────────────────────────

function defaultValues(rule?: AutomationRule): AutomationRuleFormValues {
  if (rule) {
    return {
      name: rule.name,
      description: rule.description ?? '',
      taskId: rule.taskId ?? '',
      triggerType: rule.triggerType,
      status: rule.status,
      urgency: rule.urgency,
      // Rules written before steps existed arrive with the server's derived
      // single step, so an old rule opens showing exactly when it fires.
      offsetMinutes: rule.offsetMinutes?.length
        ? [...rule.offsetMinutes]
        : [toMinutes({
            value: rule.reminderOffset?.value ?? 30,
            unit: rule.reminderOffset?.unit ?? 'minutes',
            direction: 'before',
          })],
      recurrenceFrequency: rule.recurrence?.frequency ?? 'daily',
      recurrenceTime: rule.recurrence?.time ?? '09:00',
      recurrenceDayOfWeek: String(rule.recurrence?.dayOfWeek ?? 1),
      recurrenceDayOfMonth: String(rule.recurrence?.dayOfMonth ?? 1),
      notifyInApp: rule.notifyInApp,
      notifyBrowser: rule.notifyBrowser,
      notifyEmail: rule.notifyEmail ?? false,
    };
  }
  return {
    name: '',
    description: '',
    taskId: '',
    triggerType: 'due-date',
    status: 'active',
    urgency: 'medium',
    offsetMinutes: [-30],
    recurrenceFrequency: 'daily',
    recurrenceTime: '09:00',
    recurrenceDayOfWeek: '1',
    recurrenceDayOfMonth: '1',
    notifyInApp: true,
    notifyBrowser: false,
    notifyEmail: false,
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

interface FormErrors {
  name?: string;
  offsetMinutes?: string;
  recurrenceTime?: string;
  notifications?: string;
}

function validate(values: AutomationRuleFormValues): FormErrors {
  const errors: FormErrors = {};
  if (!values.name.trim()) errors.name = 'Rule name is required.';
  if (isTaskDriven(values.triggerType)) {
    const steps = values.offsetMinutes;
    if (steps.length === 0) {
      errors.offsetMinutes = 'Add at least one step.';
    } else if (steps.length > MAX_STEPS) {
      errors.offsetMinutes = `At most ${MAX_STEPS} steps.`;
    } else if (normaliseSteps(steps).length !== steps.length) {
      errors.offsetMinutes = 'Two steps fire at the same moment — change or remove one.';
    }
  }
  if (
    (values.triggerType === 'recurring' || values.triggerType === 'daily-digest') &&
    !values.recurrenceTime
  ) {
    errors.recurrenceTime = 'Time is required.';
  }
  if (!values.notifyInApp && !values.notifyBrowser && !values.notifyEmail) {
    errors.notifications = 'Enable at least one notification channel.';
  }
  return errors;
}

// ── AutomationRuleForm ────────────────────────────────────────────────────────

interface AutomationRuleFormProps {
  open: boolean;
  editingRule?: AutomationRule | null;
  /** A new rule for this task: set when the form is opened from a task. */
  prefillTaskId?: string | null;
  todos: { id: string; text: string }[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: AutomationRuleFormValues) => void;
}

/**
 * The triggers offered. "When overdue" is gone as a separate choice: a step can
 * simply be after the due time, which is what makes one rule able to escalate
 * either side of it. Rules already stored as 'overdue' keep that type — see
 * triggerOf — so editing one never changes when it fires.
 */
const TRIGGER_TYPES: TriggerType[] = [
  'due-date',
  'recurring',
  'daily-digest',
  'status-change',
];

function isTaskDriven(type: TriggerType): boolean {
  return type === 'due-date' || type === 'overdue';
}

/** Which card is lit: a stored 'overdue' rule is the same thing as 'due-date'. */
function triggerOf(type: TriggerType): TriggerType {
  return type === 'overdue' ? 'due-date' : type;
}

const URGENCY_LEVELS: UrgencyLevel[] = ['low', 'medium', 'high', 'critical'];

const DAYS_OF_WEEK = [
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
];

export function AutomationRuleForm({
  open,
  editingRule,
  prefillTaskId,
  todos,
  onOpenChange,
  onSubmit,
}: AutomationRuleFormProps) {
  const [values, setValues] = useState<AutomationRuleFormValues>(() =>
    defaultValues(editingRule ?? undefined)
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState(false);

  // Reset form when dialog opens/closes or editing rule changes
  useEffect(() => {
    if (!open) return;
    const base = defaultValues(editingRule ?? undefined);
    setValues(prefillTaskId && !editingRule
      ? {
          ...base,
          taskId: prefillTaskId,
          triggerType: 'due-date',
          // Named for the task, so the notification's title says which one.
          name: todos.find((t) => t.id === prefillTaskId)?.text.slice(0, 80) ?? base.name,
          offsetMinutes: [-60, -5],
        }
      : base);
    setErrors({});
    setTouched(false);
  }, [open, editingRule, prefillTaskId, todos]);

  const set = <K extends keyof AutomationRuleFormValues>(
    key: K,
    value: AutomationRuleFormValues[K]
  ) => {
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      if (touched) setErrors(validate(next));
      return next;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    const errs = validate(values);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    onSubmit(values);
    onOpenChange(false);
  };

  const isEditing = !!editingRule;
  const showOffsetFields = isTaskDriven(values.triggerType);
  const showRecurrenceFields =
    values.triggerType === 'recurring' || values.triggerType === 'daily-digest';

  /** The prototype's four trigger cards: icon, title, one line under it (showcase 996). */
  const TRIGGER_CARDS: Record<TriggerType, { icon: typeof AlarmClock; title: string; sub: string }> = {
    'due-date': { icon: AlarmClock, title: 'Due date', sub: 'Before or after a task is due' },
    overdue: { icon: AlarmClock, title: 'Due date', sub: 'Before or after a task is due' },
    recurring: { icon: Repeat, title: 'Recurring', sub: 'On a schedule' },
    'daily-digest': { icon: Newspaper, title: 'Daily digest', sub: 'One summary a day' },
    'status-change': { icon: Repeat2, title: 'Status change', sub: 'When a task moves' },
  };
  const LABEL = 'text-[13px] font-medium text-a-ink';
  const noTasks = todos.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto overflow-x-hidden sm:max-w-[720px]">
        <DialogHeader className="mb-4">
          <DialogTitle>{isEditing ? 'Edit automation rule' : 'New automation rule'}</DialogTitle>
          <DialogDescription>Choose when it fires and how you’re told.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-[18px]">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rule-name" className={LABEL}>Rule name <span className="text-q-do" aria-hidden>*</span></label>
            <Input
              id="rule-name"
              value={values.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Escalate overdue contracts"
              aria-invalid={!!errors.name}
              maxLength={100}
              autoFocus
            />
            {errors.name && <p className="text-[12px] text-q-do">{errors.name}</p>}
          </div>

          <div>
            <div className={cn(LABEL, 'mb-1.5')}>Trigger</div>
            <div role="radiogroup" aria-label="Trigger" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TRIGGER_TYPES.map((type) => {
                const { icon: Icon, title, sub } = TRIGGER_CARDS[type];
                const on = triggerOf(values.triggerType) === type;
                return (
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    // A stored 'overdue' rule keeps its own type rather than being rewritten to 'due-date' on save.
                    onClick={() => set('triggerType', isTaskDriven(values.triggerType) && type === 'due-date' ? values.triggerType : type)}
                    className={cn(
                      'rounded-[8px] px-3 py-2.5 text-left transition-colors duration-[120ms]',
                      on ? 'border-[1.5px] border-a-accent bg-a-blue-tint' : 'border border-a-line bg-a-surface hover:bg-a-bg',
                    )}
                  >
                    <span className={cn('inline-flex', on ? 'text-a-accent' : 'text-a-muted')}>
                      <Icon className="size-4" strokeWidth={1.75} aria-hidden />
                    </span>
                    <span className="mt-1.5 block text-[13px] font-semibold text-a-ink">{title}</span>
                    <span className="block text-[12px] leading-[1.25] text-a-faint">{sub}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span id="rule-task-label" className={LABEL}>Task</span>
            <Select value={values.taskId || '__none__'} onValueChange={(v) => set('taskId', v === '__none__' ? '' : v)}>
              <SelectTrigger className="w-full" aria-labelledby="rule-task-label">
                <SelectValue placeholder="Any task" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__"><span className="text-a-faint">{noTasks ? 'No tasks yet' : 'Any task (a global rule)'}</span></SelectItem>
                {values.taskId && !todos.some((t) => t.id === values.taskId) && (
                  // The linked task was deleted elsewhere. Say so rather than fall back to "none", which
                  // would hide — and on save erase — that this rule still points at something gone.
                  <SelectItem value={values.taskId}><span className="text-q-do">⚠ Deleted task — pick another or clear this field</span></SelectItem>
                )}
                {todos.map((t) => (
                  <SelectItem key={t.id} value={t.id}><span className="max-w-[420px] truncate">{t.text}</span></SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {showOffsetFields && (
            <div>
              <div className={cn(LABEL, 'mb-1.5')}>
                Reminder steps <span className="font-normal text-a-faint">· up to {MAX_STEPS}</span>
              </div>
              <ReminderStepList steps={values.offsetMinutes} onChange={(steps) => set('offsetMinutes', steps)} error={errors.offsetMinutes} />
            </div>
          )}

          {showRecurrenceFields && (
            <div className="flex flex-col gap-3">
              <div className={LABEL}>Schedule</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-[12px] font-medium text-a-faint">Frequency</Label>
                  <Select value={values.recurrenceFrequency} onValueChange={(v) => set('recurrenceFrequency', v as RecurrenceFrequency)}>
                    <SelectTrigger className="w-full" aria-label="Frequency"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekdays">Weekdays (Mon–Fri)</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-[12px] font-medium text-a-faint" htmlFor="rule-time">Time</Label>
                  <Input id="rule-time" type="time" value={values.recurrenceTime} onChange={(e) => set('recurrenceTime', e.target.value)} aria-invalid={!!errors.recurrenceTime} />
                  {errors.recurrenceTime && <p className="text-[12px] text-q-do">{errors.recurrenceTime}</p>}
                </div>
              </div>
              {values.recurrenceFrequency === 'weekly' && (
                <div className="flex flex-col gap-1.5">
                  <Label className="text-[12px] font-medium text-a-faint">Day of week</Label>
                  <Select value={values.recurrenceDayOfWeek} onValueChange={(v) => set('recurrenceDayOfWeek', v)}>
                    <SelectTrigger className="w-full" aria-label="Day of week"><SelectValue /></SelectTrigger>
                    <SelectContent>{DAYS_OF_WEEK.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              {values.recurrenceFrequency === 'monthly' && (
                <div className="flex flex-col gap-1.5">
                  <Label className="text-[12px] font-medium text-a-faint">Day of month</Label>
                  <Select value={values.recurrenceDayOfMonth} onValueChange={(v) => set('recurrenceDayOfMonth', v)}>
                    <SelectTrigger className="w-full" aria-label="Day of month"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 28 }, (_, i) => String(i + 1)).map((day) => <SelectItem key={day} value={day}>Day {day}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          <div className="grid gap-[18px] sm:grid-cols-2">
            <div>
              <div className={cn(LABEL, 'mb-1.5')}>Urgency</div>
              <div role="radiogroup" aria-label="Urgency" className="flex flex-wrap gap-1.5">
                {URGENCY_LEVELS.map((level) => {
                  const on = values.urgency === level;
                  return (
                    <button
                      key={level}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => set('urgency', level)}
                      className={cn(
                        'h-7 rounded-[4px] border px-2.5 text-[11px] font-medium transition-colors duration-[120ms]',
                        on ? 'border-a-accent bg-a-blue-tint text-a-accent' : 'border-a-line-strong bg-a-surface text-a-muted hover:bg-a-bg',
                      )}
                    >
                      {URGENCY_LABELS[level]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className={cn(LABEL, 'mb-1.5')}>Notify me by</div>
              <div className="flex flex-col gap-1.5">
                <Checkbox label="In-app" checked={values.notifyInApp} onChange={(e) => set('notifyInApp', e.target.checked)} />
                <Checkbox label="Browser notification" checked={values.notifyBrowser} onChange={(e) => set('notifyBrowser', e.target.checked)} />
                <Checkbox label="Email" checked={values.notifyEmail} onChange={(e) => set('notifyEmail', e.target.checked)} />
              </div>
              {values.notifyEmail && (
                // Better to say so than to offer a switch that quietly does nothing.
                <p className="mt-1.5 text-[12px] text-a-faint">Email is not set up on this server, so a rule that asks for it is recorded as skipped.</p>
              )}
              {errors.notifications && <p className="mt-1.5 text-[12px] text-q-do">{errors.notifications}</p>}
            </div>
          </div>

          <DialogFooter>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="h-7 rounded-[3px] px-3 text-[11px] font-semibold text-a-muted transition-colors duration-[120ms] hover:bg-a-line-soft"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="h-7 rounded-[3px] bg-a-accent px-3 text-[11px] font-semibold text-white transition-colors duration-[120ms] hover:bg-a-accent-600"
            >
              {isEditing ? 'Save changes' : 'Save rule'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
