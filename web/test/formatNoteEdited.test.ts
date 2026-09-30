import { describe, expect, it } from 'vitest';
import { formatNoteEdited } from '@/types/notes';

describe('formatNoteEdited', () => {
  const now = new Date(2026, 9, 3, 15, 0);

  it('says "today" with the time', () => {
    expect(formatNoteEdited(new Date(2026, 9, 3, 9, 42).getTime(), now)).toBe('today, 9:42 AM');
  });

  it('says "yesterday" across midnight, however few hours ago', () => {
    expect(formatNoteEdited(new Date(2026, 9, 2, 23, 50).getTime(), now)).toBe('yesterday, 11:50 PM');
  });

  it('names the day after that', () => {
    expect(formatNoteEdited(new Date(2026, 8, 28, 8, 5).getTime(), now)).toBe('Sep 28, 8:05 AM');
  });
});
