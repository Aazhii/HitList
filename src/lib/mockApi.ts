/**
 * mockApi.ts — Realistic mocked Spring Boot API contracts
 *
 * Used when the real server is unreachable. Wraps localStorage operations
 * with simulated async delays so the UI behaves identically to the live path.
 * All functions mirror the real taskApi / listApi / statsApi signatures.
 */

import { loadAppState, saveAppState } from './storage';
import type {
  ApiTask,
  ApiList,
  ApiMomentumStats,
  TaskCreateRequest,
  TaskUpdateRequest,
  ListCreateRequest,
  ListUpdateRequest,
  TaskStatus,
  Quadrant,
} from './api';
import type { AppState, Todo, KaizenList } from '@/types/todo';

// ── Simulated network delay ───────────────────────────────────────────────────

function delay(ms = 120): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Converters ────────────────────────────────────────────────────────────────

function todoToApiTask(t: Todo): ApiTask {
  const statusMap: Record<string, ApiTask['status']> = {
    todo: 'TODO',
    'in-progress': 'IN_PROGRESS',
    done: 'DONE',
  };
  const quadrantMap: Record<string, ApiTask['quadrant']> = {
    do: 'DO',
    schedule: 'SCHEDULE',
    delegate: 'DELEGATE',
    eliminate: 'ELIMINATE',
  };
  return {
    id: t.id,
    title: t.text,
    status: statusMap[t.status] ?? 'TODO',
    quadrant: quadrantMap[t.quadrant] ?? 'SCHEDULE',
    priority: null,
    note: t.note ?? null,
    dueDate: t.dueDate ?? null,
    dueTime: t.dueTime ?? null,
    category: t.category ?? null,
    listId: t.listId || null,
    taskOrder: t.order,
    reminderEnabled: t.reminderEnabled ?? false,
    reminderMinutesBefore: t.reminderMinutesBefore ?? null,
    completedAt: t.completedAt ? new Date(t.completedAt).toISOString() : null,
    createdAt: new Date(t.createdAt).toISOString(),
    updatedAt: new Date(t.createdAt).toISOString(),
  };
}

function listToApiList(l: KaizenList): ApiList {
  return {
    id: l.id,
    name: l.name,
    color: l.color,
    listOrder: 0,
    createdAt: new Date(l.createdAt).toISOString(),
    updatedAt: new Date(l.createdAt).toISOString(),
  };
}

function getState(): AppState {
  return loadAppState();
}

function setState(updater: (s: AppState) => AppState): void {
  saveAppState(updater(getState()));
}

// ── Mock Task API ─────────────────────────────────────────────────────────────

