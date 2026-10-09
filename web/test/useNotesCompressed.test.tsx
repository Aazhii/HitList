import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useNotes } from '@/hooks/useNotes';
import { notesStorageKey } from '@/lib/notesStorage';
import { setActiveUserId } from '@/lib/storage';
import { encodeBlocksJson } from '@/lib/noteBlocksCodec';
import { notesSyncService } from '@/services/notesSyncService';

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); setActiveUserId(null); });

const block = (id: string, content: string) => ({ id, type: 'toggle', content });

it('opens a note the server holds deflated, with the same blocks', async () => {
  setActiveUserId('12345');
  const blocks = Array.from({ length: 150 }, (_, i) => block(`b${i}`, `"api_name": "Field_${i % 4}",`));
  const stored = await encodeBlocksJson(JSON.stringify(blocks));
  expect(stored.startsWith('z1:')).toBe(true);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => String(url).endsWith('/api/notes')
    ? new Response(JSON.stringify([{ id: 'big', title: 'Big', blocksJson: stored, updatedAt: 5 }]), { status: 200 })
    : new Response('{}', { status: 200 }));
  const { result } = renderHook(() => useNotes());
  await waitFor(() => expect(result.current.notes.find((n) => n.id === 'big')?.blocks).toHaveLength(150));
  expect(result.current.notes.find((n) => n.id === 'big')?.blocks[7]).toEqual(blocks[7]);
});

it('keeps the local copy of a note it cannot decode, instead of dropping or replacing it', async () => {
  setActiveUserId('12345');
  const local = { id: 'big', title: 'Local', blocks: [block('a', 'my words')], createdAt: 1, updatedAt: 1 };
  localStorage.setItem(notesStorageKey('12345'), JSON.stringify([local]));
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => String(url).endsWith('/api/notes')
    ? new Response(JSON.stringify([{ id: 'big', title: 'Remote', blocksJson: 'z1:AAAA', updatedAt: 9 }]), { status: 200 })
    : new Response('{}', { status: 200 }));
  const { result } = renderHook(() => useNotes());
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  // Once nothing is waiting to be sent, a later refresh must still not drop or replace the note it cannot read.
  await act(async () => { await notesSyncService.flushNow(); });
  expect(notesSyncService.hasPending('big')).toBe(false);
  await act(async () => { window.dispatchEvent(new Event('hitlist:workspace-data-changed')); await new Promise((r) => setTimeout(r, 50)); });
  expect(result.current.notes).toHaveLength(1);
  expect(result.current.notes[0].blocks).toEqual(local.blocks);
  expect(JSON.parse(localStorage.getItem(notesStorageKey('12345')) ?? '[]')[0].blocks).toEqual(local.blocks);
});
