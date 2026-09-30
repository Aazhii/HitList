import { describe, expect, it } from 'vitest';
import { parseQuickCapture } from '@/lib/quickCapture';

// A Wednesday.
const NOW = new Date('2026-09-30T10:00:00');
const p = (s: string) => parseQuickCapture(s, NOW);

describe('parseQuickCapture', () => {
  it('leaves a plain line alone', () => {
    expect(p('Buy milk')).toEqual({ title: 'Buy milk' });
  });

  it('reads today, tomorrow and relative days', () => {
    expect(p('Call Sam tomorrow')).toEqual({ title: 'Call Sam', dueDate: '2026-10-01' });
    expect(p('today write report')).toEqual({ title: 'write report', dueDate: '2026-09-30' });
    expect(p('Renew passport in 3 days')).toEqual({ title: 'Renew passport', dueDate: '2026-10-03' });
    expect(p('Review in 2 weeks')).toEqual({ title: 'Review', dueDate: '2026-10-14' });
  });

  it('reads weekdays as the next one, never today', () => {
    expect(p('Standup fri').dueDate).toBe('2026-10-02');
    expect(p('Standup next wednesday').dueDate).toBe('2026-10-07');
  });

  it('reads calendar dates, rolling to next year once passed', () => {
    expect(p('Pay rent oct 5').dueDate).toBe('2026-10-05');
    expect(p('Pay rent 5 Oct')).toEqual({ title: 'Pay rent', dueDate: '2026-10-05' });
    expect(p('Dentist sep 1').dueDate).toBe('2027-09-01');
    expect(p('Launch 2026-12-01').dueDate).toBe('2026-12-01');
    expect(p('Nothing feb 31').dueDate).toBeUndefined();
  });

  it('reads times, and a bare time means today', () => {
    expect(p('Lunch tomorrow at 12:30pm')).toEqual({ title: 'Lunch', dueDate: '2026-10-01', dueTime: '12:30' });
    expect(p('Stretch 3pm')).toEqual({ title: 'Stretch', dueDate: '2026-09-30', dueTime: '15:00' });
    expect(p('Train 18:45 fri')).toEqual({ title: 'Train', dueDate: '2026-10-02', dueTime: '18:45' });
    expect(p('Midnight 12am').dueTime).toBe('00:00');
  });

  it('reads a quadrant tag anywhere in the line', () => {
    expect(p('!do Fix the build')).toEqual({ title: 'Fix the build', quadrant: 'do' });
    expect(p('Plan Q4 !schedule next mon')).toEqual({ title: 'Plan Q4', quadrant: 'schedule', dueDate: '2026-10-05' });
  });

  it('keeps the line when nothing is left to call it', () => {
    expect(p('tomorrow')).toEqual({ title: 'tomorrow', dueDate: '2026-10-01' });
  });

  it('does not eat words that only look like dates', () => {
    expect(p('Sunny day playlist may the best win')).toEqual({ title: 'Sunny day playlist may the best win' });
  });
});
