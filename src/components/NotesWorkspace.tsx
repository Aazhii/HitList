import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Plus, Search, Pin, PinOff, Trash2, FileText, MoreHorizontal,
  StickyNote, Loader2, CheckCircle2, AlertCircle, WifiOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Note } from '@/types/notes';
import { NOTE_EMOJIS, formatNoteDate, getNotePreview } from '@/types/notes';
import type { BlockType } from '@/types/notes';
import { useNotes } from '@/hooks/useNotes';
import type { SaveStatus } from '@/hooks/useNotes';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import type { SyncStatus } from '@/hooks/useSyncStatus';
import { NoteEditor } from '@/components/NoteEditor';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { ViewLayout, ContextSectionHeader, contextIconButton, contextRowClass, useViewLayout } from '@/components/shell/ViewLayout';
import { TopBar, topBarPill, topBarPrimary } from '@/components/shell/TopBar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// ── Note row, for the context column ───────────────────────────────────────────
function NoteListItem({
  note,
  isActive,
  onSelect,
  onPin,
  onDelete,
}: {
  note: Note;
  isActive: boolean;
  onSelect: () => void;
  onPin: () => void;
  onDelete: () => void;
}) {
  const { closeContext } = useViewLayout();
  const preview = getNotePreview(note);

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => { onSelect(); closeContext(); }}
        aria-current={isActive ? 'true' : undefined}
        // The preview is still what search matches on; here it is the tooltip.
        title={preview ? `${note.title || 'Untitled'} — ${preview}` : undefined}
        className={cn(contextRowClass(isActive), 'pr-9')}
      >
        <span className="flex-shrink-0 text-[15px] leading-none" aria-hidden>{note.emoji ?? '📝'}</span>
        <span className={cn('min-w-0 flex-1 truncate text-[14.5px]', isActive ? 'font-semibold text-a-ink' : 'text-a-muted')}>
          {note.title || 'Untitled'}
        </span>
      </button>

      {/* A sibling of the row button, so there are no nested interactive elements. */}
      <div className="absolute top-1/2 right-2 -translate-y-1/2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 has-[[data-state=open]]:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={contextIconButton} aria-label={`Options for ${note.title || 'Untitled'}`}>
              <MoreHorizontal className="size-3.5" strokeWidth={2.75} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={onPin}>
              {note.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
              {note.pinned ? 'Unpin' : 'Pin note'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="size-3.5" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

// ── Empty state (no notes at all) ──────────────────────────────────────────────
function NotesEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-20 text-center animate-fade-in">
      <div className="mb-6 flex size-20 items-center justify-center rounded-[24px] bg-a-accent-tint">
        <StickyNote className="size-9 text-a-accent-700" strokeWidth={2.25} />
      </div>
      <h3 className="mb-2 font-display text-[26px] text-a-ink">No notes yet</h3>
      <p className="mb-8 max-w-xs text-[14.5px] leading-relaxed text-a-muted">
        Capture ideas, meeting notes, or anything on your mind. Notes live alongside your tasks.
      </p>
      <Button onClick={onCreate} className="h-9 gap-2 rounded-full px-4">
        <Plus className="size-4" />
        New note
      </Button>
    </div>
  );
}

// ── Empty state (notes exist, none selected) ───────────────────────────────────
function SelectNotePrompt({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-20 text-center animate-fade-in">
      <div className="mb-5 flex size-16 items-center justify-center rounded-[20px] bg-a-surface">
        <FileText className="size-7 text-a-faint" strokeWidth={2.25} />
      </div>
      <h3 className="mb-1.5 font-display text-[22px] text-a-ink">Select a note</h3>
      <p className="mb-6 max-w-xs text-[14.5px] leading-relaxed text-a-muted">
        Choose a note from the list, or create a new one.
      </p>
      <Button onClick={onCreate} variant="outline" className="h-8 gap-2 rounded-full px-3 text-xs">
        <Plus className="size-3.5" />
        New note
      </Button>
    </div>
  );
}

