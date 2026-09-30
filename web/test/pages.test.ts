import { describe, expect, it } from 'vitest';
import { agoLabel, libraryPages, resolvePages, type PageInfo } from '@/lib/pages';

const dir: PageInfo[] = [
  { kind: 'list', id: 'l1', name: 'Work' },
  { kind: 'note', id: 'n1', name: 'Onboarding', emoji: '🧭' },
  { kind: 'note', id: 'n2', name: 'Ideas' },
  { kind: 'database', id: 'd1', name: 'Reading list' },
];

describe('resolvePages', () => {
  it('keeps the marks\' order, attaches names, and skips pages that are gone', () => {
    const got = resolvePages([{ kind: 'note', id: 'n2', visitedAt: 5 }, { kind: 'note', id: 'gone' }, { kind: 'list', id: 'l1' }], dir);
    expect(got.map((p) => p.name)).toEqual(['Ideas', 'Work']);
    expect(got[0].visitedAt).toBe(5);
  });
});

describe('libraryPages', () => {
  it('shows recents in visit order and the kind tabs by name', () => {
    expect(libraryPages('recents', dir, [], [{ kind: 'database', id: 'd1' }, { kind: 'list', id: 'l1' }]).map((p) => p.id)).toEqual(['d1', 'l1']);
    expect(libraryPages('notes', dir, [], []).map((p) => p.name)).toEqual(['Ideas', 'Onboarding']);
    expect(libraryPages('lists', dir, [], []).map((p) => p.id)).toEqual(['l1']);
    expect(libraryPages('all', dir, [], []).map((p) => p.name)).toEqual(['Ideas', 'Onboarding', 'Reading list', 'Work']);
  });

  it('is empty for favorites nobody starred', () => {
    expect(libraryPages('favorites', dir, [], [])).toEqual([]);
  });
});

describe('agoLabel', () => {
  const now = new Date(2026, 8, 30, 12, 0).getTime();
  it('reads as words', () => {
    expect(agoLabel(now - 30_000, now)).toBe('Just now');
    expect(agoLabel(now - 5 * 60_000, now)).toBe('5m ago');
    expect(agoLabel(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(agoLabel(now - 30 * 3_600_000, now)).toBe('Yesterday');
    expect(agoLabel(now - 4 * 86_400_000, now)).toBe('4d ago');
    expect(agoLabel(undefined, now)).toBe('');
  });
});
