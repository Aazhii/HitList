import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useNotes } from '@/hooks/useNotes';
import { notesStorageKey } from '@/lib/notesStorage';
import { setActiveUserId } from '@/lib/storage';
import { prepareForSignOut } from '@/lib/preLogout';

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); setActiveUserId(null); });

it('flushes the latest note title before logout without waiting for the edit debounce', async () => {
  setActiveUserId('12345');
  localStorage.setItem(notesStorageKey('12345'), JSON.stringify([
    { id: 'private-note', title: 'Before edit', blocks: [], createdAt: 1, updatedAt: 1 },
  ]));
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 200 }));
  const { result } = renderHook(() => useNotes());
  await waitFor(() => expect(result.current.notes.length).toBe(1));
  act(() => result.current.updateNoteTitle('private-note', 'Latest title before logout'));
  await act(async () => { await prepareForSignOut(); });
  const writes = fetchSpy.mock.calls.filter(([, options]) => options?.method === 'POST' || options?.method === 'PUT');
  expect(writes.length).toBeGreaterThan(0);
  expect(writes.some(([, options]) => String(options?.body).includes('Latest title before logout'))).toBe(true);
});