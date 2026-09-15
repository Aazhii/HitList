import { describe, expect, it } from 'vitest';
import { dayKeyInZone, shiftDayKey, streakDays } from '../../server/stats/days.ts';

const IST = 'Asia/Kolkata';
const at = (iso: string) => new Date(iso).getTime();

describe('dayKeyInZone', () => {
  it("uses the user's calendar day, not the server's", () => {
    // 20:00 UTC on the 14th is 01:30 on the 15th in India.
    expect(dayKeyInZone(at('2026-09-14T20:00:00Z'), IST)).toBe('2026-09-15');
    expect(dayKeyInZone(at('2026-09-14T20:00:00Z'), 'UTC')).toBe('2026-09-14');
  });
});

describe('shiftDayKey', () => {
  it('crosses month and year boundaries', () => {
    expect(shiftDayKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDayKey('2025-12-31', 1)).toBe('2026-01-01');
  });
});

describe('streakDays', () => {
  it('counts a completion after midnight towards the right day — the bug this fixes', () => {
    const now = at('2026-09-15T02:00:00+05:30');
    const completions = [at('2026-09-15T01:00:00+05:30'), at('2026-09-14T10:00:00+05:30')];

    // In India these are two different days.
    expect(streakDays(completions, IST, now)).toBe(2);
    // Read in UTC, both fall on the 14th — the old server behaviour.
    expect(streakDays(completions, 'UTC', now)).toBe(1);
  });

  it('keeps yesterday\'s streak when nothing is done yet today', () => {
    const now = at('2026-09-15T09:00:00+05:30');
    expect(streakDays([at('2026-09-14T18:00:00+05:30'), at('2026-09-13T18:00:00+05:30')], IST, now)).toBe(2);
  });

  it('stops at a gap', () => {
    const now = at('2026-09-15T09:00:00+05:30');
    expect(streakDays([at('2026-09-15T08:00:00+05:30'), at('2026-09-13T18:00:00+05:30')], IST, now)).toBe(1);
  });

  it('ignores tasks never completed', () => {
    expect(streakDays([0, 0], IST, Date.now())).toBe(0);
  });
});
