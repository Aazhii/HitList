import { describe, expect, it } from 'vitest';
import { parseQuickCapture } from '@/lib/quickCapture';

// A Wednesday.
const NOW = new Date('2026-09-30T10:00:00');
const p = (s: string) => parseQuickCapture(s, NOW);

describe('tasks it needs first (">")', () => {
  it('reads each part after ">" as a task this one needs first, and leaves the title', () => {
    expect(p('Ship release >Write notes >Run tests')).toEqual({ title: 'Ship release', needs: ['Write notes', 'Run tests'] });
    // Nothing is left to call it, so the line is kept as typed rather than making an empty task.
    expect(p('>Write notes').title).toBe('>Write notes');
    expect(p('>Write notes').needs).toEqual(['Write notes']);
  });

  it('works next to a date, a time and a quadrant when those come before it or after a "!"', () => {
    expect(p('Ship release fri 3pm >Write notes >Run tests !do')).toEqual({
      title: 'Ship release', dueDate: '2026-10-02', dueTime: '15:00', quadrant: 'do', needs: ['Write notes', 'Run tests'],
    });
  });

  it('a lone ">" with a space after it is just text, and repeats are read once', () => {
    expect(p('Is 5 > 3 true')).toEqual({ title: 'Is 5 > 3 true' });
    expect(p('Ship >Write notes >write notes').needs).toEqual(['Write notes']);
  });
});

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

  it('reads a repeat, and starts it today when no date is given', () => {
    expect(p('Water plants every week')).toEqual({ title: 'Water plants', dueDate: '2026-09-30', recurrence: 'weekly' });
    expect(p('Standup every weekday 9:30')).toEqual({ title: 'Standup', dueDate: '2026-09-30', dueTime: '09:30', recurrence: 'weekdays' });
    expect(p('Pay rent oct 5 monthly')).toEqual({ title: 'Pay rent', dueDate: '2026-10-05', recurrence: 'monthly' });
    expect(p('Stretch daily').recurrence).toBe('daily');
    expect(p('Weekly review')).toEqual({ title: 'Weekly review' });
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