// ── Emoji picker ───────────────────────────────────────────────────────────────
function EmojiPicker({ emoji, onSelect }: { emoji: string; onSelect: (emoji: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="mb-[14px] block cursor-pointer text-[46px] leading-none transition-transform duration-150 hover:scale-105"
          aria-label="Change note emoji"
        >
          {emoji}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <div className="grid grid-cols-6 gap-1 p-1">
          {NOTE_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => onSelect(e)}
              className="rounded-lg p-1.5 text-center text-xl transition-colors duration-100 hover:bg-accent"
            >
              {e}
            </button>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Note detail view ───────────────────────────────────────────────────────────
function NoteDetail({
  note,
  onUpdateTitle,
  onUpdateEmoji,
  onUpdateBlock,
  onAddBlock,
  onDeleteBlock,
  onChangeBlockType,
  onMoveBlock,
}: {
  note: Note;
  onUpdateTitle: (id: string, title: string) => void;
  onUpdateEmoji: (id: string, emoji: string) => void;
  onUpdateBlock: (noteId: string, blockId: string, changes: Partial<import('@/types/notes').NoteBlock>) => void;
  onAddBlock: (noteId: string, afterBlockId: string, type?: BlockType) => string;
  onDeleteBlock: (noteId: string, blockId: string) => void;
  onChangeBlockType: (noteId: string, blockId: string, type: BlockType) => void;
  onMoveBlock: (noteId: string, blockId: string, direction: 'up' | 'down') => void;
}) {
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const firstBlockRef = useRef<string | null>(null);

  // Auto-resize title textarea
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [note.title]);

  // Track first block id for Enter-from-title focus
  useEffect(() => {
    firstBlockRef.current = note.blocks[0]?.id ?? null;
  });

  return (
    // The one scroller for the note pane. The header lives inside it, so the
    // title scrolls away with the content rather than pinning above it.
    <ScrollArea className="h-full">
      <div className="animate-fade-in px-4 pb-24 pt-[46px] md:px-8">
        {/* One reading column: a 720px measure plus the 44px margin that block
            controls hang into. The padding is applied once, here, so the title,
            metadata, every block, tables and panels share one left edge. */}
        <div className="mx-auto w-full max-w-[calc(var(--a-measure)+var(--a-gutter))] md:pl-[var(--a-gutter)]">
          <div>
            <EmojiPicker
              emoji={note.emoji ?? '📝'}
              onSelect={(e) => onUpdateEmoji(note.id, e)}
            />

            <textarea
              ref={titleRef}
              value={note.title}
              onChange={(e) => onUpdateTitle(note.id, e.target.value)}
              placeholder="Untitled"
              rows={1}
              className={cn(
                'w-full resize-none border-none bg-transparent p-0 outline-none field-sizing-content',
                'font-display text-[42px] leading-[1.08] tracking-[-0.015em] text-a-ink',
                'placeholder:text-a-faint/40',
              )}
              aria-label="Note title"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  // Focus first block
                  if (firstBlockRef.current) {
                    const el = document.querySelector<HTMLTextAreaElement>(
                      `[aria-label^="Block 1:"]`
                    );
                    el?.focus();
                  }
                }
              }}
            />

            <p className="mt-[14px] flex items-center gap-2 text-[13.5px] text-a-faint">
              <span>Edited {formatNoteDate(note.updatedAt)}</span>
              <span aria-hidden>·</span>
              <span>{note.blocks.length} block{note.blocks.length !== 1 ? 's' : ''}</span>
            </p>

            <div className="mt-[22px] mb-2 h-px bg-a-line" />

            {/* Keyboard hints — restyled, not removed: this is where "/" is taught
                now that the per-row "/cmd" badge is gone. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-3 text-[12px] text-a-faint">
              {([['/', 'commands'], ['↵', 'new block'], ['Tab', 'table cells']] as const).map(([key, label]) => (
                <span key={key} className="flex items-center gap-1.5">
                  <kbd className="rounded-[5px] bg-a-surface px-1.5 font-mono text-[11px] text-a-muted">{key}</kbd>
                  {label}
                </span>
              ))}
            </div>
          </div>

          <NoteEditor
            blocks={note.blocks}
            onUpdateBlock={(blockId, changes) => onUpdateBlock(note.id, blockId, changes)}
            onAddBlock={(afterBlockId, type) => onAddBlock(note.id, afterBlockId, type)}
            onDeleteBlock={(blockId) => onDeleteBlock(note.id, blockId)}
            onChangeBlockType={(blockId, type) => onChangeBlockType(note.id, blockId, type)}
            onMoveBlock={(blockId, direction) => onMoveBlock(note.id, blockId, direction)}
          />
        </div>
      </div>
    </ScrollArea>
  );
}

// ── Sync status indicator ──────────────────────────────────────────────────────
// Six distinct states from SaveStatus × SyncStatus. They are deliberately not
// collapsed into a single dot.
function SyncIndicator({ saveStatus, syncStatus }: { saveStatus: SaveStatus; syncStatus: SyncStatus }) {
  const isSaving  = saveStatus === 'saving';
  const isSyncing = syncStatus === 'syncing';
  const isOffline = syncStatus === 'offline';
  const isError   = syncStatus === 'error' || saveStatus === 'error';
  const serverOk  = syncStatus === 'synced';
  const isSaved   = saveStatus === 'saved';
  const isIdle    = saveStatus === 'idle' && serverOk;

  const label = isSaving  ? 'Saving…'
    : isSyncing           ? 'Syncing…'
    : isOffline           ? 'Offline'
    : isError             ? 'Sync error'
    : isSaved && isOffline ? 'Saved locally'
    : isSaved             ? 'Synced'
    : '';

  const ariaLabel = isSaving  ? 'Saving note…'
    : isSyncing             ? 'Syncing to server…'
    : isOffline             ? 'Working offline — changes saved locally'
    : isError               ? 'Sync failed — changes saved locally'
    : isSaved               ? 'Synced to server'
    : undefined;

  const showSpinner  = isSaving || isSyncing;
  const showCheck    = isSaved && !isOffline && !isError;
  const showWifi     = isOffline;
  const showAlert    = isError && !isOffline;

  return (
    <span
      className={cn(
        'flex select-none items-center gap-1.5 text-[13px] font-medium transition-opacity duration-300 ease-in-out',
        isIdle                    && 'pointer-events-none opacity-0',
        (isSaving || isSyncing)   && 'text-a-faint',
        isSaved && !isOffline     && 'text-a-sage-ink',
        isOffline                 && 'text-q-delegate',
        isError && !isOffline     && 'text-q-do',
      )}
      aria-live="polite"
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      {showSpinner && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      {showCheck   && <CheckCircle2 className="size-3.5" aria-hidden />}
      {showWifi    && <WifiOff className="size-3.5" aria-hidden />}
      {showAlert   && <AlertCircle className="size-3.5" aria-hidden />}
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

// Wrapper that subscribes to live sync status
function SyncIndicatorWrapper({ saveStatus }: { saveStatus: SaveStatus }) {
  const syncStatus = useSyncStatus();
  return <SyncIndicator saveStatus={saveStatus} syncStatus={syncStatus} />;
}

// ── Loading skeleton ───────────────────────────────────────────────────────────
function NotesLoadingSkeleton() {
  return (
    <ViewLayout
      contextLabel="Notes"
      context={
        <div className="space-y-1.5 px-1 pt-1" aria-hidden>
          <Skeleton className="mb-3 h-9 w-full rounded-full bg-a-bg" />
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-9 w-full rounded-full bg-a-bg/70" />
          ))}
        </div>
      }
      topBar={<TopBar title="Notes" />}
    >
      <div className="mx-auto w-full max-w-[720px] space-y-5 px-4 pt-[46px] md:px-8" aria-hidden>
        <Skeleton className="size-12 rounded-[14px]" />
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-3.5 w-44" />
        <div className="mt-4 space-y-2.5">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className={cn('h-4', i % 3 === 0 ? 'w-3/4' : 'w-full')} />
          ))}
        </div>
      </div>
    </ViewLayout>
  );
}

// ── Main NotesWorkspace ────────────────────────────────────────────────────────
export function NotesWorkspace() {
  const {
    notes,
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
  } = useNotes();

  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Note | null>(null);

  const filtered = search.trim()
    ? notes.filter(
        (n) =>
          n.title.toLowerCase().includes(search.toLowerCase()) ||
          getNotePreview(n).toLowerCase().includes(search.toLowerCase())
      )
    : notes;

  const pinned = filtered.filter((n) => n.pinned);
  const unpinned = filtered.filter((n) => !n.pinned);

  const handleCreate = useCallback(() => {
    createNote('Untitled');
  }, [createNote]);

  const handleDeleteConfirm = useCallback(() => {
    if (deleteTarget) {
      deleteNote(deleteTarget.id);
      setDeleteTarget(null);
    }
  }, [deleteTarget, deleteNote]);

  if (isLoading) return <NotesLoadingSkeleton />;

  const renderRow = (note: Note) => (
    <NoteListItem
      key={note.id}
      note={note}
      isActive={note.id === activeNoteId}
      onSelect={() => setActiveNoteId(note.id)}
      onPin={() => togglePinNote(note.id)}
      onDelete={() => setDeleteTarget(note)}
    />
  );

  const notesList = (
    <>
      <ContextSectionHeader
        label="Notes"
        action={
          <button type="button" onClick={handleCreate} className={contextIconButton} aria-label="New note" title="New note">
            <Plus className="size-3.5" strokeWidth={2.75} />
          </button>
        }
      />

      <div className="relative mb-3 px-1">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-a-faint" strokeWidth={2.5} aria-hidden />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search notes"
          aria-label="Search notes"
          className={cn(
            'h-9 w-full rounded-full bg-a-bg pr-3 pl-8 text-[13.5px] text-a-ink outline-none',
            'shadow-[inset_0_0_0_1px_var(--a-line)] placeholder:text-a-faint',
            'focus-visible:shadow-[inset_0_0_0_1.5px_var(--a-accent)]',
          )}
        />
      </div>

      {notes.length === 0 && (
        <div className="px-3 py-8 text-center">
          <StickyNote className="mx-auto mb-2 size-6 text-a-faint/60" strokeWidth={2.25} aria-hidden />
          <p className="mb-2 text-[13px] text-a-faint">No notes yet</p>
          <button type="button" onClick={handleCreate} className="text-[13px] font-medium text-a-accent-700 hover:underline">
            Create your first note
          </button>
        </div>
      )}

      {pinned.length > 0 && (
        <>
          <p className="px-3 pt-1 pb-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-a-faint">Pinned</p>
          <ul className="space-y-0.5">{pinned.map(renderRow)}</ul>
        </>
      )}

      {unpinned.length > 0 && (
        <>
          {pinned.length > 0 && (
            <p className="px-3 pt-3 pb-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-a-faint">All notes</p>
          )}
          <ul className="space-y-0.5">{unpinned.map(renderRow)}</ul>
        </>
      )}

      {search && filtered.length === 0 && (
        <div className="px-3 py-6 text-center">
          <p className="text-[13px] text-a-faint">No notes match "{search}"</p>
          <button type="button" onClick={() => setSearch('')} className="mt-1.5 text-[13px] font-medium text-a-accent-700 hover:underline">
            Clear search
          </button>
        </div>
      )}
    </>
  );

  const topBar = (
    <TopBar
      title="Notes"
      subtitle={`${notes.length} note${notes.length !== 1 ? 's' : ''}`}
      actions={
        <>
          {activeNote && <SyncIndicatorWrapper saveStatus={saveStatus} />}

          {/* Pin and delete for the open note, in the one quiet pill. */}
          {activeNote && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={topBarPill} aria-label="Note options">
                  <MoreHorizontal className="size-4" strokeWidth={2.75} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={() => togglePinNote(activeNote.id)}>
                  {activeNote.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                  {activeNote.pinned ? 'Unpin note' : 'Pin note'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(activeNote)}>
                  <Trash2 className="size-3.5" /> Delete note
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {(activeNote || notes.length > 0) && (
            <button type="button" onClick={handleCreate} className={topBarPrimary} aria-label="New note">
              <Plus className="size-[15px]" strokeWidth={2.75} aria-hidden />
              <span className="hidden sm:inline">New note</span>
            </button>
          )}
        </>
      }
    />
  );

  return (
    <>
      <ViewLayout
        contextLabel="Notes"
        context={notesList}
        topBar={topBar}
        // The note pane scrolls itself, inside NoteDetail.
        scrollMain={false}
        // The old workspace let the notes list be hidden for a wider editor.
        collapsible
      >
        {activeNote ? (
          <NoteDetail
            note={activeNote}
            onUpdateTitle={updateNoteTitle}
            onUpdateEmoji={updateNoteEmoji}
            onUpdateBlock={updateBlock}
            onAddBlock={addBlock}
            onDeleteBlock={deleteBlock}
            onChangeBlockType={changeBlockType}
            onMoveBlock={moveBlock}
          />
        ) : notes.length === 0 ? (
          <NotesEmptyState onCreate={handleCreate} />
        ) : (
          <SelectNotePrompt onCreate={handleCreate} />
        )}
      </ViewLayout>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete note?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.title || 'Untitled'}" will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-a-bg hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
