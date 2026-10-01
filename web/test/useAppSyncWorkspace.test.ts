import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppSync } from '@/hooks/useAppSync';
import { checkServerHealth, listApi, taskApi } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  checkServerHealth: vi.fn().mockResolvedValue(true),
  isNetworkError: () => false,
  listApi: { list: vi.fn(), create: vi.fn(), delete: vi.fn().mockResolvedValue(undefined) },
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

  it('keeps an overdue task after creation and refresh', async () => {
    const request = { title: 'Already overdue', listId: 'work', dueDate: '2020-01-01' };
    const saved = { id: 'overdue', ...request } as Awaited<ReturnType<typeof taskApi.create>>;
    vi.mocked(taskApi.create).mockImplementation(async () => {
      vi.mocked(taskApi.list).mockResolvedValue([saved]);
      return saved;
    });
    const { result } = renderHook(() => useAppSync('work'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      expect(await result.current.createTask(request)).toEqual(saved);
    });
    expect(result.current.tasks).toEqual([saved]);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.tasks).toEqual([saved]);
    expect(taskApi.create).toHaveBeenCalledWith(request);
  });

  it('removes the last list and its tasks and keeps refresh empty', async () => {
    vi.mocked(taskApi.list).mockResolvedValue([{ id: 'old', listId: 'work' } as Awaited<ReturnType<typeof taskApi.create>>]);
    const { result } = renderHook(() => useAppSync('work'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.deleteList('work'); });
    expect(listApi.delete).toHaveBeenCalledWith('work');
    expect(result.current.lists).toEqual([]);
    expect(result.current.tasks).toEqual([]);
    vi.mocked(listApi.list).mockResolvedValue([]);
    vi.mocked(taskApi.list).mockResolvedValue([]);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.lists).toEqual([]);
    expect(listApi.create).not.toHaveBeenCalled();
  });

  it('creates the first list, recovers legacy notes, then accepts a task in that list', async () => {
    const orphan = { id: 'legacy', listId: null, note: 'Keep this note' } as Awaited<ReturnType<typeof taskApi.create>>;
    vi.mocked(listApi.list).mockResolvedValue([]);
    vi.mocked(taskApi.list).mockResolvedValue([orphan]);
    const { result } = renderHook(() => useAppSync());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.lists).toEqual([]);
    const savedList = { id: 'personal', name: 'Personal', color: 'emerald', listOrder: 0, createdAt: '', updatedAt: '' };
    vi.mocked(listApi.create).mockImplementation(async () => {
      vi.mocked(listApi.list).mockResolvedValue([savedList]);
      return savedList;
    });
    vi.mocked(taskApi.update).mockResolvedValue({ ...orphan, listId: savedList.id });
    await act(async () => { await result.current.createList('Personal'); });
    expect(result.current.lists).toEqual([savedList]);
    expect(result.current.tasks).toEqual([{ ...orphan, listId: savedList.id }]);
    const request = { title: 'Queued task', listId: savedList.id };
    vi.mocked(taskApi.create).mockResolvedValue({ id: 'queued', ...request } as Awaited<ReturnType<typeof taskApi.create>>);
    await act(async () => { await result.current.createTask(request); });
    expect(taskApi.create).toHaveBeenCalledWith(request);
  });

  it('keeps the last list and tasks when deletion fails', async () => {
    const task = { id: 'old', listId: 'work' } as Awaited<ReturnType<typeof taskApi.create>>;
    vi.mocked(taskApi.list).mockResolvedValue([task]);
    vi.mocked(listApi.delete).mockRejectedValueOnce(new Error('Delete failed'));
    const { result } = renderHook(() => useAppSync('work'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await expect(result.current.deleteList('work')).rejects.toThrow('Delete failed');
    });
    expect(result.current.lists).toHaveLength(1);
    expect(result.current.tasks).toEqual([task]);
  });
});