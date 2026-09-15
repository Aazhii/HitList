import { beforeEach, describe, expect, it } from 'vitest';
import { claimLegacyNotes, notesStorageKey } from '@/lib/notesStorage';
import { NOTES_STORAGE_KEY, type Note } from '@/types/notes';

const note = (id: string, updatedAt: number, title = id): Note => ({
  id, title, blocks: [], createdAt: 1, updatedAt,
});

describe('notesStorageKey', () => {
  it('gives each user their own key', () => {
    expect(notesStorageKey('u1')).not.toBe(notesStorageKey('u2'));
    expect(notesStorageKey('u1')).toContain(NOTES_STORAGE_KEY);
  });
});

describe('claimLegacyNotes', () => {
  beforeEach(() => localStorage.clear());

  it('moves shared notes into the signed-in user\'s key', () => {
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify([note('a', 5)]));

    claimLegacyNotes(localStorage, 'u1');

    expect(JSON.parse(localStorage.getItem(notesStorageKey('u1'))!)).toEqual([note('a', 5)]);
    expect(localStorage.getItem(NOTES_STORAGE_KEY)).toBeNull();
  });

  it('merges with notes the user already has, keeping the newer copy', () => {
    localStorage.setItem(notesStorageKey('u1'), JSON.stringify([note('a', 9, 'mine, newer'), note('b', 1)]));
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify([note('a', 3, 'shared, older'), note('c', 2)]));

    claimLegacyNotes(localStorage, 'u1');

    const stored = JSON.parse(localStorage.getItem(notesStorageKey('u1'))!) as Note[];
    expect(stored.map((n) => n.id).sort()).toEqual(['a', 'b', 'c']);
    expect(stored.find((n) => n.id === 'a')!.title).toBe('mine, newer');
  });

  it('gives a second account nothing once the notes are claimed', () => {
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify([note('a', 5)]));

    claimLegacyNotes(localStorage, 'u1');
    claimLegacyNotes(localStorage, 'u2');

    expect(localStorage.getItem(notesStorageKey('u2'))).toBeNull();
  });

  it('leaves unreadable data where it is', () => {
    localStorage.setItem(NOTES_STORAGE_KEY, '{not json');
    claimLegacyNotes(localStorage, 'u1');
    expect(localStorage.getItem(NOTES_STORAGE_KEY)).toBe('{not json');

    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify([note('a', 5)]));
    localStorage.setItem(notesStorageKey('u1'), '{corrupt');
    claimLegacyNotes(localStorage, 'u1');
    expect(localStorage.getItem(NOTES_STORAGE_KEY)).not.toBeNull();
    expect(localStorage.getItem(notesStorageKey('u1'))).toBe('{corrupt');
  });

  it('does nothing without a signed-in user', () => {
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify([note('a', 5)]));
    claimLegacyNotes(localStorage, null);
    expect(localStorage.getItem(NOTES_STORAGE_KEY)).not.toBeNull();
  });
});
