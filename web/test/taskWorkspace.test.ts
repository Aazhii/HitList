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
  it('persists Work and Personal before exposing a fresh workspace', async () => {
    const api = backend([], []);
    const result = await loadTaskWorkspace(api);
    expect(result.lists).toEqual([work, personal]);
    expect(api.list.create.mock.calls).toEqual([
      [{ name: 'Work', color: 'blue', listOrder: 0 }],
      [{ name: 'Personal', color: 'emerald', listOrder: 1 }],
    ]);
    expect(api.list.create.mock.invocationCallOrder[1]).toBeLessThan(api.task.list.mock.invocationCallOrder[0]);
  });

  it('recovers unlisted tasks without changing their notes or source links', async () => {
    const orphan = {
      id: 'old-task', listId: null, title: 'Existing task', quadrant: 'DO',
      note: 'Keep my notes', sourceNoteId: 'note-id', sourceBlockId: 'block-id',
    } as ApiTask;
    const api = backend([], [orphan]);
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

  it('surfaces list save failures instead of exposing an unlisted workspace', async () => {
    const api = backend([], []);
    api.list.create.mockReset().mockRejectedValue(new Error('Save failed'));
    await expect(loadTaskWorkspace(api)).rejects.toThrow('Save failed');
    expect(api.task.list).not.toHaveBeenCalled();
  });
});