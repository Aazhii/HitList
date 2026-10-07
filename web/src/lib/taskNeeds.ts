/**
 * "Needs first": a task can wait on other tasks. Pure helpers over the task list, so the rules live in one place and are tested
 * without a screen. An id that no longer names a task (deleted here or by a teammate) is simply not there: nothing counts it,
 * shows it or waits for it, and nothing has to be cleaned up in the tasks that listed it.
 */
import type { Todo } from '@/types/todo';

type TaskLike = Pick<Todo, 'id' | 'status' | 'needsFirst'>;

export const MAX_NEEDS_FIRST = 20;

/** The prerequisites of a task that still exist and are not done, in the order they were chosen. */
export function openNeeds<T extends TaskLike>(task: Pick<Todo, 'id' | 'needsFirst'>, byId: ReadonlyMap<string, T>): T[] {
  const out: T[] = [];
  for (const id of task.needsFirst ?? []) {
    const other = byId.get(id);
    if (other && other.id !== task.id && other.status !== 'done' && !out.includes(other)) out.push(other);
  }
  return out;
}

/** The prerequisites that exist, done or not, in the order they were chosen (for showing the list). */
export function existingNeeds<T extends TaskLike>(task: Pick<Todo, 'id' | 'needsFirst'>, byId: ReadonlyMap<string, T>): T[] {
  const out: T[] = [];
  for (const id of task.needsFirst ?? []) {
    const other = byId.get(id);
    if (other && other.id !== task.id && !out.includes(other)) out.push(other);
  }
  return out;
}

/**
 * Whether making `candidateId` a prerequisite of `taskId` would make tasks wait on each other: it would if the candidate already
 * needs the task, directly or through others. Safe on loops that two computers' edits may have left behind.
 */
export function wouldCycle(taskId: string, candidateId: string, byId: ReadonlyMap<string, TaskLike>): boolean {
  if (taskId === candidateId) return true;
  const seen = new Set<string>();
  const pending = [candidateId];
  while (pending.length) {
    const id = pending.pop() as string;
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of byId.get(id)?.needsFirst ?? []) pending.push(next);
  }
  return false;
}

/** For each open task: how many of its prerequisites are still open. Tasks with none are left out. */
export function waitingCounts(todos: readonly Todo[]): Map<string, number> {
  const byId = new Map(todos.map((t) => [t.id, t]));
  const counts = new Map<string, number>();
  for (const t of todos) {
    if (t.status === 'done' || !t.needsFirst?.length) continue;
    const n = openNeeds(t, byId).length;
    if (n > 0) counts.set(t.id, n);
  }
  return counts;
}

/** The open tasks that list this one as a prerequisite ("waiting on this"). */
export function waitingOn<T extends TaskLike>(taskId: string, todos: readonly T[]): T[] {
  return todos.filter((t) => t.status !== 'done' && t.id !== taskId && (t.needsFirst ?? []).includes(taskId));
}

/**
 * Everything that has to be finished before these tasks, deepest first (a prerequisite comes before the task that needs it),
 * each once. The tasks themselves are not included. A loop is cut where it closes.
 */
export function needsToFinish<T extends TaskLike>(tasks: readonly Pick<Todo, 'id' | 'needsFirst'>[], byId: ReadonlyMap<string, T>): string[] {
  const order: string[] = [];
  const done = new Set<string>(tasks.map((t) => t.id));
  const visiting = new Set<string>();
  const visit = (task: Pick<Todo, 'id' | 'needsFirst'>) => {
    visiting.add(task.id);
    for (const need of openNeeds(task, byId)) {
      if (visiting.has(need.id) || done.has(need.id)) continue;
      visit(need);
      done.add(need.id);
      order.push(need.id);
    }
    visiting.delete(task.id);
  };
  for (const t of tasks) visit(t);
  return order;
}

/** "Task1 still needs 2 tasks first" (the pop-up's title). */
export function needsTitle(taskTitle: string, count: number): string {
  return `${taskTitle} still needs ${count === 1 ? '1 task' : `${count} tasks`} first`;
}

/**
 * Quick add: each title typed after ">" is matched to an open task (the same words, ignoring case; else the one task whose title
 * starts with them), or becomes a new task. A title that matches several tasks by prefix is not guessed at: it becomes new.
 */
export function resolveNeeds(titles: readonly string[], todos: readonly Todo[]): { ids: string[]; newTitles: string[] } {
  const open = todos.filter((t) => t.status !== 'done');
  const ids: string[] = [];
  const newTitles: string[] = [];
  for (const raw of titles) {
    const title = raw.trim();
    if (!title) continue;
    const lower = title.toLowerCase();
    const exact = open.find((t) => t.text.trim().toLowerCase() === lower);
    const starts = open.filter((t) => t.text.trim().toLowerCase().startsWith(lower));
    const hit = exact ?? (starts.length === 1 ? starts[0] : undefined);
    if (hit) { if (!ids.includes(hit.id)) ids.push(hit.id); }
    else if (!newTitles.some((n) => n.toLowerCase() === lower)) newTitles.push(title);
  }
  return { ids, newTitles };
}
