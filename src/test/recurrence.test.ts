/**
 * Recurring schedules.
 *
 * Every assertion here is written as an absolute UTC instant, because that is
 * what the queue compares and a bug in this file shows up as a rule firing at
 * the wrong hour rather than as an exception. Asia/Kolkata (UTC+5:30, no DST)
 * and Europe/Berlin (which does have DST) are used deliberately: the half-hour
 * offset catches sloppy hour arithmetic, and the DST transition catches the
 * assumption that a day is always 24 hours long.
 */
import { describe, it, expect } from 'vitest';
import { nextRecurrence, recurrenceDedupeKey } from '../../server/automations/recurrence.ts';
import type { Recurrence } from '../../server/automations/recurrence.ts';

const IST = 'Asia/Kolkata';
const BERLIN = 'Europe/Berlin';

/** Reads an ISO instant, for writing expectations legibly. */
function at(iso: string): number {
  return new Date(iso).getTime();
}

function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

function daily(time: string): Recurrence {
  return { frequency: 'daily', time };
}

describe('daily', () => {
  it('fires today when the time is still ahead', () => {
    // 08:00 UTC is 13:30 IST, so 18:00 IST is still to come.
    expect(iso(nextRecurrence(daily('18:00'), IST, at('2030-06-15T08:00:00Z'))))
      .toBe('2030-06-15T12:30:00.000Z');
  });

  it('rolls to tomorrow once the time has passed', () => {
    expect(iso(nextRecurrence(daily('09:00'), IST, at('2030-06-15T08:00:00Z'))))
      .toBe('2030-06-16T03:30:00.000Z');
  });

  it('is strictly after, so a rule that just fired advances', () => {
    // The loop bug: if "next" could equal "now", a rule re-selects the instant
    // it just fired at and fires forever.
    const fired = at('2030-06-15T03:30:00Z');   // 09:00 IST
    expect(iso(nextRecurrence(daily('09:00'), IST, fired)))
      .toBe('2030-06-16T03:30:00.000Z');
  });

  it('uses the owner\'s calendar day, not the server\'s', () => {
    // 23:30 UTC on the 15th is already 05:00 on the 16th in Kolkata, so an
    // 09:00 rule belongs to the 16th local — the same UTC day it is elsewhere.
    expect(iso(nextRecurrence(daily('09:00'), IST, at('2030-06-15T23:30:00Z'))))
      .toBe('2030-06-16T03:30:00.000Z');
  });

  it('handles a half-hour offset without rounding to the hour', () => {
    expect(iso(nextRecurrence(daily('00:15'), IST, at('2030-06-15T00:00:00Z'))))
      .toBe('2030-06-15T18:45:00.000Z');
  });
});

describe('weekdays', () => {
  const r: Recurrence = { frequency: 'weekdays', time: '09:00' };

  it('fires on the next weekday', () => {
    // 2030-06-14 is a Friday; after it, the next weekday is Monday the 17th.
    expect(iso(nextRecurrence(r, IST, at('2030-06-14T06:00:00Z'))))
      .toBe('2030-06-17T03:30:00.000Z');
  });

  it('skips the weekend entirely', () => {
    // Saturday the 15th.
    expect(iso(nextRecurrence(r, IST, at('2030-06-15T00:00:00Z'))))
      .toBe('2030-06-17T03:30:00.000Z');
  });

  it('fires the same day when that day is a weekday and the time is ahead', () => {
    // Monday the 17th, before 09:00 IST (03:30 UTC).
    expect(iso(nextRecurrence(r, IST, at('2030-06-17T00:00:00Z'))))
      .toBe('2030-06-17T03:30:00.000Z');
  });
});

describe('weekly', () => {
  it('fires on the requested weekday', () => {
    // dayOfWeek 3 = Wednesday. 2030-06-15 is a Saturday, so the 19th.
    const r: Recurrence = { frequency: 'weekly', time: '10:00', dayOfWeek: 3 };
    expect(iso(nextRecurrence(r, IST, at('2030-06-15T00:00:00Z'))))
      .toBe('2030-06-19T04:30:00.000Z');
  });

  it('advances a full week when the day has just passed', () => {
    const r: Recurrence = { frequency: 'weekly', time: '10:00', dayOfWeek: 3 };
    const justAfter = at('2030-06-19T04:30:00Z');
    expect(iso(nextRecurrence(r, IST, justAfter))).toBe('2030-06-26T04:30:00.000Z');
  });

  it('falls back to Monday rather than never firing', () => {
    // A rule with no day chosen must still produce an instant; matching
    // nothing would leave it silently inert.
    const r: Recurrence = { frequency: 'weekly', time: '10:00' };
    expect(iso(nextRecurrence(r, IST, at('2030-06-15T00:00:00Z'))))
      .toBe('2030-06-17T04:30:00.000Z');
  });
});

