import { useState, useEffect } from 'react';
import { Zap, Bell, Mail, Monitor, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
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
import type {
  AutomationRule,
  AutomationRuleFormValues,
  TriggerType,
  UrgencyLevel,
  AutomationStatus,
  RecurrenceFrequency,
} from '@/types/automation';
import { TRIGGER_TYPE_LABELS, URGENCY_LABELS } from '@/types/automation';
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

// ── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
      {children}
    </p>
  );
}

// ── Toggle chip ───────────────────────────────────────────────────────────────

function ToggleChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium border transition-all duration-150',
        active
          ? 'border-primary/40 bg-primary/8 text-foreground ring-1 ring-primary/20'
          : 'border-border bg-card text-muted-foreground hover:border-border/80 hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}

// ── AutomationRuleForm ────────────────────────────────────────────────────────

interface AutomationRuleFormProps {
  open: boolean;
  editingRule?: AutomationRule | null;
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

const URGENCY_CHIP_COLORS: Record<UrgencyLevel, string> = {
  low:      'border-border bg-card text-muted-foreground',
  medium:   'border-blue-500/30 bg-blue-500/8 text-blue-600 dark:text-blue-400',
  high:     'border-amber-500/30 bg-amber-500/8 text-amber-600 dark:text-amber-400',
  critical: 'border-rose-500/30 bg-rose-500/8 text-rose-600 dark:text-rose-400',
};

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
    if (open) {
      setValues(defaultValues(editingRule ?? undefined));
      setErrors({});
      setTouched(false);
    }
  }, [open, editingRule]);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <Zap className="size-4 text-primary" />
            {isEditing ? 'Edit automation rule' : 'New automation rule'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 pt-1">
          {/* Rule name */}
          <div className="space-y-1.5">
            <SectionLabel>Rule name</SectionLabel>
            <Input
              value={values.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Morning focus digest"
              className={cn('rounded-xl text-sm', errors.name && 'border-destructive')}
              maxLength={100}
              autoFocus
            />
            {errors.name && (
              <p className="text-xs text-destructive animate-fade-in">{errors.name}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <SectionLabel>Description <span className="normal-case font-normal">(optional)</span></SectionLabel>
            <Textarea
              value={values.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="What does this rule do?"
              className="rounded-xl text-sm resize-none min-h-[64px]"
              maxLength={300}
            />
          </div>

          {/* Linked task */}
          <div className="space-y-1.5">
            <SectionLabel>Linked task <span className="normal-case font-normal">(optional)</span></SectionLabel>
            <Select
              value={values.taskId || '__none__'}
              onValueChange={(v) => set('taskId', v === '__none__' ? '' : v)}
            >
              <SelectTrigger className="h-9 text-xs rounded-xl w-full">
                <SelectValue placeholder="No task linked (global rule)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  <span className="text-muted-foreground">No task linked (global rule)</span>
                </SelectItem>
                {todos.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <span className="truncate max-w-[300px]">{t.text}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Trigger type */}
          <div className="space-y-1.5">
            <SectionLabel>Trigger</SectionLabel>
            <div className="grid grid-cols-2 gap-2">
              {TRIGGER_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  // Keep a stored 'overdue' rule on its own type rather than
                  // rewriting it to 'due-date' on save: the two behave the
                  // same, and not churning the row is the safer default.
                  onClick={() => set('triggerType', isTaskDriven(values.triggerType) && type === 'due-date' ? values.triggerType : type)}
                  className={cn(
                    'flex flex-col items-start rounded-xl px-3 py-2.5 text-left border transition-all duration-150',
                    triggerOf(values.triggerType) === type
                      ? 'border-primary/40 bg-primary/8 ring-1 ring-primary/20'
                      : 'border-border bg-card hover:border-border/80'
                  )}
                >
                  <span className="text-xs font-semibold text-foreground">
                    {TRIGGER_TYPE_LABELS[type]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Escalation steps (due-date trigger) */}
          {showOffsetFields && (
            <div className="space-y-1.5 animate-fade-in">
              <SectionLabel>Notify me</SectionLabel>
              <ReminderStepList
                steps={values.offsetMinutes}
                onChange={(steps) => set('offsetMinutes', steps)}
                error={errors.offsetMinutes}
              />
            </div>
          )}

          {/* Recurrence schedule */}
          {showRecurrenceFields && (
            <div className="space-y-3 animate-fade-in">
              <SectionLabel>Schedule</SectionLabel>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-medium text-muted-foreground">Frequency</Label>
                  <Select
                    value={values.recurrenceFrequency}
                    onValueChange={(v) => set('recurrenceFrequency', v as RecurrenceFrequency)}
                  >
                    <SelectTrigger className="h-9 text-xs rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekdays">Weekdays (Mon–Fri)</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-medium text-muted-foreground">Time</Label>
                  <Input
                    type="time"
                    value={values.recurrenceTime}
                    onChange={(e) => set('recurrenceTime', e.target.value)}
                    className={cn(
                      'h-9 text-xs rounded-xl',
                      errors.recurrenceTime && 'border-destructive'
                    )}
                  />
                  {errors.recurrenceTime && (
                    <p className="text-xs text-destructive">{errors.recurrenceTime}</p>
                  )}
                </div>
              </div>

              {values.recurrenceFrequency === 'weekly' && (
                <div className="space-y-1.5 animate-fade-in">
                  <Label className="text-[10px] font-medium text-muted-foreground">Day of week</Label>
                  <Select
                    value={values.recurrenceDayOfWeek}
                    onValueChange={(v) => set('recurrenceDayOfWeek', v)}
                  >
                    <SelectTrigger className="h-9 text-xs rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DAYS_OF_WEEK.map((d) => (
                        <SelectItem key={d.value} value={d.value}>
                          {d.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {values.recurrenceFrequency === 'monthly' && (
                <div className="space-y-1.5 animate-fade-in">
                  <Label className="text-[10px] font-medium text-muted-foreground">Day of month</Label>
                  <Select
                    value={values.recurrenceDayOfMonth}
                    onValueChange={(v) => set('recurrenceDayOfMonth', v)}
                  >
                    <SelectTrigger className="h-9 text-xs rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 28 }, (_, i) => String(i + 1)).map((day) => (
                        <SelectItem key={day} value={day}>
                          Day {day}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {/* Urgency */}
          <div className="space-y-1.5">
            <SectionLabel>Urgency level</SectionLabel>
            <div className="flex items-center gap-2 flex-wrap">
              {URGENCY_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => set('urgency', level)}
                  className={cn(
                    'rounded-xl px-3 py-1.5 text-xs font-medium border transition-all duration-150',
                    values.urgency === level
                      ? cn(URGENCY_CHIP_COLORS[level], 'ring-1 ring-current/30')
                      : 'border-border bg-card text-muted-foreground hover:border-border/80 hover:text-foreground'
                  )}
                >
                  {URGENCY_LABELS[level]}
                </button>
              ))}
            </div>
          </div>

          {/* Notification channels */}
          <div className="space-y-1.5">
            <SectionLabel>Notify via</SectionLabel>
            <div className="flex items-center gap-2">
              <ToggleChip
                active={values.notifyInApp}
                onClick={() => set('notifyInApp', !values.notifyInApp)}
              >
                <Bell className="size-3" />
                In-app
              </ToggleChip>
              <ToggleChip
                active={values.notifyBrowser}
                onClick={() => set('notifyBrowser', !values.notifyBrowser)}
              >
                <Monitor className="size-3" />
                Browser
              </ToggleChip>
              <ToggleChip
                active={values.notifyEmail}
                onClick={() => set('notifyEmail', !values.notifyEmail)}
              >
                <Mail className="size-3" />
                Email
              </ToggleChip>
            </div>
            {values.notifyEmail && (
              // Better to say so than to offer a switch that quietly does
              // nothing: the server skips email until a sender is configured.
              <p className="text-[11px] text-muted-foreground">
                Email needs a verified sender address on the server (NOTIFY_FROM_EMAIL).
                Until then these arrive in-app and in the browser only.
              </p>
            )}
            {errors.notifications && (
              <p className="text-xs text-destructive animate-fade-in flex items-center gap-1">
                <Info className="size-3" />
                {errors.notifications}
              </p>
            )}
          </div>

          {/* Status */}
          <div className="space-y-1.5">
            <SectionLabel>Initial status</SectionLabel>
            <div className="flex items-center gap-2">
              {(['active', 'paused', 'draft'] as AutomationStatus[]).map((s) => (
                <ToggleChip
                  key={s}
                  active={values.status === s}
                  onClick={() => set('status', s)}
                >
                  <span
                    className={cn(
                      'size-1.5 rounded-full',
                      s === 'active'
                        ? 'bg-emerald-500'
                        : s === 'paused'
                        ? 'bg-amber-500'
                        : 'bg-muted-foreground/40'
                    )}
                  />
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </ToggleChip>
              ))}
            </div>
          </div>

          <DialogFooter className="pt-2 gap-2">
            <Button
              type="button"
              variant="ghost"
              className="rounded-xl"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="rounded-xl flex-1">
              {isEditing ? 'Save changes' : 'Create rule'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
