import { describe, expect, it } from 'vitest';
import { QUADRANT_EMPTY, allDoneCopy, firstRunCopy, tasksEmptyKind } from '@/lib/emptyStates';

describe('tasksEmptyKind', () => {
  it('a list that never had a task is first-run, whatever the filters say', () => {
    expect(tasksEmptyKind({ total: 0, done: 0, filtersActive: false })).toBe('first-run');
    expect(tasksEmptyKind({ total: 0, done: 0, filtersActive: true })).toBe('first-run');
  });

  it('tasks hidden by a filter are "filtered", even when they are all done', () => {
    expect(tasksEmptyKind({ total: 5, done: 5, filtersActive: true })).toBe('filtered');
    expect(tasksEmptyKind({ total: 5, done: 2, filtersActive: true })).toBe('filtered');
  });

  it('nothing hidden and every task done is the good news', () => {
    expect(tasksEmptyKind({ total: 5, done: 5, filtersActive: false })).toBe('all-done');
  });
});

describe('the copy', () => {
  it('names the list and how much was finished', () => {
    expect(allDoneCopy('Work', 4).title).toBe('Everything in Work is done');
    expect(allDoneCopy('Work', 4).description).toMatch(/^4 finished\./);
  });

  it('a first list says how to begin; a later empty list says it is empty', () => {
    expect(firstRunCopy('Work', false).title).toBe('Start with one task');
    expect(firstRunCopy('Side project', true).title).toBe('Nothing in Side project yet');
  });

  it('gives every quadrant its own line, sentence case, no exclamation', () => {
    for (const line of Object.values(QUADRANT_EMPTY)) {
      expect(line).toMatch(/^[A-Z]/);
      expect(line).not.toMatch(/!|\p{Emoji_Presentation}/u);
    }
    expect(new Set(Object.values(QUADRANT_EMPTY)).size).toBe(4);
  });
});
