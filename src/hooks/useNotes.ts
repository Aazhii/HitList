/**
 * useNotes — notes state management with localStorage + background server sync.
 *
 * localStorage is ALWAYS the source of truth for reads.
 * notesSyncService handles all server communication asynchronously.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import type { Note, NoteBlock, BlockType } from '@/types/notes';
import { createNewNote, createEmptyBlock } from '@/types/notes';
import { getActiveUserId } from '@/lib/storage';
import { claimLegacyNotes, notesStorageKey } from '@/lib/notesStorage';
import { notesSyncService } from '@/services/notesSyncService';
import type { NotePayload } from '@/services/notesSyncService';

// ── Helpers ───────────────────────────────────────────────────────────────────

function persistLocal(notes: Note[]) {
  try {
    localStorage.setItem(notesStorageKey(getActiveUserId()), JSON.stringify(notes));
  } catch { /* quota exceeded — ignore */ }
}

function loadLocalNotes(): Note[] {
  try {
    // One-time move from the old key every account shared; see lib/notesStorage.
    claimLegacyNotes(localStorage, getActiveUserId());
    const raw = localStorage.getItem(notesStorageKey(getActiveUserId()));
    if (!raw) return [];
    return JSON.parse(raw) as Note[];
  } catch {
    return [];
  }
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

  // ── Initial load ────────────────────────────────────────────────────────────
  useEffect(() => {
    const local = loadLocalNotes();
    setNotes(local);
    setActiveNoteId(local[0]?.id ?? null);
    setIsLoading(false);

    // Background: push any local notes the server doesn't know about yet.
    // We do this by queuing every local note as an upsert — the server's
    // last-write-wins logic will ignore notes that are already up to date.
    for (const note of local) {
      notesSyncService.queueUpsert(noteToPayload(note));
    }
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

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      // Queue the sync — SyncService handles debouncing and dedup
      notesSyncService.queueUpsert(noteToPayload(note));
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
          blocks.splice(idx + 1, 0, newBlock);
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
        const updated = { ...n, updatedAt: Date.now(), blocks: n.blocks.filter((b) => b.id !== blockId) };
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
        const idx = n.blocks.findIndex((b) => b.id === blockId);
        if (idx === -1) return n;
        const newIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (newIdx < 0 || newIdx >= n.blocks.length) return n;
        const blocks = [...n.blocks];
        [blocks[idx], blocks[newIdx]] = [blocks[newIdx], blocks[idx]];
        return { ...n, blocks, updatedAt: Date.now() };
      });
      persistLocal(next);
      const updated = next.find((n) => n.id === noteId);
      if (updated) scheduleSave(updated);
      return next;
    });
  }, [scheduleSave]);

  return {
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
  };
}
