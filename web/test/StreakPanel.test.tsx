/**
 * Weekly progress: the seven-day window, the streak, and what the tiles show.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StreakPanel, currentStreak, lastSevenDays, weekRangeLabel } from '@/components/StreakPanel';
import type { Todo } from '@/types/todo';

const NOW = new Date(2026, 8, 29, 15, 0); // Tue Sep 29 2026

const done = (id: string, completedAt: Date): Todo => ({
  id, text: id, status: 'done', createdAt: 1, listId: 'l', order: 0, quadrant: 'do', completedAt: completedAt.getTime(),
});

describe('week window', () => {
  it('is the seven local days ending today, oldest first', () => {
    const days = lastSevenDays(NOW);
    expect(days).toHaveLength(7);
    expect(days[0].getDate()).toBe(23);
    expect(days[6].getDate()).toBe(29);
  });

  it('labels the range the way the dialog description reads', () => {
    expect(weekRangeLabel(NOW)).toBe('Sep 23 – Sep 29');
  });
});

describe('currentStreak', () => {
  const keys = (...d: Array<[number, number]>) => new Set(d.map(([m, day]) => `2026-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`));

  it('counts consecutive days ending today', () => {
    expect(currentStreak(keys([9, 29], [9, 28], [9, 27]), NOW)).toBe(3);
  });

  it('does not break the streak just because today has no completion yet', () => {
    expect(currentStreak(keys([9, 28], [9, 27]), NOW)).toBe(2);
  });

  it('stops at the first gap, and is 0 with nothing done', () => {
    expect(currentStreak(keys([9, 29], [9, 27]), NOW)).toBe(1);
    expect(currentStreak(new Set(), NOW)).toBe(0);
  });
});

describe('StreakPanel', () => {
  it('shows streak, today, this week and all-time, and a bar per day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const todos = [
      done('a', new Date(2026, 8, 29, 9)),
      done('b', new Date(2026, 8, 29, 10)),
      done('c', new Date(2026, 8, 28, 10)),
      done('old', new Date(2026, 7, 1, 10)),
    ];
    render(<StreakPanel todos={todos} onClose={() => {}} />);
    const tile = (label: string) => screen.getByText(label).parentElement!;
    expect(tile('Streak')).toHaveTextContent('2d');
    expect(tile('Today')).toHaveTextContent('2');
    expect(tile('This week')).toHaveTextContent('3');
    expect(tile('All time')).toHaveTextContent('4');
    expect(screen.getByText('Completed per day')).toBeInTheDocument();
    expect(screen.getAllByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/)).toHaveLength(7);
    vi.useRealTimers();
  });
});
