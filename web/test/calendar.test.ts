import { describe, expect, it } from 'vitest';
import { isInMonth, monthWeeks, shiftMonth } from '@/lib/calendar';

describe('monthWeeks', () => {
  it('starts on the Monday before the 1st and ends on the Sunday after the last day', () => {
    // 1 September 2026 is a Tuesday; the 30th is a Wednesday.
    const weeks = monthWeeks({ year: 2026, month: 8 });
    expect(weeks).toHaveLength(5);
    expect(weeks[0][0]).toBe('2026-08-31');
    expect(weeks[0][1]).toBe('2026-09-01');
    expect(weeks[4][6]).toBe('2026-10-04');
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it('is exactly four weeks for a February that starts on a Monday', () => {
    const weeks = monthWeeks({ year: 2027, month: 1 });
    expect(weeks).toHaveLength(4);
    expect(weeks[0][0]).toBe('2027-02-01');
    expect(weeks[3][6]).toBe('2027-02-28');
  });

  it('never repeats or skips a day, across a daylight-saving change', () => {
    const days = monthWeeks({ year: 2026, month: 2 }).flat();
    expect(new Set(days).size).toBe(days.length);
    expect(days).toContain('2026-03-29');
    expect(days).toContain('2026-03-30');
  });
});

describe('shiftMonth / isInMonth', () => {
  it('crosses year boundaries both ways', () => {
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth({ year: 2027, month: 0 }, -1)).toEqual({ year: 2026, month: 11 });
  });

  it('tells a day from the month shown from a neighbouring one', () => {
    expect(isInMonth('2026-09-30', { year: 2026, month: 8 })).toBe(true);
    expect(isInMonth('2026-10-01', { year: 2026, month: 8 })).toBe(false);
  });
});