export const mockTaskApi = {
  async list(params?: import('./api').TaskListParams): Promise<ApiTask[]> {
    await delay(80);
    const state = getState();
    let todos = state.todos;
    if (params?.listId) todos = todos.filter((t) => t.listId === params.listId);
    if (params?.status) {
      const statusValues = params.status.split(',').map((s) => s.trim());
      const statusMap: Record<TaskStatus, string> = { TODO: 'todo', IN_PROGRESS: 'in-progress', DONE: 'done' };
      todos = todos.filter((t) =>
        statusValues.some((sv) => {
          const mapped = statusMap[sv as TaskStatus];
          return mapped ? t.status === mapped : false;
        })
      );
    }
    // priority is not stored on the local Todo type; skip filtering in mock fallback
    if (params?.quadrant) {
      const quadrantMap: Record<string, string> = { DO: 'do', SCHEDULE: 'schedule', DELEGATE: 'delegate', ELIMINATE: 'eliminate' };
      const quadrants = params.quadrant.split(',').map((q) => q.trim());
      todos = todos.filter((t) => quadrants.some((q) => quadrantMap[q] === t.quadrant));
    }
    if (params?.search) {
      const q = params.search.toLowerCase();
      todos = todos.filter((t) => t.text.toLowerCase().includes(q) || (t.note ?? '').toLowerCase().includes(q));
    }
    if (params?.dueBefore) {
      todos = todos.filter((t) => t.dueDate && t.dueDate <= params.dueBefore!);
    }
    if (params?.dueAfter) {
      todos = todos.filter((t) => t.dueDate && t.dueDate >= params.dueAfter!);
    }
    return todos.map(todoToApiTask);
  },

  async get(id: string): Promise<ApiTask> {
    await delay(60);
    const state = getState();
    const todo = state.todos.find((t) => t.id === id);
    if (!todo) throw new Error(`Task ${id} not found`);
    return todoToApiTask(todo);
  },

  async todayHistory(listId?: string): Promise<ApiTask[]> {
    await delay(80);
    const state = getState();
    const today = new Date();
    const isTodayTs = (ts: number) => {
      const d = new Date(ts);
      return d.getFullYear() === today.getFullYear() &&
        d.getMonth() === today.getMonth() &&
        d.getDate() === today.getDate();
    };
    let todos = state.todos.filter((t) => {
      if (t.status !== 'done') return false;
      if (t.completedAt) return isTodayTs(t.completedAt);
      return isTodayTs(t.createdAt);
    });
    if (listId) todos = todos.filter((t) => t.listId === listId);
    return todos
      .sort((a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt))
      .map(todoToApiTask);
  },

  async create(req: TaskCreateRequest): Promise<ApiTask> {
    await delay(150);
    const state = getState();
    const statusMap: Record<string, string> = { TODO: 'todo', IN_PROGRESS: 'in-progress', DONE: 'done' };
    const quadrantMap: Record<string, string> = { DO: 'do', SCHEDULE: 'schedule', DELEGATE: 'delegate', ELIMINATE: 'eliminate' };
    const now = Date.now();
    const newTodo: Todo = {
      id: crypto.randomUUID(),
      text: req.title,
      status: (statusMap[req.status ?? 'TODO'] ?? 'todo') as Todo['status'],
      quadrant: (quadrantMap[req.quadrant ?? 'SCHEDULE'] ?? 'schedule') as Todo['quadrant'],
      note: req.note,
      dueDate: req.dueDate,
      dueTime: req.dueTime,
      category: req.category,
      listId: req.listId ?? state.activeListId,
      order: req.taskOrder ?? state.todos.length,
      reminderEnabled: req.reminderEnabled ?? false,
      reminderMinutesBefore: req.reminderMinutesBefore,
      createdAt: now,
    };
    setState((s) => ({ ...s, todos: [...s.todos, newTodo] }));
    return todoToApiTask(newTodo);
  },

  async update(id: string, req: TaskUpdateRequest): Promise<ApiTask> {
    await delay(120);
    const state = getState();
    const existing = state.todos.find((t) => t.id === id);
    if (!existing) throw new Error(`Task ${id} not found`);
    const statusMap: Record<string, string> = { TODO: 'todo', IN_PROGRESS: 'in-progress', DONE: 'done' };
    const quadrantMap: Record<string, string> = { DO: 'do', SCHEDULE: 'schedule', DELEGATE: 'delegate', ELIMINATE: 'eliminate' };
    const updated: Todo = {
      ...existing,
      text: req.title ?? existing.text,
      status: req.status ? (statusMap[req.status] as Todo['status']) : existing.status,
      quadrant: req.quadrant ? (quadrantMap[req.quadrant] as Todo['quadrant']) : existing.quadrant,
      note: req.note !== undefined ? req.note : existing.note,
      dueDate: req.dueDate !== undefined ? req.dueDate : existing.dueDate,
      dueTime: req.dueTime !== undefined ? req.dueTime : existing.dueTime,
      category: req.category !== undefined ? req.category : existing.category,
      reminderEnabled: req.reminderEnabled !== undefined ? req.reminderEnabled : existing.reminderEnabled,
      reminderMinutesBefore: req.reminderMinutesBefore !== undefined ? req.reminderMinutesBefore : existing.reminderMinutesBefore,
    };
    setState((s) => ({ ...s, todos: s.todos.map((t) => (t.id === id ? updated : t)) }));
    return todoToApiTask(updated);
  },

  async updateStatus(id: string, status: TaskStatus): Promise<ApiTask> {
    await delay(100);
    const state = getState();
    const existing = state.todos.find((t) => t.id === id);
    if (!existing) throw new Error(`Task ${id} not found`);
    const statusMap: Record<TaskStatus, string> = { TODO: 'todo', IN_PROGRESS: 'in-progress', DONE: 'done' };
    const updated: Todo = {
      ...existing,
      status: statusMap[status] as Todo['status'],
      completedAt: status === 'DONE' ? Date.now() : undefined,
    };
    setState((s) => ({ ...s, todos: s.todos.map((t) => (t.id === id ? updated : t)) }));
    return todoToApiTask(updated);
  },

  async markComplete(id: string): Promise<ApiTask> {
    await delay(100);
    const state = getState();
    const existing = state.todos.find((t) => t.id === id);
    if (!existing) throw new Error(`Task ${id} not found`);
    const now = Date.now();
    const updated: Todo = { ...existing, status: 'done', completedAt: now };
    setState((s) => {
      const newStats = {
        ...s.stats,
        totalCompleted: s.stats.totalCompleted + 1,
        todayCompleted: s.stats.todayCompleted + 1,
      };
      return { ...s, todos: s.todos.map((t) => (t.id === id ? updated : t)), stats: newStats };
    });
    return todoToApiTask(updated);
  },

  async reprioritize(id: string, quadrant: Quadrant): Promise<ApiTask> {
    await delay(100);
    const state = getState();
    const existing = state.todos.find((t) => t.id === id);
    if (!existing) throw new Error(`Task ${id} not found`);
    const quadrantMap: Record<Quadrant, string> = { DO: 'do', SCHEDULE: 'schedule', DELEGATE: 'delegate', ELIMINATE: 'eliminate' };
    const updated: Todo = { ...existing, quadrant: quadrantMap[quadrant] as Todo['quadrant'] };
    setState((s) => ({ ...s, todos: s.todos.map((t) => (t.id === id ? updated : t)) }));
    return todoToApiTask(updated);
  },

  async delete(id: string): Promise<void> {
    await delay(100);
    setState((s) => ({ ...s, todos: s.todos.filter((t) => t.id !== id) }));
  },
};

