/**
 * The escalation steps of a rule.
 *
 * A rule used to have one offset, and only "before due" — so escalating a task
 * at an hour before, five minutes before, and again once overdue needed three
 * rules. Here it is one list: each row is an exact amount, in the unit the user
 * thinks in, before or after the task's due time.
 */
import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  MAX_STEPS,
  STEP_PRESETS,
  normaliseSteps,
  splitMinutes,
  summarise,
  toMinutes,
  type StepDirection,
  type StepUnit,
} from '@/lib/reminderSteps';

interface ReminderStepListProps {
  /** Signed minutes, one per firing. */
  steps: number[];
  onChange: (steps: number[]) => void;
  error?: string;
}

export function ReminderStepList({ steps, onChange, error }: ReminderStepListProps) {
  const full = steps.length >= MAX_STEPS;

  /**
   * Rows are edited in place and only sorted when the list changes length.
   * Sorting on every keystroke would move the row out from under the cursor
   * as soon as a number crossed one of its neighbours.
   */
  const setRow = (index: number, patch: Partial<{ value: number; unit: StepUnit; direction: StepDirection }>) => {
    const current = splitMinutes(steps[index]);
    const next = [...steps];
    next[index] = toMinutes({ ...current, ...patch });
    onChange(next);
  };

  const add = (minutes: number) => {
    if (full || steps.includes(minutes)) return;
    onChange(normaliseSteps([...steps, minutes]));
  };

  const remove = (index: number) => onChange(steps.filter((_, i) => i !== index));

  return (
    <div className="space-y-2">
      <div className="space-y-2">
        {steps.map((minutes, i) => {
          const { value, unit, direction } = splitMinutes(minutes);
          const atDue = minutes === 0;
          const duplicate = steps.indexOf(minutes) !== i;

          return (
            <div key={i} className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={999}
                value={value}
                onChange={(e) => setRow(i, { value: Number(e.target.value) })}
                aria-label={`Step ${i + 1} amount`}
                className={cn('h-9 w-20 rounded-xl text-center text-xs', duplicate && 'border-destructive')}
              />
              <Select value={unit} onValueChange={(v) => setRow(i, { unit: v as StepUnit })}>
                <SelectTrigger className="h-9 flex-1 rounded-xl text-xs" aria-label={`Step ${i + 1} unit`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minutes">minutes</SelectItem>
                  <SelectItem value="hours">hours</SelectItem>
                  <SelectItem value="days">days</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={direction}
                onValueChange={(v) => setRow(i, { direction: v as StepDirection })}
                disabled={atDue}
              >
                <SelectTrigger className="h-9 w-[124px] rounded-xl text-xs" aria-label={`Step ${i + 1} direction`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="before">before due</SelectItem>
                  <SelectItem value="after">after due</SelectItem>
                </SelectContent>
              </Select>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`Remove step ${i + 1}`}
                className="flex size-8 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Quick adds. A preset already in the list is spent. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {STEP_PRESETS.map((preset) => {
          const used = steps.includes(preset.minutes);
          return (
            <button
              key={preset.minutes}
              type="button"
              disabled={used || full}
              onClick={() => add(preset.minutes)}
              className={cn(
                'flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] transition-colors duration-150',
                used || full
                  ? 'cursor-default text-muted-foreground/40'
                  : 'text-muted-foreground hover:border-border/80 hover:text-foreground',
              )}
            >
              <Plus className="size-2.5" />
              {preset.label}
            </button>
          );
        })}
      </div>

      <p className={cn('text-xs', error ? 'text-destructive' : 'text-muted-foreground')}>
        {error ?? (steps.length > 0 ? `Notifies ${summarise(steps)}.` : 'Add at least one step.')}
      </p>

      {full && (
        <p className="text-[11px] text-muted-foreground">
          {MAX_STEPS} steps is the limit — every step is a notification.
        </p>
      )}
    </div>
  );
}
