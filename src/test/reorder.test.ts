/**
 * Drag-to-reorder arithmetic.
 *
 * Every case is a drop a person actually makes, asserted as the resulting order
 * of the group — plus the property that keeps writes cheap: a drop only returns
 * the rows it changed.
 */
import { describe, it, expect } from 'vitest';
import { computeReorder, quadrantDropId, type ReorderChange } from '@/lib/reorder';
import { bucketByQuadrant } from '@/lib/quadrantBuckets';
import type { Quadrant, Todo, TodoStatus } from '@/types/todo';

function task(id: string, quadrant: Quadrant, order: number, status: TodoStatus = 'todo'): Todo {
  return { id, text: id, status, createdAt: 0, listId: 'l1', order, quadrant };
}

/** Applies changes and returns each quadrant's active ids in display order. */
function applied(tasks: Todo[], changes: ReorderChange[]): Record<string, string[]> {
  const byId = new Map(changes.map((c) => [c.id, c]));
  const next = tasks.map((t) => {
    const c = byId.get(t.id);
    return c ? { ...t, order: c.order, quadrant: c.quadrant } : t;
  });
  const out: Record<string, string[]> = {};
  for (const [q, list] of bucketByQuadrant(next, true)) out[q] = list.map((t) => t.id);
  return out;
}

describe('computeReorder — within a quadrant', () => {
  const tasks = [task('a', 'do', 0), task('b', 'do', 1), task('c', 'do', 2)];
  const buckets = bucketByQuadrant(tasks, true);

  it('moves a task down', () => {
    expect(applied(tasks, computeReorder(buckets, 'a', 'c')).do).toEqual(['b', 'c', 'a']);
  });

  it('moves a task up', () => {
    expect(applied(tasks, computeReorder(buckets, 'c', 'a')).do).toEqual(['c', 'a', 'b']);
  });

  it('does nothing when dropped on itself', () => {
    expect(computeReorder(buckets, 'b', 'b')).toEqual([]);
  });

  it('returns only the rows that changed', () => {
    const four = [task('a', 'do', 0), task('b', 'do', 1), task('c', 'do', 2), task('d', 'do', 3)];
    const changes = computeReorder(bucketByQuadrant(four, true), 'c', 'd');
    expect(changes.map((c) => c.id).sort()).toEqual(['c', 'd']);
  });
});

describe('computeReorder — across quadrants', () => {
  const tasks = [
    task('a', 'do', 0), task('b', 'do', 1),
    task('x', 'schedule', 0), task('y', 'schedule', 1),
  ];
  const buckets = bucketByQuadrant(tasks, true);

  it('inserts before the task it was dropped on, and moves the quadrant', () => {
    const changes = computeReorder(buckets, 'a', 'y');
    expect(changes.find((c) => c.id === 'a')).toEqual({ id: 'a', order: 1, quadrant: 'schedule' });
    expect(applied(tasks, changes).schedule).toEqual(['x', 'a', 'y']);
  });

  it('does not rewrite tasks whose position is unchanged', () => {
    const changes = computeReorder(buckets, 'a', 'y');
    expect(changes.map((c) => c.id)).not.toContain('x');
  });

  it('lands on an empty quadrant through its drop target', () => {
    expect(computeReorder(buckets, 'a', quadrantDropId('delegate')))
      .toEqual([{ id: 'a', order: 0, quadrant: 'delegate' }]);
  });

  it('goes to the end when dropped on a quadrant that has tasks', () => {
    expect(applied(tasks, computeReorder(buckets, 'a', quadrantDropId('schedule'))).schedule)
      .toEqual(['x', 'y', 'a']);
  });
});

describe('computeReorder — done tasks', () => {
  it('never moves a done task', () => {
    const tasks = [task('done', 'do', 0, 'done'), task('b', 'do', 1)];
    expect(computeReorder(bucketByQuadrant(tasks, true), 'done', 'b')).toEqual([]);
  });

  it('treats dropping on a done task as dropping after the active ones', () => {
    const tasks = [task('a', 'do', 0), task('x', 'schedule', 0), task('d', 'schedule', 1, 'done')];
    expect(computeReorder(bucketByQuadrant(tasks, true), 'a', 'd'))
      .toEqual([{ id: 'a', order: 1, quadrant: 'schedule' }]);
  });
});

describe('computeReorder — defensive', () => {
  it('ignores an unknown drop target', () => {
    const buckets = bucketByQuadrant([task('a', 'do', 0)], true);
    expect(computeReorder(buckets, 'a', 'nope')).toEqual([]);
    expect(computeReorder(buckets, 'a', 'quadrant:nowhere')).toEqual([]);
  });

  it('ignores an unknown dragged task', () => {
    expect(computeReorder(bucketByQuadrant([], true), 'ghost', 'quadrant:do')).toEqual([]);
  });
});