// ── Mock List API ─────────────────────────────────────────────────────────────

export const mockListApi = {
  async list(): Promise<ApiList[]> {
    await delay(80);
    return getState().lists.map(listToApiList);
  },

  async get(id: string): Promise<ApiList> {
    await delay(60);
    const list = getState().lists.find((l) => l.id === id);
    if (!list) throw new Error(`List ${id} not found`);
    return listToApiList(list);
  },

  async create(req: ListCreateRequest): Promise<ApiList> {
    await delay(150);
    const newList: KaizenList = {
      id: crypto.randomUUID(),
      name: req.name,
      color: req.color ?? 'emerald',
      createdAt: Date.now(),
    };
    setState((s) => ({ ...s, lists: [...s.lists, newList] }));
    return listToApiList(newList);
  },

  async update(id: string, req: ListUpdateRequest): Promise<ApiList> {
    await delay(120);
    const state = getState();
    const existing = state.lists.find((l) => l.id === id);
    if (!existing) throw new Error(`List ${id} not found`);
    const updated: KaizenList = {
      ...existing,
      name: req.name ?? existing.name,
      color: req.color ?? existing.color,
    };
    setState((s) => ({ ...s, lists: s.lists.map((l) => (l.id === id ? updated : l)) }));
    return listToApiList(updated);
  },

  async delete(id: string): Promise<void> {
    await delay(100);
    setState((s) => ({
      ...s,
      lists: s.lists.filter((l) => l.id !== id),
      todos: s.todos.filter((t) => t.listId !== id),
    }));
  },
};

// ── Mock Stats API ────────────────────────────────────────────────────────────

export const mockStatsApi = {
  async momentum(listId?: string): Promise<ApiMomentumStats> {
    await delay(80);
    const state = getState();
    const today = new Date();
    const isTodayTs = (ts: number) => {
      const d = new Date(ts);
      return d.getFullYear() === today.getFullYear() &&
        d.getMonth() === today.getMonth() &&
        d.getDate() === today.getDate();
    };
    let todos = state.todos.filter((t) => t.status === 'done');
    if (listId) todos = todos.filter((t) => t.listId === listId);
    const todayCompleted = todos.filter((t) =>
      t.completedAt ? isTodayTs(t.completedAt) : isTodayTs(t.createdAt)
    ).length;
    return {
      streak: state.stats.streak,
      totalCompleted: state.stats.totalCompleted,
      todayCompleted,
      listId: listId ?? state.activeListId,
      asOf: new Date().toISOString(),
    };
  },
};
