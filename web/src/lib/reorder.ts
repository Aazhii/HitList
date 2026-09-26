/**
 * Where a dragged task lands, and which tasks that renumbers.
 *
 * Pure, so the arithmetic is tested without a pointer or a DOM. The list view's
 * drag handler calls it with the same buckets it rendered, then writes back
 * only the rows this returns.
 */
import { QUADRANTS } from '@/types/todo';
import type { Quadrant, Todo } from '@/types/todo';

/** Drop targets for whole quadrant groups, so an empty group can receive a task. */
const DROP_PREFIX = 'quadrant:';

export function quadrantDropId(q: Quadrant): string {
  return `${DROP_PREFIX}${q}`;
}

function parseQuadrantDropId(id: string): Quadrant | null {
  if (!id.startsWith(DROP_PREFIX)) return null;
  const q = id.slice(DROP_PREFIX.length);
  return QUADRANTS.some((x) => x.id === q) ? (q as Quadrant) : null;
}

export interface ReorderChange {
  id: string;
  order: number;
  quadrant: Quadrant;
}

/**
 * The tasks whose `order` or `quadrant` change when `activeId` is dropped on
 * `overId` — another task, or a quadrant group via quadrantDropId().
 *
 * - Within a group, the dragged task takes the position of the one it was
 *   dropped on (the same result as dnd-kit's arrayMove).
 * - Across groups, it is inserted before the task it was dropped on.
 * - Dropped on a group, or on a done task, it goes after that group's active
 *   tasks. Done tasks always sort last, so they are never a position.
 * - A done task does not move.
 *
 * The target group's active tasks are renumbered 0…n, and only rows whose
 * order or quadrant actually differ are returned — a drop that changes nothing
 * returns nothing, and costs no writes.
 */
export function computeReorder(
  buckets: ReadonlyMap<Quadrant, readonly Todo[]>,
  activeId: string,
  overId: string,
): ReorderChange[] {
  if (activeId === overId) return [];

  let source: Quadrant | null = null;
  let active: Todo | undefined;
  for (const [q, list] of buckets) {
    const found = list.find((t) => t.id === activeId);
    if (found) { source = q; active = found; break; }
  }
  if (!source || !active || active.status === 'done') return [];

  const activeTasks = (q: Quadrant) => (buckets.get(q) ?? []).filter((t) => t.status !== 'done');

  let target: Quadrant;
  let overIndex = -1;
  const droppedOnGroup = parseQuadrantDropId(overId);
  if (droppedOnGroup) {
    target = droppedOnGroup;
  } else {
    let found: Quadrant | null = null;
    for (const [q, list] of buckets) {
      if (list.some((t) => t.id === overId)) { found = q; break; }
    }
    if (!found) return [];
    target = found;
    // -1 when the task dropped on is done: treated like dropping on the group.
    overIndex = activeTasks(target).findIndex((t) => t.id === overId);
  }

  const next = activeTasks(target).filter((t) => t.id !== activeId);
  const insertAt = overIndex < 0 ? next.length : Math.min(overIndex, next.length);
  next.splice(insertAt, 0, active);

  const changes: ReorderChange[] = [];
  next.forEach((task, order) => {
    if (task.order !== order || task.quadrant !== target) {
      changes.push({ id: task.id, order, quadrant: target });
    }
  });
  return changes;
}
