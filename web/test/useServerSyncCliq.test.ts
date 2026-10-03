import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useServerSync } from '@/hooks/useServerSync';
import { checkServerHealth, listApi, taskApi } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  checkServerHealth: vi.fn().mockResolvedValue(true),
  isNetworkError: () => false,
  listApi: { list: vi.fn().mockResolvedValue([]) },
  taskApi: { list: vi.fn().mockResolvedValue([]), todayHistory: vi.fn().mockResolvedValue([]) },
  statsApi: { momentum: vi.fn().mockResolvedValue(null) },
}));
vi.mock('@/lib/localMigration', () => ({ migrateLocalState: vi.fn().mockResolvedValue(undefined) }));

afterEach(() => { delete window.hitlistDesktop; vi.clearAllMocks(); });

it('refreshes tasks on applied commands and removes its listener on unmount', async () => {
  let applied: (() => void) | undefined;
  const unsubscribe = vi.fn();
  const subscribe = vi.fn((listener: () => void) => { applied = listener; return unsubscribe; });
  window.hitlistDesktop = { onCliqCommandsApplied: subscribe } as unknown as typeof window.hitlistDesktop;
  const { result, unmount } = renderHook(() => useServerSync());
  await waitFor(() => expect(result.current.loading).toBe(false));
  await waitFor(() => expect(subscribe).toHaveBeenCalled());
  vi.mocked(taskApi.list).mockResolvedValue([{ id: 'from-cliq', title: 'From Cliq' }] as Awaited<ReturnType<typeof taskApi.list>>);
  await act(async () => { applied?.(); });
  await waitFor(() => expect(result.current.tasks).toEqual([{ id: 'from-cliq', title: 'From Cliq' }]));
  expect(checkServerHealth).toHaveBeenCalled();
  expect(listApi.list).toHaveBeenCalled();
  unmount();
  expect(unsubscribe).toHaveBeenCalled();
});