/**
 * useServerSync — React hook for server-backed task/list state
 *
 * Strategy:
 *  1. On mount, probe the Spring Boot server (checkServerHealth).
 *  2. If reachable → fetch tasks + lists + momentum from the real API.
 *  3. If unreachable → use mockApi (localStorage-backed with async delays).
 *  4. All mutations go through the same interface regardless of mode.
 *
 * The hook exposes the same shape that App.tsx already uses so the
 * integration surface is minimal.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiList,
  ApiMomentumStats,
  ApiTask,
  checkServerHealth,
  isNetworkError,
  listApi,
  Quadrant,
  statsApi,
  TaskCreateRequest,
  taskApi,
  TaskStatus,
  TaskUpdateRequest,
} from '../lib/api';
import { mockTaskApi, mockListApi, mockStatsApi } from '../lib/mockApi';
import { loadAppState, saveAppState } from '../lib/storage';
import type { AppState } from '../types/todo';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ServerSyncState {
  /** Whether the Spring Boot server is reachable. */
  serverOnline: boolean;
  /**
   * True when the backend was reachable at startup but became unreachable
   * mid-session (network error during a mutation). The app silently falls
   * back to mockApi for subsequent operations.
   */
  backendUnavailable: boolean;
  /**
   * True when Catalyst DataStore is confirmed ready and the user is
   * authenticated. Used by App.tsx to decide whether an empty server
   * result should unconditionally replace local seed data.
   */
  catalystReady?: boolean;
  /** True while the initial load is in progress. */
  loading: boolean;
  /** True while a mutation is in-flight (optimistic save). */
  saving: boolean;
  /** Last error from any API call. */
  error: string | null;

  // Raw server data (populated from server or mock)
  tasks: ApiTask[];
  lists: ApiList[];
  momentum: ApiMomentumStats | null;
  todayHistory: ApiTask[];

  // Mutations — all return the updated entity (or void for delete)
  createTask:     (req: TaskCreateRequest) => Promise<ApiTask | null>;
  updateTask:     (id: string, req: TaskUpdateRequest) => Promise<ApiTask | null>;
  updateStatus:   (id: string, status: TaskStatus) => Promise<ApiTask | null>;
  markComplete:   (id: string) => Promise<ApiTask | null>;
  reprioritize:   (id: string, quadrant: Quadrant) => Promise<ApiTask | null>;
  deleteTask:     (id: string) => Promise<void>;

  createList:     (name: string, color?: string) => Promise<ApiList | null>;
  updateList:     (id: string, name: string, color?: string) => Promise<ApiList | null>;
  deleteList:     (id: string) => Promise<void>;

  /** Refresh momentum stats (call after completing a task). */
  refreshMomentum: (listId?: string) => Promise<void>;
  /** Refresh today's completed task history. */
  refreshTodayHistory: (listId?: string) => Promise<void>;
  /** Full refresh of tasks + lists + momentum. */
  refresh:         () => Promise<void>;
  /** Clear the current error. */
  clearError:      () => void;
}

// ── Migration key ─────────────────────────────────────────────────────────────

const MIGRATION_FLAG = 'kaizen_migrated_v1';

