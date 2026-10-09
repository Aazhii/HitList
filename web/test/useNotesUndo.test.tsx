import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useNotes } from '@/hooks/useNotes';
import { notesStorageKey } from '@/lib/notesStorage';
import { setActiveUserId } from '@/lib/storage';
import { notesSyncService } from '@/services/notesSyncService';
import { prepareForSignOut } from '@/lib/preLogout';

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); setActiveUserId(null); });

const blocks = () => [
  { id: 'a', type: 'todo', content: 'parent' },
  { id: 'a1', type: 'todo', content: 'child', indent: 1 },
  { id: 'b', type: 'todo', content: 'other' },
];

async function open(extra: Record<string, unknown> = {}) {
  setActiveUserId('12345');
  localStorage.setItem(notesStorageKey('12345'), JSON.stringify([
    { id: 'n1', title: 'One', blocks: blocks(), createdAt: 1, updatedAt: 1 },
    { id: 'n2', title: 'Two', blocks: [{ id: 'z', type: 'paragraph', content: 'zzz' }], createdAt: 1, updatedAt: 1 },
  ]));
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('[]', { status: 200 }));
  const hook = renderHook(() => useNotes());
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  const note = (id = 'n1') => hook.result.current.notes.find((n) => n.id === id)!;
  void extra;
  return { hook, note };
}

it('undo brings back a deleted group and redo removes it again, saved like any edit', async () => {
  const { hook, note } = await open();
  act(() => hook.result.current.setBlocks('n1', [note().blocks[2]]));
  await waitFor(() => expect(note().blocks.map((x) => x.id)).toEqual(['b']));
  let restored: unknown;
  act(() => { restored = hook.result.current.undoBlocks('n1'); });
  expect(restored).not.toBeNull();
  expect(note().blocks.map((x) => x.id)).toEqual(['a', 'a1', 'b']);
  expect(JSON.parse(localStorage.getItem(notesStorageKey('12345')) ?? '[]')[0].blocks.map((x: { id: string }) => x.id)).toEqual(['a', 'a1', 'b']);
  act(() => { hook.result.current.redoBlocks('n1'); });
  expect(note().blocks.map((x) => x.id)).toEqual(['b']);
  act(() => { expect(hook.result.current.undoBlocks('n1')).not.toBeNull(); expect(hook.result.current.undoBlocks('n1')).toBeNull(); });
});

it('typing in one block is one step', async () => {
  const { hook, note } = await open();
  for (const text of ['p', 'pa', 'par']) act(() => hook.result.current.updateBlock('n1', 'a', { content: text }));
  expect(note().blocks[0].content).toBe('par');
  act(() => { hook.result.current.undoBlocks('n1'); });
  expect(note().blocks[0].content).toBe('parent');
  expect(hook.result.current.undoBlocks('n1')).toBeNull();
});

it('undo in one note never touches another', async () => {
  const { hook, note } = await open();
  act(() => hook.result.current.deleteBlock('n1', 'b'));
  expect(hook.result.current.undoBlocks('n2')).toBeNull();
  expect(note('n2').blocks.map((x) => x.content)).toEqual(['zzz']);
  expect(note().blocks).toHaveLength(2);
});

it('does nothing once there is nothing to undo, and a deleted note has no history', async () => {
  const { hook } = await open();
  expect(hook.result.current.undoBlocks('n1')).toBeNull();
  act(() => hook.result.current.deleteBlock('n1', 'b'));
  act(() => hook.result.current.deleteNote('n1'));
  expect(hook.result.current.undoBlocks('n1')).toBeNull();
});

it('a note replaced from the server starts with no history, so undo cannot bring back stale blocks', async () => {
  const { hook, note } = await open();
  act(() => hook.result.current.deleteBlock('n1', 'b'));
  await act(async () => { await notesSyncService.flushNow(); });
  const remote = [{ id: 'n1', title: 'One', blocksJson: JSON.stringify([{ id: 'r', type: 'paragraph', content: 'from server' }]), createdAt: 1, updatedAt: 99 }];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => String(url).endsWith('/api/notes')
    ? new Response(JSON.stringify(remote), { status: 200 })
    : new Response('{}', { status: 200 }));
  await act(async () => { window.dispatchEvent(new Event('hitlist:workspace-data-changed')); await new Promise((r) => setTimeout(r, 50)); });
  expect(note().blocks.map((x) => x.content)).toEqual(['from server']);
  expect(hook.result.current.undoBlocks('n1')).toBeNull();
});

it('signing out clears the history', async () => {
  const { hook } = await open();
  act(() => hook.result.current.deleteBlock('n1', 'b'));
  await act(async () => { await prepareForSignOut(); });
  expect(hook.result.current.undoBlocks('n1')).toBeNull();
});
