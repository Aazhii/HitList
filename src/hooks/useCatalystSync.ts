/**
 * useCatalystSync — Now uses local mockApi exclusively.
 * Catalyst/Zoho DataStore dependency removed. All data is stored
 * in localStorage scoped per user via storage.ts + localAuth.ts.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ServerSyncState } from './useServerSync';
import type { ApiTask, ApiList, ApiMomentumStats, TaskCreateRequest, TaskUpdateRequest, Quadrant, TaskStatus } from '../lib/api';
import { mockTaskApi, mockListApi, mockStatsApi } from '../lib/mockApi';

export { ServerSyncState };

export function useCatalystSync(activeListId?: string, _filters?: import('../lib/api').TaskListParams): ServerSyncState {
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [tasks, setTasks]               = useState<ApiTask[]>([]);
  const [lists, setLists]               = useState<ApiList[]>([]);
  const [momentum, setMomentum]         = useState<ApiMomentumStats | null>(null);
  const [todayHistory, setTodayHistory] = useState<ApiTask[]>([]);

  const savingCount = useRef(0);

  const clearError = useCallback(() => setError(null), []);

  const handleError = useCallback((e: unknown): null => {
    const msg = e instanceof Error ? e.message : String(e);
    setError(msg);
    return null;
  }, []);

  const withSaving = useCallback(async <T>(fn: () => Promise<T>): Promise<T> => {
    savingCount.current += 1;
    setSaving(true);
    try {
      return await fn();
    } finally {
      savingCount.current -= 1;
      if (savingCount.current === 0) setSaving(false);
    }
  }, []);

  // ── Initial load ──────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const [mockTasks, mockLists] = await Promise.all([
          mockTaskApi.list(),
          mockListApi.list(),
        ]);
        if (!cancelled) {
          setTasks(mockTasks);
          setLists(mockLists);
          const mom = await mockStatsApi.momentum(activeListId);
          if (!cancelled) setMomentum(mom);
          const hist = await mockTaskApi.todayHistory(activeListId);
          if (!cancelled) setTodayHistory(hist);
        }
      } catch (e) {
        if (!cancelled) handleError(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void init();
    return () => { cancelled = true; };
  }, []); // initial load only — activeListId changes handled by refresh

  // ── Refresh helpers ───────────────────────────────────────────────────────

  const refreshMomentum = useCallback(async (listId?: string) => {
    try {
      const mom = await mockStatsApi.momentum(listId ?? activeListId);
      setMomentum(mom);
    } catch { /* non-critical */ }
  }, [activeListId]);

  const refreshTodayHistory = useCallback(async (listId?: string) => {
    try {
      const hist = await mockTaskApi.todayHistory(listId ?? activeListId);
      setTodayHistory(hist);
    } catch { /* non-critical */ }
  }, [activeListId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    clearError();
    try {
      const [fetchedTasks, fetchedLists] = await Promise.all([
        mockTaskApi.list(),
        mockListApi.list(),
      ]);
      setTasks(fetchedTasks);
      setLists(fetchedLists);
      await refreshMomentum();
      await refreshTodayHistory();
    } catch (e) { handleError(e); }
    finally { setLoading(false); }
  }, [refreshMomentum, refreshTodayHistory, clearError, handleError]);

  // ── Task mutations ────────────────────────────────────────────────────────

  const createTask = useCallback(async (req: TaskCreateRequest): Promise<ApiTask | null> => {
    clearError();
    return withSaving(async () => {
      try {
        const task = await mockTaskApi.create(req);
        setTasks((prev) => [...prev, task]);
        await Promise.all([refreshMomentum(), refreshTodayHistory()]);
        return task;
      } catch (e) { return handleError(e); }
    });
  }, [clearError, handleError, withSaving, refreshMomentum, refreshTodayHistory]);

  const updateTask = useCallback(async (id: string, req: TaskUpdateRequest): Promise<ApiTask | null> => {
    clearError();
    return withSaving(async () => {
      try {
        const task = await mockTaskApi.update(id, req);
        setTasks((prev) => prev.map((t) => t.id === id ? task : t));
        return task;
      } catch (e) { return handleError(e); }
    });
  }, [clearError, handleError, withSaving]);

  const updateStatus = useCallback(async (id: string, status: TaskStatus): Promise<ApiTask | null> => {
    clearError();
    return withSaving(async () => {
      try {
        const task = await mockTaskApi.updateStatus(id, status);
        setTasks((prev) => prev.map((t) => t.id === id ? task : t));
        if (status === 'DONE') await Promise.all([refreshMomentum(), refreshTodayHistory()]);
        return task;
      } catch (e) { return handleError(e); }
    });
  }, [clearError, handleError, withSaving, refreshMomentum, refreshTodayHistory]);

  const markComplete = useCallback(async (id: string): Promise<ApiTask | null> => {
    clearError();
    return withSaving(async () => {
      try {
        const task = await mockTaskApi.markComplete(id);
        setTasks((prev) => prev.map((t) => t.id === id ? task : t));
        await Promise.all([refreshMomentum(), refreshTodayHistory()]);
        return task;
      } catch (e) { return handleError(e); }
    });
  }, [clearError, handleError, withSaving, refreshMomentum, refreshTodayHistory]);

  const reprioritize = useCallback(async (id: string, quadrant: Quadrant): Promise<ApiTask | null> => {
    clearError();
    return withSaving(async () => {
      try {
        const task = await mockTaskApi.reprioritize(id, quadrant);
        setTasks((prev) => prev.map((t) => t.id === id ? task : t));
        return task;
      } catch (e) { return handleError(e); }
    });
  }, [clearError, handleError, withSaving]);

  const deleteTask = useCallback(async (id: string): Promise<void> => {
    clearError();
    await withSaving(async () => {
      try {
        await mockTaskApi.delete(id);
        setTasks((prev) => prev.filter((t) => t.id !== id));
      } catch (e) { handleError(e); }
    });
  }, [clearError, handleError, withSaving]);

  // ── List mutations ────────────────────────────────────────────────────────

  const createList = useCallback(async (name: string, color = 'emerald'): Promise<ApiList | null> => {
    clearError();
    return withSaving(async () => {
      try {
        const list = await mockListApi.create({ name, color, listOrder: lists.length });
        setLists((prev) => [...prev, list]);
        return list;
      } catch (e) { return handleError(e); }
    });
  }, [clearError, handleError, withSaving, lists.length]);

  const updateList = useCallback(async (id: string, name: string, color?: string): Promise<ApiList | null> => {
    clearError();
    return withSaving(async () => {
      try {
        const list = await mockListApi.update(id, { name, color });
        setLists((prev) => prev.map((l) => l.id === id ? list : l));
        return list;
      } catch (e) { return handleError(e); }
    });
  }, [clearError, handleError, withSaving]);

  const deleteList = useCallback(async (id: string): Promise<void> => {
    clearError();
    await withSaving(async () => {
      try {
        await mockListApi.delete(id);
        setLists((prev) => prev.filter((l) => l.id !== id));
      } catch (e) { handleError(e); }
    });
  }, [clearError, handleError, withSaving]);

  return {
    serverOnline: true,
    backendUnavailable: false,
    catalystReady: false,
    loading,
    saving,
    error,
    tasks,
    lists,
    momentum,
    todayHistory,
    createTask,
    updateTask,
    updateStatus,
    markComplete,
    reprioritize,
    deleteTask,
    createList,
    updateList,
    deleteList,
    refreshMomentum,
    refreshTodayHistory,
    refresh,
    clearError,
  };
}

// Re-export converters so App.tsx import stays the same
export { apiTaskToTodo, apiListToKaizenList } from './useServerSync';