describe('monthly', () => {
  it('fires on the requested day', () => {
    const r: Recurrence = { frequency: 'monthly', time: '08:00', dayOfMonth: 20 };
    expect(iso(nextRecurrence(r, IST, at('2030-06-15T00:00:00Z'))))
      .toBe('2030-06-20T02:30:00.000Z');
  });

  it('rolls to next month once the day has passed', () => {
    const r: Recurrence = { frequency: 'monthly', time: '08:00', dayOfMonth: 10 };
    expect(iso(nextRecurrence(r, IST, at('2030-06-15T00:00:00Z'))))
      .toBe('2030-07-10T02:30:00.000Z');
  });

  it('clamps to the last day of a month too short for it', () => {
    // The decision: a rule set for the 31st fires on 28 February rather than
    // skipping February altogether.
    const r: Recurrence = { frequency: 'monthly', time: '08:00', dayOfMonth: 31 };
    expect(iso(nextRecurrence(r, IST, at('2030-02-01T00:00:00Z'))))
      .toBe('2030-02-28T02:30:00.000Z');
  });

  it('uses the 29th in a leap February', () => {
    const r: Recurrence = { frequency: 'monthly', time: '08:00', dayOfMonth: 31 };
    expect(iso(nextRecurrence(r, IST, at('2032-02-01T00:00:00Z'))))
      .toBe('2032-02-29T02:30:00.000Z');
  });

  it('crosses a year boundary', () => {
    const r: Recurrence = { frequency: 'monthly', time: '08:00', dayOfMonth: 5 };
    expect(iso(nextRecurrence(r, IST, at('2030-12-10T00:00:00Z'))))
      .toBe('2031-01-05T02:30:00.000Z');
  });

  it('treats a nonsense day as the first of the month', () => {
    const r: Recurrence = { frequency: 'monthly', time: '08:00', dayOfMonth: 0 };
    expect(iso(nextRecurrence(r, IST, at('2030-06-15T00:00:00Z'))))
      .toBe('2030-07-01T02:30:00.000Z');
  });
});

describe('daylight saving', () => {
  it('keeps the same wall-clock time across the spring transition', () => {
    // Berlin moves to UTC+2 on 2030-03-31. A 09:00 rule is 08:00 UTC before
    // and 07:00 UTC after — the same local time, a different instant. Getting
    // this wrong shifts every rule by an hour twice a year.
    const before = nextRecurrence(daily('09:00'), BERLIN, at('2030-03-29T12:00:00Z'));
    const after  = nextRecurrence(daily('09:00'), BERLIN, at('2030-04-01T12:00:00Z'));

    expect(iso(before)).toBe('2030-03-30T08:00:00.000Z');
    expect(iso(after)).toBe('2030-04-02T07:00:00.000Z');
  });

  it('keeps the same wall-clock time across the autumn transition', () => {
    // Berlin returns to UTC+1 on 2030-10-27.
    const before = nextRecurrence(daily('09:00'), BERLIN, at('2030-10-25T12:00:00Z'));
    const after  = nextRecurrence(daily('09:00'), BERLIN, at('2030-10-28T12:00:00Z'));

    expect(iso(before)).toBe('2030-10-26T07:00:00.000Z');
    expect(iso(after)).toBe('2030-10-29T08:00:00.000Z');
  });
});

describe('refusing to guess', () => {
  it('returns null for an unparseable time', () => {
    // Null rather than midnight: a rule that visibly does not fire is better
    // than one that fires at 00:00 for reasons nobody can see.
    expect(nextRecurrence(daily('25:00'), IST, Date.now())).toBeNull();
    expect(nextRecurrence(daily(''), IST, Date.now())).toBeNull();
    expect(nextRecurrence(daily('9am'), IST, Date.now())).toBeNull();
  });
});

describe('recurrenceDedupeKey', () => {
  it('is stable for the same firing', () => {
    // Re-planning after a restart or a rule edit that does not move the
    // schedule must produce the same key, so nothing is enqueued twice.
    expect(recurrenceDedupeKey('r1', 1000)).toBe(recurrenceDedupeKey('r1', 1000));
  });

  it('differs for a different firing, and for a different rule', () => {
    expect(recurrenceDedupeKey('r1', 1000)).not.toBe(recurrenceDedupeKey('r1', 2000));
    expect(recurrenceDedupeKey('r1', 1000)).not.toBe(recurrenceDedupeKey('r2', 1000));
  });
});
