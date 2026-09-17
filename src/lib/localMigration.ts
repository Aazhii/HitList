import type {
  ApiList, ApiTask, ListCreateRequest, ListUpdateRequest, TaskCreateRequest, TaskUpdateRequest,
} from './api';
import type { AppState, KaizenList, Todo } from '@/types/todo';

const MIGRATION_KEY = 'kaizen-server-migration-v2';

interface MigrationJournal {
  version: 2;
  completed: boolean;
  lists: Record<string, string>;
  tasks: Record<string, string>;
  listSnapshots: Record<string, string>;
  taskSnapshots: Record<string, string>;
}

export interface LocalMigrationApis {
  lists: {
    list: () => Promise<ApiList[]>;
    get: (id: string) => Promise<ApiList>;
    create: (request: ListCreateRequest) => Promise<ApiList>;
    update?: (id: string, request: ListUpdateRequest) => Promise<ApiList>;
  };
  tasks: {
    list: () => Promise<ApiTask[]>;
    get: (id: string) => Promise<ApiTask>;
    create: (request: TaskCreateRequest) => Promise<ApiTask>;
    update?: (id: string, request: TaskUpdateRequest) => Promise<ApiTask>;
  };
}

export function migrationStorageKey(userId: string | null): string {
  return userId
    ? `${MIGRATION_KEY}-user-${encodeURIComponent(userId)}`
    : `${MIGRATION_KEY}-local`;
}

function readJournal(storage: Storage, userId: string | null): MigrationJournal {
  try {
    const value = JSON.parse(storage.getItem(migrationStorageKey(userId)) ?? '') as Partial<MigrationJournal>;
    if (
      value.version === 2 &&
      typeof value.completed === 'boolean' &&
      value.lists !== null && typeof value.lists === 'object' &&
      value.tasks !== null && typeof value.tasks === 'object'
    ) {
      return {
        version: 2,
        completed: value.completed,
        lists: value.lists as Record<string, string>,
        tasks: value.tasks as Record<string, string>,
        listSnapshots: value.listSnapshots as Record<string, string> ?? {},
        taskSnapshots: value.taskSnapshots as Record<string, string> ?? {},
      };
    }
  } catch {
    // A damaged journal is recoverable because every migrated entity has a
    // deterministic clientId and the server's primary key enforces uniqueness.
  }
  return {
    version: 2, completed: false, lists: {}, tasks: {}, listSnapshots: {}, taskSnapshots: {},
  };
}

function saveJournal(storage: Storage, userId: string | null, journal: MigrationJournal): void {
  storage.setItem(migrationStorageKey(userId), JSON.stringify(journal));
}

function isSeedList(list: KaizenList): boolean {
  return list.id.startsWith('list-');
}

function isSeedTask(todo: Todo): boolean {
  return todo.id.startsWith('seed-');
}

/** Fixed sample-list ids are shared by every browser, unlike generated local ids. */
function migrationListId(list: KaizenList, userId: string | null): string {
  if (!isSeedList(list)) return list.id;
  const source = `${userId ?? 'local'}:${list.id}`;
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let i = 0; i < source.length; i += 1) {
    const code = source.charCodeAt(i);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `migration-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}-${list.id}`;
}

function statusOf(todo: Todo): TaskCreateRequest['status'] {
  switch (todo.status) {
    case 'in-progress': return 'IN_PROGRESS';
    case 'done': return 'DONE';
    default: return 'TODO';
  }
}

function quadrantOf(todo: Todo): TaskCreateRequest['quadrant'] {
  switch (todo.quadrant) {
    case 'do': return 'DO';
    case 'delegate': return 'DELEGATE';
    case 'eliminate': return 'ELIMINATE';
    default: return 'SCHEDULE';
  }
}

function listSnapshot(list: KaizenList): string {
  return JSON.stringify({ name: list.name, color: list.color });
}

function taskSnapshot(todo: Todo, listId: string | undefined): string {
  return JSON.stringify({
    text: todo.text, status: todo.status, quadrant: todo.quadrant, note: todo.note,
    dueDate: todo.dueDate, dueTime: todo.dueTime, category: todo.category, listId,
    order: todo.order, reminderEnabled: todo.reminderEnabled,
    reminderMinutesBefore: todo.reminderMinutesBefore,
  });
}

