/**
 * Groups tasks by Eisenhower quadrant, in display order.
 *
 * Shared by the matrix and the list view so the two always agree on which tasks
 * appear where and in what order. Previously this lived inside EisenhowerMatrix.
 *
 * Every quadrant is present in the result, empty or not, so callers can render
 * a panel or group header for each without checking.
 */
import { QUADRANTS } from '@/types/todo';
import type { Quadrant, Todo, TodoStatus } from '@/types/todo';

/** In progress first, then to do, then done. */
export const STATUS_ORDER: Record<TodoStatus, number> = {
  'in-progress': 0,
  todo: 1,
  done: 2,
};

export function compareTasks(a: Todo, b: Todo): number {
  const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  return byStatus !== 0 ? byStatus : a.order - b.order;
}

/**
 * Buckets `todos` by quadrant and sorts each bucket.
 *
 * Pure: the input array and the task objects in it are never mutated.
 */
export function bucketByQuadrant(
  todos: readonly Todo[],
  showDone: boolean,
): Map<Quadrant, Todo[]> {
  const map = new Map<Quadrant, Todo[]>();
  for (const q of QUADRANTS) map.set(q.id, []);

  for (const todo of todos) {
    if (!showDone && todo.status === 'done') continue;
    // A task with an unrecognised quadrant still has to appear somewhere; the
    // first quadrant is where getQuadrantConfig already sends it.
    const bucket = map.get(todo.quadrant) ?? map.get(QUADRANTS[0].id)!;
    bucket.push(todo);
  }

  for (const bucket of map.values()) bucket.sort(compareTasks);
  return map;
}
