import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import {
  Plus, Pin, PinOff, Trash2, FileText, MoreHorizontal,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Note } from '@/types/notes';
import { NOTE_EMOJIS, NOTE_SYNC_LIMIT, NOTE_SYNC_WARN, formatNoteEdited, getNotePreview } from '@/types/notes';
import type { BlockType } from '@/types/notes';
import { useNotes } from '@/hooks/useNotes';
import type { SaveStatus } from '@/hooks/useNotes';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import type { SyncStatus } from '@/hooks/useSyncStatus';
import { NoteEditor, type NoteTaskLinking } from '@/components/NoteEditor';
import { noteTaskRollup, rollupLabel } from '@/lib/noteTaskRollup';
import { EmptyState, ILL } from '@/components/EmptyState';
import { RowMenuContent, RowMenuItem } from '@/components/shell/RowMenu';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { ViewLayoutContext, ContextSectionHeader, contextIconButton, contextRowClass, useViewLayout } from '@/components/shell/ViewLayout';
import { BTN_MD, TopBar, topBarPill, topBarPrimary } from '@/components/shell/TopBar';
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
        <span className="flex-shrink-0 text-[14px] leading-none" aria-hidden>{note.emoji ?? '📝'}</span>
        <span className={cn('min-w-0 flex-1 truncate text-[14px]', isActive ? 'font-semibold text-a-ink' : 'text-a-muted')}>
          {note.title || 'Untitled'}
        </span>
      </button>

      {/* A sibling of the row button, so there are no nested interactive elements. */}
      <div className="absolute top-1/2 right-2 -translate-y-1/2 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 group-focus-within:opacity-100 has-[[data-state=open]]:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={contextIconButton} aria-label={`Options for ${note.title || 'Untitled'}`}>
              <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
            </button>
          </DropdownMenuTrigger>
          <RowMenuContent
            caption="Page"
            footer={<>Last edited by You<br />{new Date(note.updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</>}
          >
            <RowMenuItem icon={note.pinned ? PinOff : Pin} label={note.pinned ? 'Unpin' : 'Pin note'} onSelect={onPin} />
            <DropdownMenuSeparator />
            <RowMenuItem icon={Trash2} label="Delete" onSelect={onDelete} destructive />
          </RowMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

// ── Empty state (no notes at all) ──────────────────────────────────────────────
function NotesEmptyState({ onCreate }: { onCreate: () => void }) {
  // Showcase 304–309: the DS EmptyState (template.png), then a primary "New note".
  return (
    <div className="pt-4">
    <EmptyState
      image={ILL.template}
      title="No notes yet"
      description="Capture ideas, meeting notes, or anything on your mind. Notes live alongside your tasks — type @ on a line to send it to a quadrant."
      action={
        <button type="button" onClick={onCreate} className={cn(topBarPrimary, BTN_MD)}>
          <Plus className="size-[15px]" strokeWidth={1.75} aria-hidden />
          New note
        </button>
      }
    />
    </div>
  );
}

// ── Empty state (notes exist, none selected) ───────────────────────────────────
function SelectNotePrompt({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-20 text-center animate-fade-in">
      <div className="mb-5 flex size-16 items-center justify-center rounded-[12px] bg-a-surface">
        <FileText className="size-7 text-a-faint" strokeWidth={1.75} />
      </div>
      <h3 className="mb-1.5 font-display text-[20px] text-a-ink">Select a note</h3>
      <p className="mb-6 max-w-xs text-[14px] leading-relaxed text-a-muted">
        Choose a note from the list, or create a new one.
      </p>
      <Button onClick={onCreate} variant="outline" className="h-8 gap-2 rounded-[6px] px-3 text-xs">
        <Plus className="size-3.5" />
        New note
      </Button>
    </div>
  );
}

// ── Emoji picker ───────────────────────────────────────────────────────────────
function EmojiPicker({ emoji, onSelect }: { emoji: string; onSelect: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          // Showcase 312: a 56px white tile, 12px radius, 1px border. The prototype's emoji is 30px,
          // between the scale's 24 and 32.
          className="mb-4 grid size-14 cursor-pointer place-items-center rounded-[12px] border border-a-line bg-a-surface text-[32px] leading-none transition-colors duration-[120ms] hover:bg-a-line-soft"
          aria-label={emoji ? 'Change note emoji' : 'Add note emoji'}
          title={emoji ? 'Change note emoji' : 'Add note emoji'}
          onKeyDown={(event) => {
            if (emoji && (event.key === 'Backspace' || event.key === 'Delete')
              && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
              && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onSelect('');
              setOpen(false);
            }
          }}
        >
          {emoji || <Plus className="size-5 text-a-faint" aria-hidden />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <div className="grid grid-cols-6 gap-1 p-1">
          {NOTE_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => { onSelect(e); setOpen(false); }}
              className="rounded-lg p-1.5 text-center text-xl transition-colors duration-[120ms] hover:bg-accent"
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
export function NoteDetail({
  note,
  onUpdateTitle,
  onUpdateEmoji,
  onUpdateBlock,
  onAddBlock,
  onDeleteBlock,
  onChangeBlockType,
  onMoveBlock,
  linking,
}: {
  note: Note;
  linking?: NoteTaskLinking;
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

  // Exactly what is sent to the server (useNotes.noteToPayload), so the count
  // shown is the count the 10,000-character limit applies to.
  const syncSize = JSON.stringify(note.blocks).length;
  // Read live from the tasks when they are available, so a note says how its tasks are getting on.
  const rollup = linking ? noteTaskRollup(note.blocks, linking.todos) : { total: note.blocks.filter((b) => b.taskId).length, done: 0 };
  const rollupText = rollupLabel(rollup);

  // Track first block id for Enter-from-title focus
  useEffect(() => {
    firstBlockRef.current = note.blocks[0]?.id ?? null;
  });

  return (
    // The one scroller for the note pane. The header lives inside it, so the
    // title scrolls away with the content rather than pinning above it.
    <ScrollArea className="h-full">
      <div className="animate-fade-in px-4 pb-24 pt-8 md:px-8">
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
                // Showcase 313: 34px/1.15, 700, -0.02em; 32 here, the top of the type scale.
                'block text-[34px] leading-[1.22] font-bold tracking-[-0.02em] text-a-ink',
                'placeholder:text-a-line-strong',
              )}
              aria-label="Note title"
              onKeyDown={(e) => {
                if (e.key === 'Backspace' && note.emoji !== ''
                  && e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0
                  && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey
                  && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  onUpdateEmoji(note.id, '');
                  return;
                }
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

            <p className="mt-[10px] mb-7 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-a-faint">
              <span>Edited {formatNoteEdited(note.updatedAt)}</span>
              <span aria-hidden>·</span>
              <span>{`${note.blocks.length} block${note.blocks.length !== 1 ? 's' : ''}`}</span>
              {rollupText && (
                <>
                  <span aria-hidden>·</span>
                  <span className={rollup.total > 0 && rollup.done === rollup.total ? 'text-a-green-ink' : undefined}>{rollupText}</span>
                </>
              )}
              {syncSize > NOTE_SYNC_WARN && (
                <>
                  <span aria-hidden>·</span>
                  <span
                    role={syncSize > NOTE_SYNC_LIMIT ? 'alert' : undefined}
                    className={syncSize > NOTE_SYNC_LIMIT ? 'font-semibold text-q-do' : 'text-q-delegate'}
                  >
                    {syncSize > NOTE_SYNC_LIMIT
                      ? `Too long to sync: ${syncSize.toLocaleString()} of ${NOTE_SYNC_LIMIT.toLocaleString()} characters. Shorten it or move part into another note.`
                      : `${syncSize.toLocaleString()} of ${NOTE_SYNC_LIMIT.toLocaleString()} characters`}
                  </span>
                </>
              )}
            </p>
          </div>

          <NoteEditor
            blocks={note.blocks}
            onUpdateBlock={(blockId, changes) => onUpdateBlock(note.id, blockId, changes)}
            onAddBlock={(afterBlockId, type) => onAddBlock(note.id, afterBlockId, type)}
            onDeleteBlock={(blockId) => onDeleteBlock(note.id, blockId)}
            onChangeBlockType={(blockId, type) => onChangeBlockType(note.id, blockId, type)}
            onMoveBlock={(blockId, direction) => onMoveBlock(note.id, blockId, direction)}
            noteId={note.id}
            linking={linking}
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
    : 'Saved';

  const ariaLabel = isSaving  ? 'Saving note…'
    : isSyncing             ? 'Syncing to server…'
    : isOffline             ? 'Working offline — changes saved locally'
    : isError               ? 'Sync failed — changes saved locally'
    : isSaved || isIdle     ? 'Synced to server'
    : undefined;

  const showSpinner  = isSaving || isSyncing;

  // The DS Badge (showcase 111): a tint, its ink, and a dot in the ink; a spinner while working.
  return (
    <span
      className={cn(
        // design-check-ignore: pill — the DS Badge is a pill.
        'flex flex-shrink-0 select-none items-center gap-1 rounded-full border border-transparent px-2 py-[3px] text-[11px] font-semibold leading-none',
        showSpinner              ? 'bg-a-line-soft text-a-faint'
          : isOffline            ? 'bg-a-amber-tint text-a-amber'
          : isError              ? 'bg-a-red-tint text-a-red-ink'
          : 'bg-a-green-tint text-a-green-ink',
      )}
      aria-live="polite"
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      {showSpinner ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <span className="size-[6px] rounded-full bg-current" aria-hidden />}
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
function NotesLoadingSkeleton({ onSidebarContentChange }: { onSidebarContentChange?: (context: ReactNode) => void }) {
  useEffect(() => {
    onSidebarContentChange?.(
      <div className="space-y-1.5 px-1 pt-1" aria-hidden>
        <Skeleton className="mb-3 h-9 w-full rounded-[4px] bg-a-bg" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-9 w-full rounded-[4px] bg-a-bg/70" />
        ))}
      </div>,
    );
    return () => onSidebarContentChange?.(null);
  }, [onSidebarContentChange]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <TopBar title="Notes" />
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto w-full max-w-[720px] space-y-5 px-4 pt-[46px] md:px-8" aria-hidden>
          <Skeleton className="size-12 rounded-[8px]" />
          <Skeleton className="h-10 w-80" />
          <Skeleton className="h-3.5 w-44" />
          <div className="mt-4 space-y-2.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className={cn('h-4', i % 3 === 0 ? 'w-3/4' : 'w-full')} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main NotesWorkspace ────────────────────────────────────────────────────────
interface NotesWorkspaceProps {
  /** Tasks access for the "@ → Add to quadrant" menu. */
  linking?: NoteTaskLinking;
  /** A note to open, e.g. from a task's "Note" chip. Cleared through onOpenNoteHandled. */
  openNoteId?: string | null;
  onOpenNoteHandled?: () => void;
  /** Reports which note is on screen, so Back/refresh can return to it. */
  onActiveNoteChange?: (noteId: string | null) => void;
  /** The sidebar (rendered by App) now owns the notes list — reports it up
   * instead of rendering its own context column. */
  onSidebarContentChange?: (context: ReactNode) => void;
  /** Opens the app-level sidebar's mobile sheet. */
  onOpenSidebar?: () => void;
  /** The nav row's count badge — how many notes exist. */
  onCountChange?: (count: number) => void;
  /** Make a new note as soon as this opens (the library's New page → Note). */
  createOnOpen?: boolean;
  onCreateHandled?: () => void;
}

export function NotesWorkspace({ linking, openNoteId, onOpenNoteHandled, onActiveNoteChange, onSidebarContentChange, onOpenSidebar, onCountChange, createOnOpen, onCreateHandled }: NotesWorkspaceProps = {}) {
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

  // Opened from a task. Notes are stored per device and never pulled from the
  // server, so a note written elsewhere may simply not be here.
  useEffect(() => {
    if (!openNoteId || isLoading) return;
    if (notes.some((n) => n.id === openNoteId)) {
      setActiveNoteId(openNoteId);
      setSearch('');
    } else {
      toast.error("That note isn't on this device", {
        description: 'Notes are kept on the device they were written on.',
        duration: 3500,
      });
    }
    onOpenNoteHandled?.();
  }, [openNoteId, isLoading, notes, setActiveNoteId, onOpenNoteHandled]);

  useEffect(() => { onActiveNoteChange?.(activeNoteId ?? null); }, [activeNoteId, onActiveNoteChange]);

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

  useEffect(() => {
    if (!createOnOpen || isLoading) return;
    handleCreate();
    onCreateHandled?.();
  }, [createOnOpen, isLoading, handleCreate, onCreateHandled]);

  const handleDeleteConfirm = useCallback(() => {
    if (deleteTarget) {
      deleteNote(deleteTarget.id);
      setDeleteTarget(null);
    }
  }, [deleteTarget, deleteNote]);

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
      {pinned.length > 0 && (
        <>
          <ContextSectionHeader label="Pinned" />
          <ul>{pinned.map(renderRow)}</ul>
        </>
      )}

      <ContextSectionHeader
        label="Notes"
        action={
          <button type="button" onClick={handleCreate} className={contextIconButton} aria-label="New note" title="New note">
            <Plus className="size-3.5" strokeWidth={1.75} />
          </button>
        }
      />

      {notes.length === 0 && <p className="px-2.5 py-1 text-[12px] text-a-faint">No notes yet.</p>}

      {unpinned.length > 0 && (
        <>
          <ul>{unpinned.map(renderRow)}</ul>
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

  // The sidebar (rendered by App) now owns the notes list — report it up
  // instead of rendering our own context column. Depends on a primitive
  // signature, not `notes`/`notesList` themselves: useNotes() re-sorts into a
  // fresh array every render, and a fresh element every render, so depending
  // on either object reference would re-run this effect every render and
  // loop (setState in the effect triggers the next render).
  const notesSignature = notes.map((n) => `${n.id}:${n.title}:${n.pinned}`).join('|');
  useEffect(() => {
    if (isLoading) return;
    onSidebarContentChange?.(notesList);
    return () => onSidebarContentChange?.(null);
     
  }, [isLoading, notesSignature, search, activeNoteId]);

  useEffect(() => {
    if (isLoading) return;
    onCountChange?.(notes.length);
     
  }, [isLoading, notes.length]);

  if (isLoading) return <NotesLoadingSkeleton onSidebarContentChange={onSidebarContentChange} />;

  const topBar = (
    <TopBar
      title="Notes"
      subtitle={`${notes.length} note${notes.length !== 1 ? 's' : ''}`}
      actions={
        <>
          {(activeNote || notes.length > 0) && <SyncIndicatorWrapper saveStatus={saveStatus} />}

          {/* Pin and delete for the open note, in the one quiet pill. */}
          {activeNote && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={topBarPill} aria-label="Note options">
                  <MoreHorizontal className="size-4" strokeWidth={1.75} />
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

            <button type="button" onClick={handleCreate} className={topBarPrimary} aria-label="New note">
              <Plus className="size-[15px]" strokeWidth={1.75} aria-hidden />
              <span className="hidden sm:inline">New</span>
            </button>
        </>
      }
    />
  );

  return (
    <>
      <ViewLayoutContext.Provider value={{
        openContext: () => onOpenSidebar?.(),
        closeContext: () => {},
        toggleCollapsed: () => {},
        collapsible: false,
        collapsed: false,
      }}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {topBar}
        {/* The note pane scrolls itself, inside NoteDetail — no overflow wrapper here. */}
        <div className="min-h-0 flex-1 overflow-hidden">
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
            linking={linking}
          />
        ) : notes.length === 0 ? (
          <NotesEmptyState onCreate={handleCreate} />
        ) : (
          <SelectNotePrompt onCreate={handleCreate} />
        )}
        </div>
      </div>
      </ViewLayoutContext.Provider>

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
              className="bg-destructive text-a-surface hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
