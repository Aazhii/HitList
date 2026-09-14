/**
 * Reminder scheduling maths.
 *
 * Tasks store DueDate and DueTime with no timezone, and the server runs in
 * UTC — so a reminder set for 2:30pm in Kolkata would fire at 8pm there if the
 * digits were parsed naively. These tests pin the conversion, including across
 * DST boundaries where a one-pass offset lookup lands an hour out.
 *
 * They also pin the null cases. The original code let a malformed date become
 * NaN, and `NaN < now` is false, so a bad due date produced a reminder that
 * simply never fired and never complained.
 */
import { describe, it, expect } from 'vitest';
import {
  zonedToEpoch,
  isValidDate,
  isValidTime,
  planTaskReminder,
  reminderDedupeKey,
  renderReminder,
  DEFAULT_REMINDER_MINUTES,
  type SchedulableTask,
} from '../../server/notifications/schedule.ts';

describe('zonedToEpoch', () => {
  it('resolves a Kolkata wall clock to the right instant', () => {
    // Asia/Kolkata is UTC+5:30 year round, so 14:30 local is 09:00 UTC.
    const epoch = zonedToEpoch('2026-09-20', '14:30', 'Asia/Kolkata');
    expect(new Date(epoch!).toISOString()).toBe('2026-09-20T09:00:00.000Z');
  });

  it('resolves a UTC wall clock to itself', () => {
    const epoch = zonedToEpoch('2026-09-20', '14:30', 'UTC');
    expect(new Date(epoch!).toISOString()).toBe('2026-09-20T14:30:00.000Z');
  });

  it('handles a zone behind UTC', () => {
    // New York in September is UTC-4 (EDT).
    const epoch = zonedToEpoch('2026-09-20', '14:30', 'America/New_York');
    expect(new Date(epoch!).toISOString()).toBe('2026-09-20T18:30:00.000Z');
  });

  it('applies the correct offset either side of a DST transition', () => {
    // US DST ended 2026-11-01. Same wall clock, different real offset:
    // 12:00 EDT (UTC-4) on Oct 31 vs 12:00 EST (UTC-5) on Nov 2.
    const before = zonedToEpoch('2026-10-31', '12:00', 'America/New_York');
    const after = zonedToEpoch('2026-11-02', '12:00', 'America/New_York');

    expect(new Date(before!).toISOString()).toBe('2026-10-31T16:00:00.000Z');
    expect(new Date(after!).toISOString()).toBe('2026-11-02T17:00:00.000Z');
  });

  it('handles a half-hour offset zone', () => {
    const epoch = zonedToEpoch('2026-06-15', '09:15', 'Asia/Kathmandu'); // UTC+5:45
    expect(new Date(epoch!).toISOString()).toBe('2026-06-15T03:30:00.000Z');
  });

  it('handles midnight without wrapping to the wrong day', () => {
    const epoch = zonedToEpoch('2026-09-20', '00:00', 'Asia/Kolkata');
    expect(new Date(epoch!).toISOString()).toBe('2026-09-19T18:30:00.000Z');
  });

  it('returns null rather than NaN for malformed input', () => {
    // NaN would propagate silently: `NaN < now` is false, so the reminder
    // would never fire and never surface an error.
    expect(zonedToEpoch('not-a-date', '14:30', 'UTC')).toBeNull();
    expect(zonedToEpoch('2026-09-20', '25:99', 'UTC')).toBeNull();
    expect(zonedToEpoch('2026-02-31', '10:00', 'UTC')).toBeNull();
    expect(zonedToEpoch('', '', 'UTC')).toBeNull();
  });
});

describe('validators', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(isValidDate('2026-09-20')).toBe(true);
    expect(isValidDate('2024-02-29')).toBe(true);   // a real leap day
    expect(isValidDate('2026-02-29')).toBe(false);  // 2026 is not a leap year
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('20260920')).toBe(false);
  });

  it('accepts 24-hour times and rejects the rest', () => {
    expect(isValidTime('00:00')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('9:30')).toBe(false);
  });
});

