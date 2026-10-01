import { describe, expect, it, vi } from 'vitest';
import { loadTaskWorkspace } from '@/lib/taskWorkspace';
import type { ApiList, ApiTask } from '@/lib/api';

const work = { id: 'work-id', name: 'Work', color: 'blue', listOrder: 0 } as ApiList;
const personal = { id: 'personal-id', name: 'Personal', color: 'emerald', listOrder: 1 } as ApiList;

function backend(lists: ApiList[], tasks: ApiTask[]) {
  return {
    list: {
      list: vi.fn().mockResolvedValue(lists),
      create: vi.fn().mockResolvedValueOnce(work).mockResolvedValueOnce(personal),
    },
    task: {
      list: vi.fn().mockResolvedValue(tasks),
      update: vi.fn(async (id, request) => ({ ...tasks.find((task) => task.id === id), ...request } as ApiTask)),
    },
  };
}

describe('task workspace initialization', () => {
  it('keeps a fresh or deleted-last-list workspace empty', async () => {
    const api = backend([], []);
    const result = await loadTaskWorkspace(api);
    expect(result).toEqual({ lists: [], tasks: [] });
    expect(api.list.create).not.toHaveBeenCalled();
  });

  it('recovers unlisted tasks without changing their notes or source links', async () => {
    const orphan = {
      id: 'old-task', listId: null, title: 'Existing task', quadrant: 'DO',
      note: 'Keep my notes', sourceNoteId: 'note-id', sourceBlockId: 'block-id',
    } as ApiTask;
    const api = backend([work], [orphan]);
    const result = await loadTaskWorkspace(api);
    expect(api.task.update).toHaveBeenCalledWith('old-task', { listId: work.id });
    expect(result.tasks).toEqual([{ ...orphan, listId: work.id }]);
  });

  it('uses an existing list for recovery and leaves associated tasks alone', async () => {
    const assigned = { id: 'assigned', listId: personal.id, note: 'Unchanged' } as ApiTask;
    const orphan = { id: 'orphan', listId: '' } as ApiTask;
    const api = backend([personal], [assigned, orphan]);
    const result = await loadTaskWorkspace(api);
    expect(api.list.create).not.toHaveBeenCalled();
    expect(api.task.update).toHaveBeenCalledTimes(1);
    expect(result.tasks).toEqual([assigned, { ...orphan, listId: personal.id }]);
  });

  it('preserves legacy unlisted tasks until a list is explicitly created', async () => {
    const orphan = { id: 'old-task', listId: null, note: 'Keep my notes' } as ApiTask;
    const api = backend([], [orphan]);
    expect(await loadTaskWorkspace(api)).toEqual({ lists: [], tasks: [orphan] });
    expect(api.list.create).not.toHaveBeenCalled();
    expect(api.task.update).not.toHaveBeenCalled();
  });
});