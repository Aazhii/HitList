/**
 * Why a task screen is empty decides what it says (P5.7): a list that never had a task, tasks the
 * filters are hiding, and a list where everything is finished are three different moments — the
 * last one is good news, and a daily tool should deliver it as such.
 */
export type TasksEmptyKind = 'first-run' | 'filtered' | 'all-done';

export interface TasksEmptyInput {
  /** Tasks in the list, done or not. */
  total: number;
  /** How many of those are done. */
  done: number;
  /** A filter other than the default is narrowing what shows. */
  filtersActive: boolean;
}

/** Only meaningful when nothing is showing. */
export function tasksEmptyKind({ total, done, filtersActive }: TasksEmptyInput): TasksEmptyKind {
  if (total === 0) return 'first-run';
  if (filtersActive) return 'filtered';
  // Nothing hidden by a filter, tasks exist, yet nothing shows: every one is done.
  return done === total ? 'all-done' : 'filtered';
}

export interface EmptyCopy { title: string; description: string }

export function firstRunCopy(listName: string, otherListsHaveTasks: boolean): EmptyCopy {
  return otherListsHaveTasks
    ? {
        title: `Nothing in ${listName} yet`,
        description: 'Add a task here, or move one over. Tasks land in the Eisenhower quadrant you pick.',
      }
    : {
        title: 'Start with one task',
        description: 'Add the first thing you have to do, or turn a line in a note into one with @. Tasks land in the Eisenhower quadrant you pick.',
      };
}

export function allDoneCopy(listName: string, done: number): EmptyCopy {
  return {
    title: `Everything in ${listName} is done`,
    description: `${done} finished. Add the next thing, or show completed tasks to look back.`,
  };
}

/** What an empty quadrant says: each one names what it is for, verb first. */
export const QUADRANT_EMPTY: Record<'do' | 'schedule' | 'delegate' | 'eliminate', string> = {
  do: 'Nothing urgent. Add a task that needs doing now.',
  schedule: 'Nothing planned. Add something worth doing on purpose.',
  delegate: 'Nothing to hand off. Add a task someone else can take.',
  eliminate: 'Nothing to drop. Add a task you are letting go of.',
};
