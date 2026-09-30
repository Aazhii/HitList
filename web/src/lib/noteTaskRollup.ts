/**
 * What became of the lines in a note that were turned into tasks (P5.6): how many of those tasks are
 * done, read live from the tasks, so a note does not go stale and stop being trusted.
 */
import type { NoteBlock } from '@/types/notes';

export interface Rollup { total: number; done: number }

/** Tasks that still exist and came from this note; a deleted task counts for nothing either way. */
export function noteTaskRollup(blocks: readonly NoteBlock[], todos: ReadonlyArray<{ id: string; status: string }>): Rollup {
  const byId = new Map(todos.map((t) => [t.id, t]));
  let total = 0;
  let done = 0;
  for (const block of blocks) {
    const task = block.taskId ? byId.get(block.taskId) : undefined;
    if (!task) continue;
    total += 1;
    if (task.status === 'done') done += 1;
  }
  return { total, done };
}

/** "1 of 3 linked tasks done", "All 2 linked tasks done", "1 linked task"; '' with none. */
export function rollupLabel({ total, done }: Rollup): string {
  if (total === 0) return '';
  if (done === 0) return `${total} linked task${total === 1 ? '' : 's'}`;
  if (done === total) return total === 1 ? 'Linked task done' : `All ${total} linked tasks done`;
  return `${done} of ${total} linked tasks done`;
}
