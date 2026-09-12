/**
 * statsUtils.ts — Client-side momentum/streak computation
 * Shared by mockApi and catalystApi.
 */
import type { ApiTask, ApiMomentumStats } from './api';

function isTodayIso(isoStr: string | null | undefined): boolean {
  if (!isoStr) return false;
  const d = new Date(isoStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
}

export function computeMomentum(
  tasks: ApiTask[],
  listId?: string,
  storedStreak = 0,
): ApiMomentumStats {
  let done = tasks.filter((t) => t.status === 'DONE');
  if (listId) done = done.filter((t) => t.listId === listId);

  const todayCompleted = done.filter((t) => isTodayIso(t.completedAt ?? t.createdAt)).length;

  return {
    streak: storedStreak,
    totalCompleted: done.length,
    todayCompleted,
    listId: listId ?? '',
    asOf: new Date().toISOString(),
  };
}
