import { describe, expect, it } from 'vitest';
import { migrateLocalState, migrationStorageKey } from '@/lib/localMigration';
import type { ApiList, ApiTask, ListCreateRequest, TaskCreateRequest, TaskUpdateRequest } from '@/lib/api';
import type { AppState } from '@/types/todo';

const task = (id: string, listId: string): ApiTask => ({
  id, title: id, status: 'TODO', quadrant: 'DO', priority: null, note: null,
  dueDate: null, dueTime: null, category: null, listId, taskOrder: 0,
  reminderEnabled: false, reminderMinutesBefore: null, completedAt: null,
  createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
});
const list = (id: string): ApiList => ({
  id, name: id, color: 'emerald', listOrder: 0,
  createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
});

function state(): AppState {
  return {
    version: 3, activeListId: 'old-list', stats: { streak: 0, totalCompleted: 0, todayCompleted: 0 },
    lastStreakDay: '',
    lists: [{ id: 'old-list', name: 'Local list', color: 'rose', createdAt: 1 }],
    todos: [{
      id: 'old-task', text: 'Local task', status: 'todo', quadrant: 'do', listId: 'old-list',
      order: 2, createdAt: 1,
    }],
  };
}

describe('local server migration', () => {
  it('maps the created list id before creating its task', async () => {
    const listRequests: ListCreateRequest[] = [];
    const taskRequests: TaskCreateRequest[] = [];
    await migrateLocalState(state(), 'user-a', {
      lists: {
        list: async () => [],
        get: async () => list('server-list'),
        create: async (request) => { listRequests.push(request); return list('server-list'); },
      },
      tasks: {
        list: async () => [],
        get: async () => task('server-task', 'server-list'),
        create: async (request) => { taskRequests.push(request); return task('server-task', 'server-list'); },
      },
    });

    expect(listRequests[0]).toMatchObject({ clientId: 'old-list', name: 'Local list' });
    expect(taskRequests[0]).toMatchObject({ clientId: 'old-task', listId: 'server-list', title: 'Local task' });
  });

  it('retains the completion time of an already completed local task', async () => {
    const local = state();
    local.todos[0] = {
      ...local.todos[0],
      status: 'done',
      completedAt: Date.parse('2026-09-24T12:34:56Z'),
    };
    const taskRequests: TaskCreateRequest[] = [];

    await migrateLocalState(local, 'user-a', {
      lists: {
        list: async () => [],
        get: async () => list('old-list'),
        create: async () => list('old-list'),
      },
      tasks: {
        list: async () => [],
        get: async () => task('old-task', 'old-list'),
        create: async (request) => {
          taskRequests.push(request);
          return task('old-task', 'old-list');
        },
      },
    });

    expect(taskRequests[0]).toMatchObject({
      status: 'DONE',
      completedAt: '2026-09-24T12:34:56.000Z',
    });
  });

  it('keeps durable per-item progress and retries only the failed item', async () => {
    const local = state();
    local.todos.push({ ...local.todos[0], id: 'second-task', text: 'Second task' });
    const createdTasks: TaskCreateRequest[] = [];
    const serverTasks = new Map<string, ApiTask>();
    let failSecond = true;
    const apis = {
      lists: {
        list: async () => [],
        get: async () => list('server-list'),
        create: async () => list('server-list'),
      },
      tasks: {
        list: async () => [...serverTasks.values()],
        get: async (id: string) => {
          const existing = serverTasks.get(id);
          if (!existing) throw new Error('not found');
          return existing;
        },
        create: async (request: TaskCreateRequest) => {
          createdTasks.push(request);
          if (request.clientId === 'second-task' && failSecond) throw new Error('offline');
          const created = task(request.clientId!, 'server-list');
          serverTasks.set(created.id, created);
          return created;
        },
      },
    };

    await expect(migrateLocalState(local, 'user-a', apis)).rejects.toThrow('Migration could not confirm');
    expect(JSON.parse(localStorage.getItem(migrationStorageKey('user-a'))!).completed).toBe(false);

    failSecond = false;
    await migrateLocalState(local, 'user-a', apis);
    expect(createdTasks.map((request) => request.clientId)).toEqual(['old-task', 'second-task', 'second-task']);
    expect(JSON.parse(localStorage.getItem(migrationStorageKey('user-a'))!).completed).toBe(true);
  });

  it('keeps migration journals scoped to their owner and leaves local mode stable', () => {
    expect(migrationStorageKey('user-a')).not.toBe(migrationStorageKey('user-b'));
    expect(migrationStorageKey(null)).toContain('-local');
  });

  it('does not reuse a fixed seed list id for different server owners', async () => {
    const local = state();
    local.lists = [{ id: 'list-daily', name: 'Daily', color: 'emerald', createdAt: 1 }];
    local.todos = [{ ...local.todos[0], listId: 'list-daily' }];
    const clientIds: string[] = [];
    const apis = {
      lists: {
        list: async () => [],
        get: async (id: string) => list(id),
        create: async (request: ListCreateRequest) => {
          clientIds.push(request.clientId!);
          return list(request.clientId!);
        },
      },
      tasks: {
        list: async () => [],
        get: async (id: string) => task(id, ''),
        create: async (request: TaskCreateRequest) => task(request.clientId!, request.listId ?? ''),
      },
    };

    await migrateLocalState(local, 'user-a', apis);
    await migrateLocalState(local, 'user-b', apis);

    expect(clientIds).toHaveLength(2);
    expect(clientIds[0]).not.toBe('list-daily');
    expect(clientIds[0]).not.toBe(clientIds[1]);
  });

  it('uploads a later offline edit after the initial journal is complete', async () => {
    const local = state();
    const serverLists = new Map<string, ApiList>();
    const serverTasks = new Map<string, ApiTask>();
    const updates: TaskUpdateRequest[] = [];
    const apis = {
      lists: {
        list: async () => [...serverLists.values()],
        get: async (id: string) => serverLists.get(id) ?? list(id),
        create: async (request: ListCreateRequest) => {
          const created = list(request.clientId!);
          serverLists.set(created.id, created);
          return created;
        },
      },
      tasks: {
        list: async () => [...serverTasks.values()],
        get: async (id: string) => serverTasks.get(id) ?? task(id, 'old-list'),
        create: async (request: TaskCreateRequest) => {
          const created = task(request.clientId!, request.listId ?? '');
          serverTasks.set(created.id, created);
          return created;
        },
        update: async (id: string, request: TaskUpdateRequest) => {
          updates.push(request);
          const saved = { ...task(id, request.listId ?? ''), title: request.title ?? id };
          serverTasks.set(id, saved);
          return saved;
        },
      },
    };

    await migrateLocalState(local, 'user-a', apis);
    local.todos[0].text = 'Edited while offline';
    await migrateLocalState(local, 'user-a', apis);

    expect(updates).toEqual([expect.objectContaining({ title: 'Edited while offline' })]);
  });
});
