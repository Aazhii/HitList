/**
 * useAppSync — the app's active data layer.
 *
 * The server is the source of truth, and mockApi is a fallback for when the
 * backend genuinely is not reachable.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ServerSyncState } from './useServerSync';
import type { ApiTask, ApiList, ApiMomentumStats, TaskCreateRequest, TaskUpdateRequest, Quadrant, TaskStatus } from '../lib/api';
import { taskApi, listApi, statsApi, checkServerHealth, isNetworkError } from '../lib/api';
import { mockTaskApi, mockListApi, mockStatsApi } from '../lib/mockApi';
import { getActiveUserId, loadAppState } from '../lib/storage';
import { migrateLocalState } from '../lib/localMigration';

export { ServerSyncState };

function describeApiError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object') {
    const o = e as { message?: unknown; error?: unknown; status?: unknown };
    if (typeof o.message === 'string' && o.message) return o.message;
    if (typeof o.error === 'string' && o.error) return o.error;
    if (typeof o.status === 'number') return `Request failed (${o.status})`;
  }
  return 'Something went wrong. Please try again.';
}

const REAL = { task: taskApi,     list: listApi,     stats: statsApi };
const MOCK = { task: mockTaskApi, list: mockListApi, stats: mockStatsApi };
type Backend = typeof REAL;

export function useAppSync(activeListId?: string): ServerSyncState {
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [tasks, setTasks]               = useState<ApiTask[]>([]);
  const [lists, setLists]               = useState<ApiList[]>([]);
  const [momentum, setMomentum]         = useState<ApiMomentumStats | null>(null);
  const [todayHistory, setTodayHistory] = useState<ApiTask[]>([]);

  const [serverOnline, setServerOnline] = useState(false);

  const savingCount = useRef(0);
  const migrationRunning = useRef(false);
  const onlineRef = useRef(false);

  const setOnline = useCallback((online: boolean) => {
    if (onlineRef.current === online) return;
    onlineRef.current = online;
    setServerOnline(online);
    console.info(`[sync] backend is now ${online ? 'server' : 'local (offline)'}`);
  }, []);

  const viaBackend = useCallback(async <T>(op: (api: Backend) => Promise<T>): Promise<T> => {
    if (!onlineRef.current) return op(MOCK);
    try {
      return await op(REAL);
    } catch (e) {
      if (!isNetworkError(e)) throw e;
      setOnline(false);
      return op(MOCK);
    }
  }, [setOnline]);

  const clearError = useCallback(() => setError(null), []);

  const handleError = useCallback((e: unknown): null => {
    setError(describeApiError(e));
    return null;
  }, []);

  const migrateOfflineState = useCallback(async () => {
    if (migrationRunning.current) return;
    migrationRunning.current = true;
    try {
      await migrateLocalState(loadAppState(), getActiveUserId(), {
        lists: listApi,
        tasks: taskApi,
      });
    } catch (e) {
      if (isNetworkError(e)) setOnline(false);
      else handleError(e);
    } finally {
      migrationRunning.current = false;
    }
  }, [handleError, setOnline]);

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

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const healthy = await checkServerHealth();
        if (cancelled) return;
        setOnline(healthy);

        if (healthy) await migrateOfflineState();
        const [fetchedTasks, fetchedLists] = await Promise.all([
          viaBackend((api) => api.task.list()),
          viaBackend((api) => api.list.list()),
        ]);
        if (cancelled) return;
        setTasks(fetchedTasks);
        setLists(fetchedLists);

        const mom = await viaBackend((api) => api.stats.momentum(activeListId));
        if (!cancelled) setMomentum(mom);
        const hist = await viaBackend((api) => api.task.todayHistory(activeListId));
        if (!cancelled) setTodayHistory(hist);
      } catch (e) {
        if (!cancelled) handleError(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void init();
    return () => { cancelled = true; };
  }, []); // initial load only — activeListId changes are handled by refresh

  const refreshMomentum = useCallback(async (listId?: string) => {
    try {
      const mom = await viaBackend((api) => api.stats.momentum(listId ?? activeListId));
      setMomentum(mom);
    } catch {
      // non-critical
    }
  }, [activeListId, viaBackend]);

  const refreshTodayHistory = useCallback(async (listId?: string) => {
    try {
      const hist = await viaBackend((api) => api.task.todayHistory(listId ?? activeListId));
      setTodayHistory(hist);
    } catch {
      // non-critical
    }
  }, [activeListId, viaBackend]);

  useEffect(() => {
    if (loading) return;
    void refreshMomentum(activeListId);
    void refreshTodayHistory(activeListId);
  }, [activeListId, loading, refreshMomentum, refreshTodayHistory]);

  const refresh = useCallback(async () => {
    setLoading(true);
    clearError();
    try {
      const healthy = await checkServerHealth();
      setOnline(healthy);
      if (healthy) await migrateOfflineState();
      const [fetchedTasks, fetchedLists] = await Promise.all([
        viaBackend((api) => api.task.list()),
        viaBackend((api) => api.list.list()),
      ]);
      setTasks(fetchedTasks);
      setLists(fetchedLists);
      await refreshMomentum();
      await refreshTodayHistory();
    } catch (e) { handleError(e); }
    finally { setLoading(false); }
  }, [refreshMomentum, refreshTodayHistory, clearError, handleError, migrateOfflineState, setOnline, viaBackend]);

  useEffect(() => {
    const reconnect = () => { void refresh(); };
    window.addEventListener('online', reconnect);
    return () => window.removeEventListener('online', reconnect);
  }, [refresh]);

  const createTask = useCallback(async (req: TaskCreateRequest): Promise<ApiTask | null> => {
    clearError();
    return withSaving(async () => {
      try {
        const task = await viaBackend((api) => api.task.create(req));
        setTasks((prev) => [...prev, task]);
        await Promise.all([refreshMomentum(), refreshTodayHistory()]);
        return task;
      } catch (e) { return handleError(e); }
    });
  }, [clearError, handleError, refreshMomentum, refreshTodayHistory, viaBackend, withSaving]);

  const updateTask = useCallback(async (id: string, req: TaskUpdateRequest): Promise<ApiTask | null> => {
    clearError();
    return withSaving(async () => {
      try {
        const task = await viaBackend((api) => api.task.update(id, req));
        setTasks((prev) => prev.map((t) => t.id === id ? task : t));
        return task;
      } catch (e) { return handleError(e); }
    });
  }, [clearError, handleError, viaBackend, withSaving]);

  const updateStatus = useCallback(async (id: string, status: TaskStatus): Promise<ApiTask | null> => {
    clearError();
    return withSaving(async () => {
      try {
        const task = await viaBackend((api) => api.task.updateStatus(id, status));
        setTasks((prev) => prev.map((t) => t.id === id ? task : t));
        await Promise.all([refreshMomentum(), refreshTodayHistory()]);
        return task;
      } catch (e) { return handleError(e); }
    });
  }, [clearError, handleError, refreshMomentum, refreshTodayHistory, viaBackend, withSaving]);

  const markComplete = useCallback(async (id: string): Promise<ApiTask | null> => {
    clearError();
    return withSaving(async () => {
      try {
        const task = await viaBackend((api) => api.task.markComplete(id));
        setTasks((prev) => prev.map((t) => t.id === id ? task : t));
        await Promise.all([refreshMomentum(), refreshTodayHistory()]);
        return task;
      } catch (e) { return handleError(e); }
    });
  }, [clearError, handleError, refreshMomentum, refreshTodayHistory, viaBackend, withSaving]);

  const reprioritize = useCallback(async (id: string, quadrant: Quadrant): Promise<ApiTask | null> => {
    clearError();
    return withSaving(async () => {
      try {
        const task = await viaBackend((api) => api.task.reprioritize(id, quadrant));
        setTasks((prev) => prev.map((t) => t.id === id ? task : t));
        return task;
      } catch (e) { return handleError(e); }
    });
  }, [clearError, handleError, viaBackend, withSaving]);

  const deleteTask = useCallback(async (id: string): Promise<void> => {
    clearError();
    await withSaving(async () => {
      try {
        await viaBackend((api) => api.task.delete(id));
        setTasks((prev) => prev.filter((t) => t.id !== id));
      } catch (e) { handleError(e); }
    });
  }, [clearError, handleError, viaBackend, withSaving]);

  const createList = useCallback(async (name: string, color = 'emerald'): Promise<ApiList | null> => {
    clearError();
    return withSaving(async () => {
      try {
        const list = await viaBackend((api) => api.list.create({ name, color, listOrder: lists.length }));
        setLists((prev) => [...prev, list]);
        return list;
      } catch (e) { return handleError(e); }
    });
  }, [clearError, handleError, lists.length, viaBackend, withSaving]);

  const updateList = useCallback(async (id: string, name: string, color?: string): Promise<ApiList | null> => {
    clearError();
    return withSaving(async () => {
      try {
        const list = await viaBackend((api) => api.list.update(id, { name, color }));
        setLists((prev) => prev.map((l) => l.id === id ? list : l));
        return list;
      } catch (e) { return handleError(e); }
    });
  }, [clearError, handleError, viaBackend, withSaving]);

  const deleteList = useCallback(async (id: string): Promise<void> => {
    clearError();
    await withSaving(async () => {
      try {
        await viaBackend((api) => api.list.delete(id));
        setLists((prev) => prev.filter((l) => l.id !== id));
      } catch (e) { handleError(e); }
    });
  }, [clearError, handleError, viaBackend, withSaving]);

  return {
    serverOnline,
    backendUnavailable: !serverOnline,
    backendReady: serverOnline,
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

export { apiTaskToTodo, apiListToKaizenList } from './useServerSync';
