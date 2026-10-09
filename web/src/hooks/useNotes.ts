/**
 * useNotes — notes state management with localStorage + background server sync.
 *
 * localStorage is ALWAYS the source of truth for reads.
 * notesSyncService handles all server communication asynchronously.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import type { Note, NoteBlock, BlockType } from '@/types/notes';
import { createNewNote, createEmptyBlock } from '@/types/notes';
import { getActiveTaskStorageId } from '@/lib/storage';
import { API_BASE_URL } from '@/lib/api';
import { onSourceSave } from '@/lib/sourceSaves';
import { decodeBlocksJson, isCompressed } from '@/lib/noteBlocksCodec';
import { indentBlock, insertIndexAfter, levelForNewBlockAfter, moveBlockWithChildren, normalizeIndents, outdentBlock } from '@/lib/noteBlocks';
import { loadAccountNotes, notesStorageKey } from '@/lib/notesStorage';
import { notesSyncService } from '@/services/notesSyncService';
import type { NotePayload } from '@/services/notesSyncService';
import { onPreLogout } from '@/lib/preLogout';

// ── Helpers ───────────────────────────────────────────────────────────────────

function persistLocal(notes: Note[]) {
  try {
    localStorage.setItem(notesStorageKey(getActiveTaskStorageId()), JSON.stringify(notes));
  } catch { /* quota exceeded — ignore */ }
}

function loadLocalNotes(): Note[] {
  return loadAccountNotes(localStorage, getActiveTaskStorageId());
}

function noteToPayload(note: Note): NotePayload {
  return {
    id:         note.id,
    title:      note.title || 'Untitled',
    blocksJson: JSON.stringify(note.blocks),
    emoji:      note.emoji,
    pinned:     note.pinned,
    createdAt:  note.createdAt,
    updatedAt:  note.updatedAt,
  };
}

