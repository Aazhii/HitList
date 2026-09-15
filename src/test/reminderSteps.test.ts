import { describe, expect, it } from 'vitest';
import {
  MAX_STEPS,
  formatStep,
  humanDuration,
  normaliseSteps,
  splitMinutes,
  summarise,
  toMinutes,
} from '@/lib/reminderSteps';

describe('toMinutes', () => {
  it('signs the amount by direction', () => {
    expect(toMinutes({ value: 1, unit: 'hours', direction: 'before' })).toBe(-60);
    expect(toMinutes({ value: 30, unit: 'minutes', direction: 'after' })).toBe(30);
    expect(toMinutes({ value: 2, unit: 'days', direction: 'before' })).toBe(-2880);
  });

  it('ignores a sign typed into the number', () => {
    expect(toMinutes({ value: -5, unit: 'minutes', direction: 'before' })).toBe(-5);
  });
});

describe('splitMinutes', () => {
  it('reads back in the unit the user would have typed', () => {
    expect(splitMinutes(-60)).toEqual({ value: 1, unit: 'hours', direction: 'before' });
    expect(splitMinutes(-1440)).toEqual({ value: 1, unit: 'days', direction: 'before' });
    expect(splitMinutes(-90)).toEqual({ value: 90, unit: 'minutes', direction: 'before' });
    expect(splitMinutes(30)).toEqual({ value: 30, unit: 'minutes', direction: 'after' });
  });

  it('round-trips every step', () => {
    for (const minutes of [-2880, -1440, -90, -60, -5, 0, 30, 120]) {
      expect(toMinutes(splitMinutes(minutes))).toBe(minutes);
    }
  });
});

describe('formatStep / summarise', () => {
  it('says which side of the due time each step is', () => {
    expect(formatStep(-60)).toBe('1 hour before due');
    expect(formatStep(-5)).toBe('5 minutes before due');
    expect(formatStep(0)).toBe('when it falls due');
    expect(formatStep(30)).toBe('30 minutes after due');
  });

  it('reads the whole escalation as one line, earliest first', () => {
    expect(summarise([30, -5, -60])).toBe(
      '1 hour before due, then 5 minutes before due, then 30 minutes after due',
    );
  });

  it('says so when there is nothing yet', () => {
    expect(summarise([])).toBe('No steps yet');
  });
});

describe('humanDuration', () => {
  it('promotes only exact multiples', () => {
    expect(humanDuration(45)).toBe('45 minutes');
    expect(humanDuration(60)).toBe('1 hour');
    expect(humanDuration(90)).toBe('90 minutes');
    expect(humanDuration(1440)).toBe('1 day');
  });
});

describe('normaliseSteps', () => {
  it('sorts, dedupes and caps', () => {
    expect(normaliseSteps([0, -5, -60, -5])).toEqual([-60, -5, 0]);
    expect(normaliseSteps(Array.from({ length: 20 }, (_, i) => -(i + 1)))).toHaveLength(MAX_STEPS);
  });
});
