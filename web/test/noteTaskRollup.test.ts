import { describe, expect, it } from 'vitest';
import { noteTaskRollup, rollupLabel } from '@/lib/noteTaskRollup';
import type { NoteBlock } from '@/types/notes';

const block = (id: string, taskId?: string): NoteBlock => ({ id, type: 'paragraph', content: id, ...(taskId ? { taskId } : {}) });

describe('noteTaskRollup', () => {
  const blocks = [block('a', 't1'), block('b'), block('c', 't2'), block('d', 'gone'), block('e', 't3')];
  const todos = [
    { id: 't1', status: 'done' }, { id: 't2', status: 'todo' }, { id: 't3', status: 'in_progress' },
  ];

  it('counts tasks that still exist and are done, ignoring lines that are not tasks and tasks deleted elsewhere', () => {
    expect(noteTaskRollup(blocks, todos)).toEqual({ total: 3, done: 1 });
  });

  it('is empty for a note with no tasks', () => {
    expect(noteTaskRollup([block('a')], todos)).toEqual({ total: 0, done: 0 });
  });
});

describe('rollupLabel', () => {
  it('says how they are getting on', () => {
    expect(rollupLabel({ total: 0, done: 0 })).toBe('');
    expect(rollupLabel({ total: 1, done: 0 })).toBe('1 linked task');
    expect(rollupLabel({ total: 3, done: 0 })).toBe('3 linked tasks');
    expect(rollupLabel({ total: 7, done: 3 })).toBe('3 of 7 linked tasks done');
    expect(rollupLabel({ total: 2, done: 2 })).toBe('All 2 linked tasks done');
    expect(rollupLabel({ total: 1, done: 1 })).toBe('Linked task done');
  });
});