async function getAfterDuplicate<T>(get: (id: string) => Promise<T>, id: string): Promise<T> {
  try {
    return await get(id);
  } catch {
    throw new Error(`Migration could not confirm the existing item ${id}`);
  }
}

/**
 * Moves the non-seed local task state to the server.
 *
 * The journal is written after each response, not just at the end. The server
 * receives the stable local id as `clientId`, making a retried request an
 * upsert-by-primary-key even when its first response was lost in transit.
 */
export async function migrateLocalState(
  localState: AppState,
  userId: string | null,
  apis: LocalMigrationApis,
  storage: Storage = window.localStorage,
): Promise<void> {
  const journal = readJournal(storage, userId);

  const todos = localState.todos.filter((todo) => !isSeedTask(todo));
  const neededListIds = new Set(todos.map((todo) => todo.listId).filter(Boolean));
  const lists = localState.lists.filter((list) => !isSeedList(list) || neededListIds.has(list.id));

  if (todos.length === 0 && lists.length === 0) {
    journal.completed = true;
    saveJournal(storage, userId, journal);
    return;
  }

  const serverLists = new Map((await apis.lists.list()).map((list) => [list.id, list]));
  for (const localList of lists) {
    const mappedId = journal.lists[localList.id];
    const clientId = migrationListId(localList, userId);
    // An existing migration made before seed ids were user-scoped is still
    // this user's list, because list() is owner-scoped.
    let created = (mappedId ? serverLists.get(mappedId) : undefined)
      ?? serverLists.get(clientId)
      ?? serverLists.get(localList.id);
    if (!created) {
      const request: ListCreateRequest = {
        name: localList.name,
        color: localList.color,
        listOrder: lists.indexOf(localList),
        clientId,
      };
      try {
        created = await apis.lists.create(request);
      } catch {
        created = await getAfterDuplicate(apis.lists.get, clientId);
      }
    } else if (
      journal.listSnapshots[localList.id] !== listSnapshot(localList) &&
      apis.lists.update
    ) {
      created = await apis.lists.update(created.id, {
        name: localList.name, color: localList.color, listOrder: lists.indexOf(localList),
      });
    }
    journal.lists[localList.id] = created.id;
    journal.listSnapshots[localList.id] = listSnapshot(localList);
    serverLists.set(created.id, created);
    saveJournal(storage, userId, journal);
  }

  const serverTasks = new Map((await apis.tasks.list()).map((task) => [task.id, task]));
  for (const todo of todos) {
    const mappedId = journal.tasks[todo.id];
    const listId = todo.listId ? journal.lists[todo.listId] : undefined;
    if (todo.listId && !listId) {
      throw new Error(`Migration cannot find the local list for task ${todo.id}`);
    }

    let created = (mappedId ? serverTasks.get(mappedId) : undefined) ?? serverTasks.get(todo.id);
    if (!created) {
      const request: TaskCreateRequest = {
        title: todo.text,
        status: statusOf(todo),
        quadrant: quadrantOf(todo),
        note: todo.note,
        dueDate: todo.dueDate,
        dueTime: todo.dueTime,
        category: todo.category,
        listId,
        taskOrder: todo.order,
        reminderEnabled: todo.reminderEnabled,
        reminderMinutesBefore: todo.reminderMinutesBefore,
        clientId: todo.id,
      };
      try {
        created = await apis.tasks.create(request);
      } catch {
        created = await getAfterDuplicate(apis.tasks.get, todo.id);
      }
    } else if (
      journal.taskSnapshots[todo.id] !== taskSnapshot(todo, listId) &&
      apis.tasks.update
    ) {
      created = await apis.tasks.update(created.id, {
        title: todo.text,
        status: statusOf(todo),
        quadrant: quadrantOf(todo),
        note: todo.note,
        dueDate: todo.dueDate,
        dueTime: todo.dueTime,
        category: todo.category,
        listId,
        taskOrder: todo.order,
        reminderEnabled: todo.reminderEnabled,
        reminderMinutesBefore: todo.reminderMinutesBefore,
      });
    }
    journal.tasks[todo.id] = created.id;
    journal.taskSnapshots[todo.id] = taskSnapshot(todo, listId);
    serverTasks.set(created.id, created);
    saveJournal(storage, userId, journal);
  }

  journal.completed = true;
  saveJournal(storage, userId, journal);
}