describe('planTaskReminder', () => {
  const base: SchedulableTask = {
    id: 'task-1',
    title: 'Prepare the deck',
    status: 'todo',
    dueDate: '2026-09-20',
    dueTime: '14:30',
    reminderEnabled: true,
    reminderMinutesBefore: 30,
  };

  it('fires the configured interval before the due time', () => {
    const plan = planTaskReminder(base, 'Asia/Kolkata')!;
    expect(new Date(plan.dueAt).toISOString()).toBe('2026-09-20T09:00:00.000Z');
    expect(new Date(plan.fireAt).toISOString()).toBe('2026-09-20T08:30:00.000Z');
    expect(plan.minutesBefore).toBe(30);
  });

  it('treats a task with no time as due at end of day', () => {
    const plan = planTaskReminder({ ...base, dueTime: undefined }, 'UTC')!;
    expect(new Date(plan.dueAt).toISOString()).toBe('2026-09-20T23:59:00.000Z');
  });

  it('falls back to the default offset when none is set', () => {
    const plan = planTaskReminder({ ...base, reminderMinutesBefore: undefined }, 'UTC')!;
    expect(plan.minutesBefore).toBe(DEFAULT_REMINDER_MINUTES);
  });

  it('schedules nothing when there is nothing to schedule', () => {
    expect(planTaskReminder({ ...base, reminderEnabled: false }, 'UTC')).toBeNull();
    expect(planTaskReminder({ ...base, dueDate: undefined }, 'UTC')).toBeNull();
    expect(planTaskReminder({ ...base, status: 'done' }, 'UTC')).toBeNull();
    expect(planTaskReminder({ ...base, status: 'DONE' }, 'UTC')).toBeNull();
    expect(planTaskReminder({ ...base, dueDate: 'garbage' }, 'UTC')).toBeNull();
  });

  it('still plans a reminder whose time has already passed', () => {
    // The queue delivers overdue entries rather than dropping them, so a
    // missed sweep means a late reminder, not a lost one. Filtering here would
    // defeat that.
    const plan = planTaskReminder({ ...base, dueDate: '2020-01-01' }, 'UTC');
    expect(plan).not.toBeNull();
    expect(plan!.fireAt).toBeLessThan(Date.now());
  });
});

describe('reminderDedupeKey', () => {
  const base: SchedulableTask = {
    id: 'task-1',
    title: 'Prepare the deck',
    status: 'todo',
    dueDate: '2026-09-20',
    dueTime: '14:30',
    reminderEnabled: true,
    reminderMinutesBefore: 30,
  };

  it('is stable when an edit does not change when it fires', () => {
    // Renaming a task must not enqueue a second reminder for the same moment.
    const a = planTaskReminder(base, 'UTC')!;
    const b = planTaskReminder({ ...base, title: 'Prepare the deck (v2)' }, 'UTC')!;
    expect(a.dedupeKey).toBe(b.dedupeKey);
  });

  it('changes when the due time moves', () => {
    // A new key means a new row, so the stale reminder can be cancelled
    // without any risk of both firing.
    const a = planTaskReminder(base, 'UTC')!;
    const b = planTaskReminder({ ...base, dueTime: '16:00' }, 'UTC')!;
    expect(a.dedupeKey).not.toBe(b.dedupeKey);
  });

  it('changes when the offset moves', () => {
    const a = planTaskReminder(base, 'UTC')!;
    const b = planTaskReminder({ ...base, reminderMinutesBefore: 60 }, 'UTC')!;
    expect(a.dedupeKey).not.toBe(b.dedupeKey);
  });

  it('differs per task', () => {
    expect(reminderDedupeKey('a', 1, 30)).not.toBe(reminderDedupeKey('b', 1, 30));
  });

  it('stays within the column limit for a UUID task id', () => {
    // DedupeKey is varchar(200), and Catalyst clamps silently above 255.
    const key = reminderDedupeKey(crypto.randomUUID(), Date.now(), 1440);
    expect(key.length).toBeLessThan(200);
  });
});

describe('renderReminder', () => {
  it('phrases minutes and hours naturally', () => {
    expect(renderReminder({ id: 'x', title: 'T', status: 'todo' }, 30).body)
      .toBe('Due in 30 minutes.');
    expect(renderReminder({ id: 'x', title: 'T', status: 'todo' }, 60).body)
      .toBe('Due in 1 hour.');
    expect(renderReminder({ id: 'x', title: 'T', status: 'todo' }, 120).body)
      .toBe('Due in 2 hours.');
  });

  it('carries the task title', () => {
    expect(renderReminder({ id: 'x', title: 'Ship it', status: 'todo' }, 15).title)
      .toBe('Ship it');
  });
});
