/**
 * The calendar layout's model: month grids, and the day-drop-target constants
 * UnifiedCalendar's DnD handlers key off. All in the browser's own calendar,
 * the same days the due-date filters use.
 */
import { localDateKey } from '@/lib/taskFilters';

/** A month; `month` is 0–11, as Date uses. */
export interface CalendarMonth {
  year: number;
  month: number;
}

export const monthOf = (date: Date): CalendarMonth => ({ year: date.getFullYear(), month: date.getMonth() });

export function shiftMonth(m: CalendarMonth, delta: number): CalendarMonth {
  return monthOf(new Date(m.year, m.month + delta, 1));
}

export function isInMonth(dateKey: string, m: CalendarMonth): boolean {
  const [y, mo] = dateKey.split('-').map(Number);
  return y === m.year && mo - 1 === m.month;
}

/**
 * The weeks a month grid shows, Monday first: from the Monday on or before the
 * 1st to the Sunday on or after the last day. Each day is a YYYY-MM-DD key.
 *
 * Steps a day at a time with setDate rather than adding 24 hours, so a
 * daylight-saving change cannot skip or repeat a day.
 */
export function monthWeeks(m: CalendarMonth): string[][] {
  const first = new Date(m.year, m.month, 1);
  const last = new Date(m.year, m.month + 1, 0);
  const day = new Date(m.year, m.month, 1 - ((first.getDay() + 6) % 7));
  const end = localDateKey(new Date(m.year, m.month, last.getDate() + (6 - ((last.getDay() + 6) % 7))));

  const weeks: string[][] = [];
  for (;;) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(localDateKey(day));
      day.setDate(day.getDate() + 1);
    }
    weeks.push(week);
    if (week[6] === end) return weeks;
  }
}

export const CALENDAR_DAY_PREFIX = 'calendar-day:';
/** The tray of tasks without a due date, as a drop target. */
export const NO_DATE = 'none';
