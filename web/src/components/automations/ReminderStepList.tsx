/**
 * The reminder steps of a rule (showcase 1002–1009): a bordered list, one row per firing —
 * its number, when it fires in words, a remove button — and an "Add step" row. A row opens a small
 * editor for the exact amount, unit and before/after; "Add step" offers the usual choices.
 *
 * A rule used to have one offset, and only "before due" — so escalating a task at an hour before,
 * five minutes before, and again once overdue needed three rules. Here it is one list, up to five.
 */
import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  MAX_STEPS, STEP_PRESETS, humanDuration, normaliseSteps, splitMinutes, toMinutes,
  type StepDirection, type StepUnit,
} from '@/lib/reminderSteps';

interface ReminderStepListProps {
  /** Signed minutes, one per firing. */
  steps: number[];
  onChange: (steps: number[]) => void;
  error?: string;
}

/** "1 hour before due", "At due time", "30 minutes after due". */
function label(minutes: number): string {
  if (minutes === 0) return 'At due time';
  return `${humanDuration(minutes)} ${minutes < 0 ? 'before' : 'after'} due`;
}

export function ReminderStepList({ steps, onChange, error }: ReminderStepListProps) {
  const full = steps.length >= MAX_STEPS;

  /** Edited in place and not re-sorted until the list changes length, so a row does not jump under the cursor. */
  const setRow = (index: number, patch: Partial<{ value: number; unit: StepUnit; direction: StepDirection }>) => {
    const next = [...steps];
    next[index] = toMinutes({ ...splitMinutes(steps[index]), ...patch });
    onChange(next);
  };
  const add = (minutes: number) => {
    if (full || steps.includes(minutes)) return;
    onChange(normaliseSteps([...steps, minutes]));
  };
  const remove = (index: number) => onChange(steps.filter((_, i) => i !== index));

  return (
    <div>
      <div className={cn('rounded-[8px] border', error ? 'border-q-do' : 'border-a-line')}>
        {steps.map((minutes, i) => {
          const { value, unit, direction } = splitMinutes(minutes);
          const duplicate = steps.indexOf(minutes) !== i;
          return (
            <div key={i} className="flex h-[45px] items-center gap-3 border-b border-a-line-soft px-3">
              <span className="w-2 flex-shrink-0 text-[11px] text-a-faint">{i + 1}</span>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Edit step ${i + 1}`}
                    className={cn('min-w-0 flex-1 text-left text-[13px] text-a-ink hover:underline', duplicate && 'text-q-do')}
                  >
                    {label(minutes)}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="flex w-[360px] items-center gap-2 p-3">
                  <Input
                    type="number"
                    min={0}
                    max={999}
                    value={value}
                    onChange={(e) => setRow(i, { value: Number(e.target.value) })}
                    aria-label={`Step ${i + 1} amount`}
                    className="h-8 w-20 text-center"
                  />
                  <Select value={unit} onValueChange={(v) => setRow(i, { unit: v as StepUnit })}>
                    <SelectTrigger size="sm" className="h-8 flex-1 text-[13px]" aria-label={`Step ${i + 1} unit`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="minutes">minutes</SelectItem>
                      <SelectItem value="hours">hours</SelectItem>
                      <SelectItem value="days">days</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={direction} onValueChange={(v) => setRow(i, { direction: v as StepDirection })} disabled={minutes === 0}>
                    <SelectTrigger size="sm" className="h-8 w-[112px] text-[13px]" aria-label={`Step ${i + 1} direction`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="before">before due</SelectItem>
                      <SelectItem value="after">after due</SelectItem>
                    </SelectContent>
                  </Select>
                </PopoverContent>
              </Popover>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`Remove step ${i + 1}`}
                className="flex size-7 flex-shrink-0 items-center justify-center rounded-[4px] text-a-muted transition-colors duration-[120ms] hover:bg-a-line-soft hover:text-a-ink"
              >
                <X className="size-4" strokeWidth={1.75} />
              </button>
            </div>
          );
        })}

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={full}
              className="flex h-10 w-full items-center gap-2 px-3 text-[11px] font-semibold text-a-muted transition-colors duration-[120ms] hover:bg-a-bg disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="size-4" strokeWidth={1.75} aria-hidden />
              Add step
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="flex w-[220px] flex-col gap-0.5 p-1.5">
            {STEP_PRESETS.map((preset) => (
              <button
                key={preset.minutes}
                type="button"
                disabled={steps.includes(preset.minutes)}
                onClick={() => add(preset.minutes)}
                className="flex min-h-[30px] items-center rounded-[4px] px-2 text-left text-[14px] text-a-ink hover:bg-a-line-soft disabled:cursor-default disabled:text-a-faint disabled:hover:bg-transparent"
              >
                {preset.label}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>

      {error && <p className="mt-1.5 text-[12px] text-q-do">{error}</p>}
    </div>
  );
}
