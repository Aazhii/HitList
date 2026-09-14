/**
 * Quadrant bucketing, shared by the matrix and the list view.
 *
 * The point of sharing it is that both views agree, so the properties tested
 * are the ones a second copy would drift on: every quadrant present, the done
 * filter, the sort, and not mutating what it was given.
 */
import { describe, it, expect } from 'vitest';
import { bucketByQuadrant, compareTasks } from '@/lib/quadrantBuckets';
import type { Todo } from '@/types/todo';

function todo(over: Partial<Todo>): Todo {
  return {
    id: Math.random().toString(36).slice(2),
    text: 'task',
    status: 'todo',
    createdAt: 0,
    listId: 'l1',
    order: 0,
    quadrant: 'do',
    ...over,
  };
}

describe('bucketByQuadrant', () => {
  it('returns every quadrant, even empty ones', () => {
    const map = bucketByQuadrant([], false);
    expect([...map.keys()]).toEqual(['do', 'schedule', 'delegate', 'eliminate']);
    for (const bucket of map.values()) expect(bucket).toEqual([]);
  });

  it('places each task in its quadrant', () => {
    const a = todo({ id: 'a', quadrant: 'schedule' });
    const b = todo({ id: 'b', quadrant: 'eliminate' });
    const map = bucketByQuadrant([a, b], false);
    expect(map.get('schedule')!.map((t) => t.id)).toEqual(['a']);
    expect(map.get('eliminate')!.map((t) => t.id)).toEqual(['b']);
  });

  it('hides done tasks unless asked', () => {
    const done = todo({ id: 'd', status: 'done' });
    expect(bucketByQuadrant([done], false).get('do')).toEqual([]);
    expect(bucketByQuadrant([done], true).get('do')!.map((t) => t.id)).toEqual(['d']);
  });

  it('sorts in progress, then to do, then done, then by order', () => {
    const tasks = [
      todo({ id: 'done', status: 'done', order: 0 }),
      todo({ id: 'todo-2', status: 'todo', order: 2 }),
      todo({ id: 'wip', status: 'in-progress', order: 9 }),
      todo({ id: 'todo-1', status: 'todo', order: 1 }),
    ];
    const ids = bucketByQuadrant(tasks, true).get('do')!.map((t) => t.id);
    expect(ids).toEqual(['wip', 'todo-1', 'todo-2', 'done']);
  });

  it('does not reorder or mutate its input', () => {
    const tasks = [todo({ id: 'b', order: 2 }), todo({ id: 'a', order: 1 })];
    const before = tasks.map((t) => ({ ...t }));

    bucketByQuadrant(tasks, false);

    expect(tasks.map((t) => t.id)).toEqual(['b', 'a']);
    expect(tasks).toEqual(before);
  });

  it('keeps a task with an unknown quadrant visible', () => {
    // Data from an older or newer client must not silently vanish.
    const odd = todo({ id: 'odd', quadrant: 'nowhere' as never });
    expect(bucketByQuadrant([odd], false).get('do')!.map((t) => t.id)).toEqual(['odd']);
  });
});

describe('compareTasks', () => {
  it('orders by status before order', () => {
    const wip = todo({ status: 'in-progress', order: 100 });
    const early = todo({ status: 'todo', order: 0 });
    expect(compareTasks(wip, early)).toBeLessThan(0);
  });
});