// ── Save status ───────────────────────────────────────────────────────────────

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [isLoading, setIsLoading] = useState(true);

  // Keep a ref to latest notes for beforeunload flush
  const notesRef = useRef(notes);
  useEffect(() => { notesRef.current = notes; });

  // Debounce timer for save-status indicator
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushNote = useCallback(async (id: string) => {
    const note = notesRef.current.find((item) => item.id === id);
    if (!note) throw new Error('Source note is no longer available');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    notesSyncService.queueUpsert(noteToPayload(note));
    await notesSyncService.flushForSignOut();
  }, []);

  useEffect(() => onSourceSave(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await notesSyncService.flushForSignOut();
  }), []);

  useEffect(() => onPreLogout(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    persistLocal(notesRef.current);
    await notesSyncService.flushForSignOut();
  }), []);

  // ── Initial load ────────────────────────────────────────────────────────────
  useEffect(() => {
    const local = loadLocalNotes();
    notesSyncService.restorePending();
    notesRef.current = local;
    setNotes(local);
    setActiveNoteId(local[0]?.id ?? null);
    const shared = getActiveTaskStorageId()?.includes(':workspace:');
    if (!shared) setIsLoading(false);

    // Background: push any local notes the server doesn't know about yet.
    // We do this by queuing every local note as an upsert — the server's
    // last-write-wins logic will ignore notes that are already up to date.
    for (const note of shared ? [] : local) {
      notesSyncService.queueUpsert(noteToPayload(note));
    }
    let cancelled = false;
    let generation = 0;
    const refresh = async () => {
      const request = ++generation;
      const protectedIds = notesSyncService.pendingIds();
      const versions = notesSyncService.editVersions();
      try {
        const response = await fetch(`${API_BASE_URL}/api/notes`, { credentials: 'include' });
        if (!response.ok) throw new Error('Notes unavailable');
        const payloads = await response.json() as NotePayload[];
        // A note this device cannot read is left as it is here, never replaced or dropped.
        const unreadable = new Set<string>();
        const open = (payload: NotePayload): Note | null | Promise<Note | null> => {
          const build = (json: string): Note | null => {
            try { return { ...payload, blocks: JSON.parse(json), createdAt: payload.createdAt ?? payload.updatedAt } as Note; }
            catch { unreadable.add(payload.id); return null; }
          };
          // Plain notes are read straight away, as before; only a deflated one waits for its decoding.
          return isCompressed(payload.blocksJson)
            ? decodeBlocksJson(payload.blocksJson).then(build, () => { unreadable.add(payload.id); return null; })
            : build(payload.blocksJson);
        };
        const opened = payloads.map(open);
        const remote = (opened.some((item) => item instanceof Promise) ? await Promise.all(opened) : opened as Array<Note | null>)
          .filter((note): note is Note => note !== null);
        if (cancelled || request !== generation) return;
        setNotes((current) => {
          const latestVersions = notesSyncService.editVersions();
          const keep = (id: string) => unreadable.has(id) || protectedIds.has(id) || notesSyncService.hasPending(id) || versions.get(id) !== latestVersions.get(id);
          const merged = [...remote.filter((note) => !keep(note.id)), ...current.filter((note) => keep(note.id))];
          persistLocal(merged);
          notesRef.current = merged;
          return merged;
        });
        setActiveNoteId((current) => current ?? remote[0]?.id ?? null);
      } catch { /* retain the workspace-scoped offline cache */ }
      finally { if (!cancelled && request === generation) setIsLoading(false); }
    };
    void refresh();
    window.addEventListener('hitlist:workspace-data-changed', refresh);
    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      window.removeEventListener('hitlist:workspace-data-changed', refresh);
    };
  }, []);

  // ── beforeunload: flush pending sync queue ──────────────────────────────────
  useEffect(() => {
    const handleBeforeUnload = () => {
      persistLocal(notesRef.current);
      notesSyncService.flushNow();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // ── scheduleSave: update save-status indicator + queue server sync ──────────
  const scheduleSave = useCallback((note: Note) => {
    setSaveStatus('saving');
    notesSyncService.queueUpsert(noteToPayload(note));

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      // Queue the sync — SyncService handles debouncing and dedup
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus((s) => (s === 'saved' ? 'idle' : s)), 2500);
    }, 600);
  }, []);

  // ── Derived ────────────────────────────────────────────────────────────────
  const activeNote = notes.find((n) => n.id === activeNoteId) ?? null;

  const sortedNotes = [...notes].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt - a.updatedAt;
  });

  // ── CRUD ───────────────────────────────────────────────────────────────────

  const createNote = useCallback((title = 'Untitled') => {
    const newNote = createNewNote(title);
    setNotes((prev) => {
      const next = [newNote, ...prev];
      persistLocal(next);
      return next;
    });
    setActiveNoteId(newNote.id);
    setSaveStatus('saving');
    // Queue server sync immediately (no debounce for new notes)
    notesSyncService.queueUpsert(noteToPayload(newNote));
    setTimeout(() => {
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus((s) => (s === 'saved' ? 'idle' : s)), 2000);
    }, 400);
    return newNote;
  }, []);

  const deleteNote = useCallback((id: string) => {
    setNotes((prev) => {
      const next = prev.filter((n) => n.id !== id);
      persistLocal(next);
      return next;
    });
    setActiveNoteId((cur) => {
      if (cur !== id) return cur;
      const remaining = notesRef.current.filter((n) => n.id !== id);
      return remaining[0]?.id ?? null;
    });
    // Queue server delete — SyncService handles offline gracefully
    notesSyncService.queueDelete(id);
  }, []);

  const updateNoteTitle = useCallback((id: string, title: string) => {
    setNotes((prev) => {
      const next = prev.map((n) => (n.id === id ? { ...n, title, updatedAt: Date.now() } : n));
      persistLocal(next);
      const updated = next.find((n) => n.id === id);
      if (updated) scheduleSave(updated);
      return next;
    });
  }, [scheduleSave]);

  const updateNoteEmoji = useCallback((id: string, emoji: string) => {
    setNotes((prev) => {
      const next = prev.map((n) => (n.id === id ? { ...n, emoji, updatedAt: Date.now() } : n));
      persistLocal(next);
      const updated = next.find((n) => n.id === id);
      if (updated) scheduleSave(updated);
      return next;
    });
  }, [scheduleSave]);

  const togglePinNote = useCallback((id: string) => {
    setNotes((prev) => {
      const next = prev.map((n) => (n.id === id ? { ...n, pinned: !n.pinned, updatedAt: Date.now() } : n));
      persistLocal(next);
      const updated = next.find((n) => n.id === id);
      if (updated) scheduleSave(updated);
      return next;
    });
  }, [scheduleSave]);

  const updateBlock = useCallback((noteId: string, blockId: string, changes: Partial<NoteBlock>) => {
    setNotes((prev) => {
      const next = prev.map((n) =>
        n.id === noteId
          ? { ...n, updatedAt: Date.now(), blocks: n.blocks.map((b) => (b.id === blockId ? { ...b, ...changes } : b)) }
          : n
      );
      persistLocal(next);
      const updated = next.find((n) => n.id === noteId);
      if (updated) scheduleSave(updated);
      return next;
    });
  }, [scheduleSave]);

  const addBlock = useCallback(
    (noteId: string, afterBlockId: string, type: BlockType = 'paragraph') => {
      const newBlock = createEmptyBlock(type);
      setNotes((prev) => {
        const next = prev.map((n) => {
          if (n.id !== noteId) return n;
          const idx = n.blocks.findIndex((b) => b.id === afterBlockId);
          const blocks = [...n.blocks];
          // A new line sits level with the one before it (or first among its children), as in an outline.
          const level = levelForNewBlockAfter(blocks, idx);
          blocks.splice(insertIndexAfter(blocks, idx), 0, level > 0 ? { ...newBlock, indent: level } : newBlock);
          return { ...n, blocks, updatedAt: Date.now() };
        });
        persistLocal(next);
        const updated = next.find((n) => n.id === noteId);
        if (updated) scheduleSave(updated);
        return next;
      });
      return newBlock.id;
    },
    [scheduleSave]
  );

  const deleteBlock = useCallback((noteId: string, blockId: string) => {
    setNotes((prev) => {
      const next = prev.map((n) => {
        if (n.id !== noteId) return n;
        if (n.blocks.length <= 1) {
          const cleared = { ...n, updatedAt: Date.now(), blocks: [createEmptyBlock('paragraph')] };
          scheduleSave(cleared);
          return cleared;
        }
        const updated = { ...n, updatedAt: Date.now(), blocks: normalizeIndents(n.blocks.filter((b) => b.id !== blockId)) };
        scheduleSave(updated);
        return updated;
      });
      persistLocal(next);
      return next;
    });
  }, [scheduleSave]);

  const changeBlockType = useCallback((noteId: string, blockId: string, type: BlockType) => {
    setNotes((prev) => {
      const next = prev.map((n) =>
        n.id === noteId
          ? {
              ...n,
              updatedAt: Date.now(),
              blocks: n.blocks.map((b) =>
                b.id === blockId
                  ? {
                      ...b,
                      type,
                      checked: type === 'todo' ? (b.checked ?? false) : undefined,
                      collapsed: type === 'toggle' ? b.collapsed : undefined,
                      tableData: type === 'table' ? (b.tableData ?? { rows: [['', '', ''], ['', '', ''], ['', '', '']], hasHeader: true }) : undefined,
                    }
                  : b
              ),
            }
          : n
      );
      persistLocal(next);
      const updated = next.find((n) => n.id === noteId);
      if (updated) scheduleSave(updated);
      return next;
    });
  }, [scheduleSave]);

  const moveBlock = useCallback((noteId: string, blockId: string, direction: 'up' | 'down') => {
    setNotes((prev) => {
      const next = prev.map((n) => {
        if (n.id !== noteId) return n;
        const blocks = moveBlockWithChildren(n.blocks, blockId, direction);
        if (blocks === n.blocks) return n;
        return { ...n, blocks, updatedAt: Date.now() };
      });
      persistLocal(next);
      const updated = next.find((n) => n.id === noteId);
      if (updated) scheduleSave(updated);
      return next;
    });
  }, [scheduleSave]);

  /** Tab / Shift+Tab: push a line in or bring it back out one level, its children with it. */
  const setBlockIndent = useCallback((noteId: string, blockId: string, direction: 'in' | 'out') => {
    setNotes((prev) => {
      let changed = false;
      const next = prev.map((n) => {
        if (n.id !== noteId) return n;
        const blocks = direction === 'in' ? indentBlock(n.blocks, blockId) : outdentBlock(n.blocks, blockId);
        if (blocks === n.blocks) return n;
        changed = true;
        return { ...n, blocks, updatedAt: Date.now() };
      });
      if (!changed) return prev;
      persistLocal(next);
      const updated = next.find((n) => n.id === noteId);
      if (updated) scheduleSave(updated);
      return next;
    });
  }, [scheduleSave]);

  return {
    flushNote,
    notes: sortedNotes,
    activeNote,
    activeNoteId,
    setActiveNoteId,
    saveStatus,
    isLoading,
    createNote,
    deleteNote,
    updateNoteTitle,
    updateNoteEmoji,
    togglePinNote,
    updateBlock,
    addBlock,
    deleteBlock,
    changeBlockType,
    moveBlock,
    setBlockIndent,
  };
}
