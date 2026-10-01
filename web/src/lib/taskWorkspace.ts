import type { ApiList, ApiTask, ListCreateRequest, TaskUpdateRequest } from './api';

interface WorkspaceApi {
  list: {
    list: () => Promise<ApiList[]>;
    create: (request: ListCreateRequest) => Promise<ApiList>;
  };
  task: {
    list: () => Promise<ApiTask[]>;
    update: (id: string, request: TaskUpdateRequest) => Promise<ApiTask>;
  };
}

export async function loadTaskWorkspace(api: WorkspaceApi) {
  const lists = [...await api.list.list()];
  if (lists.length === 0) {
    lists.push(await api.list.create({ name: 'Work', color: 'blue', listOrder: 0 }));
    lists.push(await api.list.create({ name: 'Personal', color: 'emerald', listOrder: 1 }));
  }
  const tasks = await api.task.list();
  const repairedTasks = await Promise.all(tasks.map((task) =>
    task.listId?.trim()
      ? task
      : api.task.update(task.id, { listId: lists[0].id }),
  ));
  return { lists, tasks: repairedTasks };
}