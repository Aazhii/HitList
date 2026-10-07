import { describe, expect, it } from 'vitest';
import { existingNeeds, needsTitle, resolveNeeds, needsToFinish, openNeeds, waitingCounts, waitingOn, wouldCycle } from '@/lib/taskNeeds';
import type { Todo } from '@/types/todo';

const t = (id: string, status: Todo['status'] = 'todo', needsFirst?: string[]): Todo =>
  ({ id, text: id, status, createdAt: 0, listId: 'l', order: 0, quadrant: 'do', ...(needsFirst ? { needsFirst } : {}) });
const map = (...tasks: Todo[]) => new Map(tasks.map((x) => [x.id, x]));

describe('openNeeds', () => {
  it('lists the prerequisites that exist and are not done, in the order chosen', () => {
    const all = [t('a', 'todo', ['c', 'b', 'gone', 'd']), t('b'), t('c', 'in-progress'), t('d', 'done')];
    expect(openNeeds(all[0], map(...all)).map((x) => x.id)).toEqual(['c', 'b']);
    expect(existingNeeds(all[0], map(...all)).map((x) => x.id)).toEqual(['c', 'b', 'd']);
  });

  it('ignores itself, repeats, and a task with no links', () => {
    const all = [t('a', 'todo', ['a', 'b', 'b']), t('b'), t('z')];
    expect(openNeeds(all[0], map(...all)).map((x) => x.id)).toEqual(['b']);
    expect(openNeeds(all[2], map(...all))).toEqual([]);
  });
});

describe('wouldCycle', () => {
  const all = [t('a', 'todo', ['b']), t('b', 'todo', ['c']), t('c'), t('d')];
  it('catches a task needing itself, a direct loop and a longer one', () => {
    const by = map(...all);
    expect(wouldCycle('a', 'a', by)).toBe(true);
    expect(wouldCycle('b', 'a', by)).toBe(true);  // a needs b, so b cannot need a
    expect(wouldCycle('c', 'a', by)).toBe(true);  // a -> b -> c, so c cannot need a
    expect(wouldCycle('a', 'c', by)).toBe(false); // a needing c as well is fine
    expect(wouldCycle('d', 'a', by)).toBe(false);
  });

  it('survives a loop already in the data', () => {
    const loop = [t('x', 'todo', ['y']), t('y', 'todo', ['x']), t('q')];
    expect(wouldCycle('q', 'x', map(...loop))).toBe(false);
  });
});

describe('waitingCounts and waitingOn', () => {
  const all = [t('a', 'todo', ['b', 'c']), t('b'), t('c', 'done'), t('d', 'done', ['b']), t('e', 'todo', ['gone'])];
  it('counts only open tasks and only prerequisites that are still open and exist', () => {
    expect([...waitingCounts(all)]).toEqual([['a', 1]]);
  });
  it('says which open tasks are waiting on one', () => {
    expect(waitingOn('b', all).map((x) => x.id)).toEqual(['a']); // d is done, so it is not waiting
    expect(waitingOn('c', all).map((x) => x.id)).toEqual(['a']);
    expect(waitingOn('a', all)).toEqual([]);
  });
});

describe('needsToFinish', () => {
  it('puts a prerequisite before the task that needs it, each once, without the tasks themselves', () => {
    const all = [t('big', 'todo', ['a', 'b']), t('a', 'todo', ['c']), t('b', 'todo', ['c']), t('c'), t('done', 'done')];
    expect(needsToFinish([all[0]], map(...all))).toEqual(['c', 'a', 'b']);
    // Two tasks that share a prerequisite: still once.
    const two = [t('x', 'todo', ['s']), t('y', 'todo', ['s']), t('s')];
    expect(needsToFinish([two[0], two[1]], map(...two))).toEqual(['s']);
  });

  it('does not loop on a cycle left in the data', () => {
    const loop = [t('x', 'todo', ['y']), t('y', 'todo', ['x'])];
    expect(needsToFinish([loop[0]], map(...loop))).toEqual(['y']);
  });
});

describe('needsTitle', () => {
  it('reads naturally for one and for several', () => {
    expect(needsTitle('Ship release', 1)).toBe('Ship release still needs 1 task first');
    expect(needsTitle('Ship release', 3)).toBe('Ship release still needs 3 tasks first');
  });
});

describe('resolveNeeds (quick add)', () => {
  const all = [t('w'), t('x'), t('d', 'done')];
  const named = [{ ...t('a'), text: 'Write notes' }, { ...t('b'), text: 'Write tests' }, { ...t('c'), text: 'Run tests' }, { ...t('z', 'done'), text: 'Old thing' }];
  it('links an exact title (ignoring case) and a title that only one task starts with', () => {
    expect(resolveNeeds(['write notes', 'run'], named)).toEqual({ ids: ['a', 'c'], newTitles: [] });
  });
  it('makes a new task when nothing matches, when several start with it, or when the only match is done', () => {
    expect(resolveNeeds(['Write', 'Brand new', 'Old thing'], named)).toEqual({ ids: [], newTitles: ['Write', 'Brand new', 'Old thing'] });
  });
  it('does not repeat a task or a title', () => {
    expect(resolveNeeds(['Run tests', 'run tests', 'New one', 'new one'], named)).toEqual({ ids: ['c'], newTitles: ['New one'] });
    expect(all.length).toBe(3);
  });
});
