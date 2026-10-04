import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNotes } from '@/hooks/useNotes';
import { notesStorageKey } from '@/lib/notesStorage';
import { getActiveTaskStorageId, setActiveTaskWorkspace, setActiveUserId } from '@/lib/storage';
import { notesSyncService } from '@/services/notesSyncService';
import type { NotePayload } from '@/services/notesSyncService';

const note = { id: 'shared', title: 'Stale cache', blocks: [{ id: 'block', type: 'paragraph', content: 'Old' }], createdAt: 1, updatedAt: 1 };
const payload = (title: string): NotePayload => ({ id: note.id, title, blocksJson: JSON.stringify(note.blocks), createdAt: 1, updatedAt: 2 });

beforeEach(() => { localStorage.clear(); setActiveUserId('source-test'); setActiveTaskWorkspace('team'); notesSyncService.restorePending(); });
afterEach(async () => { await notesSyncService.flushForSignOut(); vi.restoreAllMocks(); localStorage.clear(); setActiveUserId(null); });

describe('workspace note cache', () => {
  it('retains in-flight writes alongside newly queued notes for a restart', async () => {
    let finish: (response: Response) => void = () => {};
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      if (++calls === 1) return new Promise((resolve) => { finish = resolve; });
      return new Response('{}');
    });
    notesSyncService.queueUpsert(payload('First'));
    const saving = notesSyncService.flushNow();
    notesSyncService.queueUpsert({ ...payload('Second'), id: 'second' });
    const pending = JSON.parse(localStorage.getItem('hitlist-note-writes:source-test:workspace:team') ?? '[]') as Array<{ noteId: string }>;
    expect(pending.map((op) => op.noteId)).toEqual(['shared', 'second']);
    finish(new Response('{}'));
    await saving;
    await notesSyncService.flushForSignOut();
  });
  it('keeps personal and different workspace caches separate', () => {
    expect(notesStorageKey('alice')).not.toBe(notesStorageKey('alice', 'team'));
    expect(notesStorageKey('alice', 'team')).not.toBe(notesStorageKey('bob', 'team'));
    expect(notesStorageKey('alice', 'team')).not.toBe(notesStorageKey('alice', 'other'));
  });

  it('reads canonical notes without writing stale cache back', async () => {
    localStorage.setItem(notesStorageKey(getActiveTaskStorageId()), JSON.stringify([note]));
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([payload('Canonical buddy edit')])));
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.activeNote?.title).toBe('Canonical buddy edit');
    expect(fetcher.mock.calls.every(([, options]) => !options?.body)).toBe(true);
  });

  it('does not resurrect a deletion when an older refresh finishes after the save', async () => {
    let answer: (response: Response) => void = () => {};
    let reads = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      if (options?.body || options?.method === 'POST') return new Response('{}');
      if (++reads === 1) return new Response(JSON.stringify([payload('Canonical')]));
      return new Promise((resolve) => { answer = resolve; });
    });
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => { window.dispatchEvent(new Event('hitlist:workspace-data-changed')); });
    act(() => result.current.deleteNote('shared'));
    await act(async () => { await notesSyncService.flushForSignOut(); answer(new Response(JSON.stringify([payload('Old remote')]))); });
    expect(result.current.notes).toEqual([]);
  });

  it('flushes the latest explicit source before sharing and preserves it against a slow read', async () => {
    let answer: (response: Response) => void = () => {};
    let reads = 0;
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      if (options?.body) return new Response('{}');
      if (++reads === 1) return new Response(JSON.stringify([payload('Canonical')]));
      return new Promise((resolve) => { answer = resolve; });
    });
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => { window.dispatchEvent(new Event('hitlist:workspace-data-changed')); });
    act(() => result.current.updateNoteTitle('shared', 'Latest edit'));
    await act(async () => { await result.current.flushNote('shared'); answer(new Response(JSON.stringify([payload('Old remote')]))); });
    expect(result.current.activeNote?.title).toBe('Latest edit');
    expect(fetcher.mock.calls.some(([, options]) => String(options?.body).includes('Latest edit'))).toBe(true);
  });
});