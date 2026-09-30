/**
 * Data quality, applied to tasks (P5.3): how complete each column is, and the one gap that decides
 * whether a task ever gets done — no due date. The same idea as the Databases column's fill bar.
 */
import type { FieldDef, FieldValue } from '@/types/fields';
import type { Todo } from '@/types/todo';

export interface Fill { filled: number; total: number }

const has = (v: FieldValue | undefined | null): boolean => {
  if (v === undefined || v === null || v === '') return false;
  return !(Array.isArray(v) && v.length === 0);
};

/** Share of tasks with a value in a custom field column. */
export function fieldFill(field: FieldDef, tasks: Todo[], values: Record<string, Record<string, FieldValue>>): Fill {
  return { filled: tasks.filter((t) => has(values[t.id]?.[field.id])).length, total: tasks.length };
}

/** Share of tasks with a due date. */
export function dueFill(tasks: Todo[]): Fill {
  return { filled: tasks.filter((t) => !!t.dueDate).length, total: tasks.length };
}

/** Open tasks with no due date — done ones no longer need one. */
export function missingDueCount(tasks: Todo[]): number {
  return tasks.filter((t) => t.status !== 'done' && !t.dueDate).length;
}

export const fillRatio = ({ filled, total }: Fill): number => (total === 0 ? 0 : filled / total);