// ── Saving counter (tracks in-flight mutations) ───────────────────────────────

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useServerSync(activeListId?: string, filterParams?: import('../lib/api').TaskListParams): ServerSyncState {
  const [serverOnline, setServerOnline]         = useState(false);
  const [backendUnavailable, setBackendUnavailable] = useState(false);
  const [loading, setLoading]                   = useState(true);
  const [saving, setSaving]                     = useState(false);
  const [error, setError]                       = useState<string | null>(null);
  const [tasks, setTasks]                       = useState<ApiTask[]>([]);
  const [lists, setLists]                       = useState<ApiList[]>([]);
  const [momentum, setMomentum]                 = useState<ApiMomentumStats | null>(null);
  const [todayHistory, setTodayHistory]         = useState<ApiTask[]>([]);

  // Track in-flight mutation count so saving=true while any are pending
  const savingCount = useRef(0);

  // Prevent double-fetch in StrictMode
  const initialised  = useRef(false);
  const migrated     = useRef(false);

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Handles an error from an API call.
   * - Network errors (server went offline mid-session): silently mark backend
   *   unavailable and fall back to mockApi — no error banner shown.
   * - API errors (4xx, bad response): show the error message in the UI.
   */
  const handleError = useCallback((e: unknown) => {
    if (isNetworkError(e)) {
      // Server became unreachable mid-session — switch to offline mode silently
      setServerOnline(false);
      setBackendUnavailable(true);
      return null;
    }
    const msg = (e as { message?: string })?.message
      ?? (e instanceof Error ? e.message : null)
      ?? 'Something went wrong';
    setError(msg);
    return null;
  }, []);

  const clearError = useCallback(() => setError(null), []);

  /** Wrap a mutation with saving state tracking */
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

  // ── API selectors (real server vs mock) ────────────────────────────────────
  // Use real API when server is online AND backend hasn't gone unavailable
  // mid-session. Falls back to mockApi (localStorage) in all other cases.

  const useReal = serverOnline && !backendUnavailable;
  const tApi  = useReal ? taskApi  : mockTaskApi;
  const lApi  = useReal ? listApi  : mockListApi;
  const sApi  = useReal ? statsApi : mockStatsApi;

  // ── Load data ──────────────────────────────────────────────────────────────

  const loadData = useCallback(async (online: boolean, listId?: string, extraParams?: import('../lib/api').TaskListParams) => {
    const ta = online ? taskApi  : mockTaskApi;
    const la = online ? listApi  : mockListApi;
    const sa = online ? statsApi : mockStatsApi;
    const listParams = { ...(listId ? { listId } : {}), ...extraParams };
    try {
      const [fetchedTasks, fetchedLists, fetchedMomentum, fetchedHistory] = await Promise.all([
        ta.list(Object.keys(listParams).length ? listParams : undefined),
        la.list(),
        sa.momentum(listId),
        ta.todayHistory(listId),
      ]);
      setTasks(fetchedTasks);
      setLists(fetchedLists);
      setMomentum(fetchedMomentum);
      setTodayHistory(fetchedHistory);
      clearError();
    } catch (e) {
      handleError(e);
    }
  }, [clearError, handleError]);

  const loadFromServer = useCallback(async () => {
    await loadData(serverOnline, activeListId, filterParams);
  }, [loadData, serverOnline, activeListId, filterParams]);

  // ── One-time localStorage → server migration (server-online only) ──────────

  const runMigration = useCallback(async () => {
    if (migrated.current) return;
    if (localStorage.getItem(MIGRATION_FLAG)) return;
    migrated.current = true;

    try {
      const localState: AppState = loadAppState();
      const nonSeedTodos = localState.todos.filter((t) => !t.id.startsWith('seed-'));
      if (nonSeedTodos.length === 0 && localState.lists.every((l) => l.id.startsWith('list-'))) {
        localStorage.setItem(MIGRATION_FLAG, 'done');
        return;
      }

      const serverListIds = new Set(lists.map((l) => l.id));
      for (const list of localState.lists) {
        if (!serverListIds.has(list.id)) {
          try { await taskApi.create({ title: list.name }); } catch { /* ignore */ }
        }
      }

      const serverTaskIds = new Set(tasks.map((t) => t.id));
      for (const todo of nonSeedTodos) {
        if (serverTaskIds.has(todo.id)) continue;
        try {
          const statusMap: Record<string, string> = { 'todo': 'TODO', 'in-progress': 'IN_PROGRESS', 'done': 'DONE' };
          const quadrantMap: Record<string, string> = { 'do': 'DO', 'schedule': 'SCHEDULE', 'delegate': 'DELEGATE', 'eliminate': 'ELIMINATE' };
          await taskApi.create({
            title: todo.text,
            status: (statusMap[todo.status] ?? 'TODO') as import('../lib/api').TaskStatus,
            quadrant: (quadrantMap[todo.quadrant] ?? 'SCHEDULE') as import('../lib/api').Quadrant,
            note: todo.note, dueDate: todo.dueDate, dueTime: todo.dueTime,
            category: todo.category, listId: todo.listId, taskOrder: todo.order,
            reminderEnabled: todo.reminderEnabled, reminderMinutesBefore: todo.reminderMinutesBefore,
          });
        } catch { /* ignore */ }
      }

      localStorage.setItem(MIGRATION_FLAG, 'done');
      await loadFromServer();
    } catch {
      localStorage.setItem(MIGRATION_FLAG, 'done');
    }
  }, [lists, tasks, loadFromServer]);

  // ── Initial mount ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;

    (async () => {
      setLoading(true);
      const online = await checkServerHealth();
      setServerOnline(online);
      // Always load data — from real server if online, from mock (localStorage) if not
      await loadData(online, activeListId);
      setLoading(false);
    })();
  }, []); // intentionally empty — runs once on mount only

  // Run migration after initial load completes (server online only)
  useEffect(() => {
    if (serverOnline && !loading) runMigration();
  }, [serverOnline, loading, runMigration]);

  // Re-fetch when active list or filter params change.
  // loadFromServer is intentionally omitted from deps — it is stable across renders.
  useEffect(() => {
    if (!loading) { loadFromServer(); }
  }, [activeListId, filterParams]);

  // ── Refresh helpers ────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    // Re-probe health before refreshing — allows reconnection after mid-session dropout
    const online = await checkServerHealth();
    if (online !== serverOnline) {
      setServerOnline(online);
      if (online) setBackendUnavailable(false);
    }
    await loadData(online, activeListId, filterParams);
  }, [serverOnline, loadData, activeListId, filterParams]);

  const refreshMomentum = useCallback(async (listId?: string) => {
    try {
      const stats = await sApi.momentum(listId ?? activeListId);
      setMomentum(stats);
    } catch (e) { handleError(e); }
  }, [sApi, activeListId, handleError]);

  const refreshTodayHistory = useCallback(async (listId?: string) => {
    try {
      const history = await tApi.todayHistory(listId ?? activeListId);
      setTodayHistory(history);
    } catch (e) { handleError(e); }
  }, [tApi, activeListId, handleError]);

  // ── Task mutations ─────────────────────────────────────────────────────────

  const createTask = useCallback(async (req: TaskCreateRequest): Promise<ApiTask | null> => {
    clearError();
    return withSaving(async () => {
      try {
        const task = await tApi.create(req);
        setTasks(prev => [...prev, task]);
        return task;
      } catch (e) { return handleError(e); }
    });
  }, [tApi, clearError, handleError, withSaving]);

  const updateTask = useCallback(async (id: string, req: TaskUpdateRequest): Promise<ApiTask | null> => {
    clearError();
    return withSaving(async () => {
      try {
        const task = await tApi.update(id, req);
        setTasks(prev => prev.map(t => t.id === id ? task : t));
        return task;
      } catch (e) { return handleError(e); }
    });
  }, [tApi, clearError, handleError, withSaving]);

  const updateStatus = useCallback(async (id: string, status: TaskStatus): Promise<ApiTask | null> => {
    clearError();
    return withSaving(async () => {
      try {
        const task = await tApi.updateStatus(id, status);
        setTasks(prev => prev.map(t => t.id === id ? task : t));
        if (status === 'DONE') {
          await Promise.all([refreshMomentum(), refreshTodayHistory()]);
        }
        return task;
      } catch (e) { return handleError(e); }
    });
  }, [tApi, clearError, handleError, withSaving, refreshMomentum, refreshTodayHistory]);

  const markComplete = useCallback(async (id: string): Promise<ApiTask | null> => {
    clearError();
    return withSaving(async () => {
      try {
        const task = await tApi.markComplete(id);
        setTasks(prev => prev.map(t => t.id === id ? task : t));
        await Promise.all([refreshMomentum(), refreshTodayHistory()]);
        return task;
      } catch (e) { return handleError(e); }
    });
  }, [tApi, clearError, handleError, withSaving, refreshMomentum, refreshTodayHistory]);

  const reprioritize = useCallback(async (id: string, quadrant: Quadrant): Promise<ApiTask | null> => {
    clearError();
    return withSaving(async () => {
      try {
        const task = await tApi.reprioritize(id, quadrant);
        setTasks(prev => prev.map(t => t.id === id ? task : t));
        return task;
      } catch (e) { return handleError(e); }
    });
  }, [tApi, clearError, handleError, withSaving]);

  const deleteTask = useCallback(async (id: string): Promise<void> => {
    clearError();
    await withSaving(async () => {
      try {
        await tApi.delete(id);
        setTasks(prev => prev.filter(t => t.id !== id));
      } catch (e) { handleError(e); }
    });
  }, [tApi, clearError, handleError, withSaving]);

  // ── List mutations ─────────────────────────────────────────────────────────

  const createList = useCallback(async (name: string, color = 'emerald'): Promise<ApiList | null> => {
    clearError();
    return withSaving(async () => {
      try {
        const list = await lApi.create({ name, color, listOrder: lists.length });
        setLists(prev => [...prev, list]);
        return list;
      } catch (e) { return handleError(e); }
    });
  }, [lApi, clearError, handleError, withSaving, lists.length]);

  const updateList = useCallback(async (id: string, name: string, color?: string): Promise<ApiList | null> => {
    clearError();
    return withSaving(async () => {
      try {
        const list = await lApi.update(id, { name, color });
        setLists(prev => prev.map(l => l.id === id ? list : l));
        return list;
      } catch (e) { return handleError(e); }
    });
  }, [lApi, clearError, handleError, withSaving]);

  const deleteList = useCallback(async (id: string): Promise<void> => {
    clearError();
    await withSaving(async () => {
      try {
        await lApi.delete(id);
        setLists(prev => prev.filter(l => l.id !== id));
      } catch (e) { handleError(e); }
    });
  }, [lApi, clearError, handleError, withSaving]);

  // ── Persist to localStorage as offline fallback ────────────────────────────
  useEffect(() => {
    void saveAppState; // keep import live; actual persistence is in App.tsx
  }, []);

  // ── Return ─────────────────────────────────────────────────────────────────

  return {
    serverOnline,
    backendUnavailable,
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

// ── Utility: map ApiTask → frontend Todo shape ────────────────────────────────

/**
 * Converts a server ApiTask to the frontend Todo interface.
 * Import this in App.tsx when bridging server data to existing UI logic.
 */
export function apiTaskToTodo(t: ApiTask) {
  // Map server TaskStatus enum to frontend TodoStatus
  const statusMap: Record<import('../lib/api').TaskStatus, import('../types/todo').TodoStatus> = {
    TODO:        'todo',
    IN_PROGRESS: 'in-progress',
    DONE:        'done',
  };

  return {
    id:                    t.id,
    text:                  t.title,
    status:                statusMap[t.status],
    quadrant:              t.quadrant.toLowerCase() as import('../types/todo').Quadrant,
    priority:              t.priority?.toLowerCase() as 'low' | 'medium' | 'high' | undefined,
    note:                  t.note ?? undefined,
    dueDate:               t.dueDate ?? undefined,
    dueTime:               t.dueTime ?? undefined,
    completedAt:           t.completedAt ? new Date(t.completedAt).getTime() : undefined,
    createdAt:             new Date(t.createdAt).getTime(),
    category:              t.category ?? undefined,
    listId:                t.listId ?? '',
    order:                 t.taskOrder,
    reminderEnabled:       t.reminderEnabled,
    reminderMinutesBefore: t.reminderMinutesBefore ?? undefined,
    sourceNoteId:          t.sourceNoteId || undefined,
    sourceBlockId:         t.sourceBlockId || undefined,
  };
}

/**
 * Converts a server ApiList to the frontend KaizenList interface.
 */
export function apiListToKaizenList(l: ApiList) {
  return {
    id: l.id,
    name: l.name,
    color: l.color,
    createdAt: new Date(l.createdAt).getTime(),
  };
}
