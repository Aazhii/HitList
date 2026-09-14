import type { TodoStatus } from '@/types/todo';

/**
 * The status a task advances to when its status control is pressed.
 *
 * Shared by the list row and the matrix card so the cycle cannot drift between
 * them. Done is terminal: reopening a task happens in its detail panel.
 */
export const NEXT_STATUS: Record<TodoStatus, TodoStatus | null> = {
  todo: 'in-progress',
  'in-progress': 'done',
  done: null,
};
