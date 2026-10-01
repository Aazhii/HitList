import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppSync } from '@/hooks/useAppSync';
import { checkServerHealth, listApi, taskApi } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  checkServerHealth: vi.fn().mockResolvedValue(true),
  isNetworkError: () => false,
  listApi: { list: vi.fn(), create: vi.fn() },
  taskApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), todayHistory: vi.fn().mockResolvedValue([]) },
  statsApi: { momentum: vi.fn().mockResolvedValue(null) },
}));
vi.mock('@/lib/localMigration', () => ({ migrateLocalState: vi.fn().mockResolvedValue(undefined) }));

describe('workspace sync task guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkServerHealth).mockResolvedValue(true);
    vi.mocked(listApi.list).mockResolvedValue([
      { id: 'work', name: 'Work', color: 'blue', listOrder: 0, createdAt: '', updatedAt: '' },
    ]);
    vi.mocked(taskApi.list).mockResolvedValue([]);
  });

  it('does not submit a task until lists have loaded', async () => {
    const { result } = renderHook(() => useAppSync());
    await act(async () => {
      expect(await result.current.createTask({ title: 'Too soon', listId: 'work' })).toBeNull();
    });
    expect(taskApi.create).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('rejects missing and invalid list associations', async () => {
    const { result } = renderHook(() => useAppSync());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      expect(await result.current.createTask({ title: 'Unlisted' })).toBeNull();
      expect(await result.current.createTask({ title: 'Invalid', listId: 'missing' })).toBeNull();
    });
    expect(taskApi.create).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Create or select a list before adding a task.');
  });

  it('submits tasks associated with a saved list', async () => {
    const request = { title: 'Valid', listId: 'work' };
    vi.mocked(taskApi.create).mockResolvedValue({ id: 'saved', ...request } as Awaited<ReturnType<typeof taskApi.create>>);
    const { result } = renderHook(() => useAppSync());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      expect(await result.current.createTask(request)).toMatchObject({ id: 'saved', listId: 'work' });
    });
    expect(taskApi.create).toHaveBeenCalledWith(request);
  });
});