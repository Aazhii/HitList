import { describe, expect, it } from 'vitest';
import { dayKey, finishedYesterday, shouldShowDailyLine, yesterdaySentence } from '@/lib/dailyLine';
import type { Todo } from '@/types/todo';

const NOW = new Date('2026-09-30T09:00:00').getTime();
const done = (at: string): Todo => ({
  id: at, text: 'x', status: 'done', createdAt: 0, completedAt: new Date(at).getTime(), listId: 'l', order: 0, quadrant: 'do',
});

describe('dailyLine', () => {
  it('counts what was finished on the day before, in local time', () => {
    const todos = [done('2026-09-29T00:10:00'), done('2026-09-29T23:50:00'), done('2026-09-30T08:00:00'), done('2026-09-28T12:00:00')];
    expect(finishedYesterday(todos, NOW)).toBe(2);
  });

  it('says nothing about an empty yesterday, and pluralises', () => {
    expect(yesterdaySentence(0)).toBeNull();
    expect(yesterdaySentence(1)).toBe('Yesterday you finished 1 task.');
    expect(yesterdaySentence(3)).toBe('Yesterday you finished 3 tasks.');
  });

  it('shows once a day, and never when switched off', () => {
    expect(shouldShowDailyLine(true, '', NOW)).toBe(true);
    expect(shouldShowDailyLine(true, dayKey(NOW), NOW)).toBe(false);
    expect(shouldShowDailyLine(true, '2026-09-29', NOW)).toBe(true);
    expect(shouldShowDailyLine(false, '', NOW)).toBe(false);
  });
});
