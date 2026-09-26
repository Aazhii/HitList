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

/**
 * Done last; otherwise the user's own order.
 *
 * This used to put in-progress tasks first, then to-do, then done. Once tasks
 * can be dragged into order, that fights the user: a to-do dragged above an
 * in-progress task would snap straight back below it. The order someone chose
 * by hand now wins, in both the list and the matrix, so the two agree.
 */
/** How two tasks in the same quadrant are ordered. */
export type TaskCompare = (a: Todo, b: Todo) => number;

export function compareTasks(a: Todo, b: Todo): number {
  const aDone = a.status === 'done' ? 1 : 0;
  const bDone = b.status === 'done' ? 1 : 0;
  return aDone !== bDone ? aDone - bDone : a.order - b.order;
}

/**
 * Buckets `todos` by quadrant and sorts each bucket.
 *
 * Pure: the input array and the task objects in it are never mutated.
 */
export function bucketByQuadrant(
  todos: readonly Todo[],
  showDone: boolean,
  compare: TaskCompare = compareTasks,
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

  for (const bucket of map.values()) bucket.sort(compare);
  return map;
}
