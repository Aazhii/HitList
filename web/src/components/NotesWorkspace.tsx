import { Fragment, useState, useCallback, useMemo, useRef, useEffect, type ReactNode } from 'react';
import {
  Plus, Pin, PinOff, Trash2, FileText, MoreHorizontal, FilePlus, FolderInput, ChevronRight, ChevronDown,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Note, NoteBlock } from '@/types/notes';
import { useSyncedSize } from '@/hooks/useSyncedSize';
import { NOTE_EMOJIS, NOTE_SYNC_LIMIT, NOTE_SYNC_WARN, formatNoteEdited, getNotePreview } from '@/types/notes';
import type { BlockType } from '@/types/notes';
import { useNotes } from '@/hooks/useNotes';
import type { CodeFilesApi } from '@/components/notes/codeContext';
import { fileSettings, isNotepadFile, newFileParts } from '@/lib/notepad';
import type { PagesApi } from '@/components/notes/codeContext';
import { ancestorsOf, descendantsOf, movePage, parentMap, treeRows, withPage, withoutPages } from '@/lib/notePages';
import { backlinks } from '@/lib/noteLinks';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { ShareSourceControl } from '@/components/shell/ShareSourceControl';
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
  depth = 0,
  hasChildren = false,
  expanded = false,
  onToggle,
  onAddChild,
}: {
  note: Note;
  isActive: boolean;
  onSelect: () => void;
  onPin: () => void;
  onDelete: () => void;
  /** In the page tree: how deep, whether it holds sub-pages, whether they are shown, and the actions on them. */
  depth?: number;
  hasChildren?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onAddChild?: () => void;
}) {
  const { closeContext } = useViewLayout();
  const preview = getNotePreview(note);

  return (
    <li className="group relative" style={depth > 0 ? { paddingLeft: depth * 14 } : undefined}>
      {onToggle && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={hasChildren ? expanded : undefined}
          aria-label={hasChildren ? (expanded ? `Collapse ${note.title || 'Untitled'}` : `Expand ${note.title || 'Untitled'}`) : undefined}
          tabIndex={hasChildren ? 0 : -1}
          className={cn(
            'absolute top-1/2 z-10 grid size-5 -translate-y-1/2 place-items-center rounded-[4px] text-a-faint hover:bg-a-row-hover hover:text-a-ink',
            !hasChildren && 'pointer-events-none opacity-0',
          )}
          style={{ left: 2 + depth * 14 }}
        >
          {expanded ? <ChevronDown className="size-3.5" strokeWidth={1.75} /> : <ChevronRight className="size-3.5" strokeWidth={1.75} />}
        </button>
      )}
      <button
        type="button"
        onClick={() => { onSelect(); closeContext(); }}
        aria-current={isActive ? 'true' : undefined}
        // The preview is still what search matches on; here it is the tooltip.
        title={preview ? `${note.title || 'Untitled'} — ${preview}` : undefined}
        className={cn(contextRowClass(isActive), 'pr-14', onToggle && 'pl-7')}
      >
        <span className="flex-shrink-0 text-[14px] leading-none" aria-hidden>{note.emoji ?? '📝'}</span>
        <span className={cn('min-w-0 flex-1 truncate text-[14px]', isActive ? 'font-semibold text-a-ink' : 'text-a-muted')}>
          {note.title || 'Untitled'}
        </span>
      </button>

      {/* A sibling of the row button, so there are no nested interactive elements. */}
      <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 group-focus-within:opacity-100 has-[[data-state=open]]:opacity-100">
        {onAddChild && (
          <button type="button" onClick={onAddChild} className={contextIconButton} aria-label={`Add a page inside ${note.title || 'Untitled'}`} title="Add a page inside">
            <Plus className="size-3.5" strokeWidth={1.75} />
          </button>
        )}
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
          className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-[6px] text-[32px] leading-none transition-colors duration-[120ms] hover:bg-a-line-soft"
          aria-label="Change note emoji"
          title="Change note emoji"
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
          {emoji}
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
  onSetIndent,
  onSetBlocks,
  onUndoBlocks,
  onRedoBlocks,
  linking,
  codeFiles,
  pages,
  trail,
  linkedFrom,
  onOpenNote,
}: {
  note: Note;
  linking?: NoteTaskLinking;
  codeFiles?: CodeFilesApi;
  pages?: PagesApi;
  /** The pages above this one, from the top down, and how to open one. */
  trail?: ReadonlyArray<{ id: string; title: string; emoji?: string }>;
  /** The notes that link to this one, for the "Linked from" list. */
  linkedFrom?: ReadonlyArray<Pick<Note, 'id' | 'title' | 'emoji'>>;
  onOpenNote?: (id: string) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onUpdateEmoji: (id: string, emoji: string) => void;
  onUpdateBlock: (noteId: string, blockId: string, changes: Partial<import('@/types/notes').NoteBlock>) => void;
  onAddBlock: (noteId: string, afterBlockId: string, type?: BlockType) => string;
  onDeleteBlock: (noteId: string, blockId: string) => void;
  onChangeBlockType: (noteId: string, blockId: string, type: BlockType) => void;
  onMoveBlock: (noteId: string, blockId: string, direction: 'up' | 'down') => void;
  onSetIndent: (noteId: string, blockId: string, direction: 'in' | 'out') => void;
  onSetBlocks: (noteId: string, blocks: NoteBlock[]) => void;
  onUndoBlocks: (noteId: string) => NoteBlock[] | null;
  onRedoBlocks: (noteId: string) => NoteBlock[] | null;
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
  const plainJson = JSON.stringify(note.blocks);
  const { size: syncSize, packed: packedKnown } = useSyncedSize(plainJson);
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
      <div data-note-page className="animate-fade-in px-4 pb-24 pt-8 md:px-8">
        {/* One reading column: a 720px measure plus the 44px margin that block
            controls hang into. The padding is applied once, here, so the title,
            metadata, every block, tables and panels share one left edge. */}
        <div className="mx-auto w-full max-w-[calc(var(--a-measure)+var(--a-gutter))] md:pl-[var(--a-gutter)]">
          <div>
            {trail && trail.length > 0 && (
              <nav aria-label="Page path" className="mb-2 flex flex-wrap items-center gap-1 text-[13px] text-a-faint">
                {trail.map((page) => (
                  <Fragment key={page.id}>
                    <button type="button" onClick={() => onOpenNote?.(page.id)} className="max-w-[200px] truncate rounded-[4px] px-1 hover:bg-a-row-hover hover:text-a-ink">
                      {page.emoji ? `${page.emoji} ` : ''}{page.title || 'Untitled'}
                    </button>
                    <ChevronRight className="size-3 flex-shrink-0" strokeWidth={1.75} aria-hidden />
                  </Fragment>
                ))}
                <span className="max-w-[200px] truncate px-1 text-a-muted">{note.title || 'Untitled'}</span>
              </nav>
            )}
            <div className="flex min-w-0 items-start gap-3">
              {note.emoji !== '' && (
                <EmojiPicker
                  emoji={note.emoji ?? '📝'}
                  onSelect={(emoji) => {
                    onUpdateEmoji(note.id, emoji);
                    if (emoji === '') titleRef.current?.focus();
                  }}
                />
              )}

            <textarea
              ref={titleRef}
              value={note.title}
              onChange={(e) => onUpdateTitle(note.id, e.target.value)}
              placeholder="Untitled"
              rows={1}
              className={cn(
                'min-w-0 flex-1 resize-none border-none bg-transparent p-0 outline-none field-sizing-content [overflow-wrap:anywhere]',
                'block text-[34px] leading-[1.22] font-bold tracking-normal text-a-ink',
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
            </div>

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
                      ? `Too long to sync: ${syncSize.toLocaleString()} of ${NOTE_SYNC_LIMIT.toLocaleString()} characters even when compressed. Shorten it or move part into another note.`
                      : `${syncSize.toLocaleString()} of ${NOTE_SYNC_LIMIT.toLocaleString()} characters${packedKnown ? ' (compressed)' : ''}`}
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
            onSetIndent={(blockId, direction) => onSetIndent(note.id, blockId, direction)}
            onSetBlocks={(blocks) => onSetBlocks(note.id, blocks)}
            onUndo={() => onUndoBlocks(note.id)}
            onRedo={() => onRedoBlocks(note.id)}
            noteId={note.id}
            linking={linking}
            codeFiles={codeFiles}
            pages={pages}
          />

          {linkedFrom && linkedFrom.length > 0 && (
            <section aria-label="Linked from" className="mt-8 border-t border-a-line pt-4">
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-a-faint">Linked from</h3>
              <ul className="flex flex-col gap-0.5">
                {linkedFrom.map((from) => (
                  <li key={from.id}>
                    <button type="button" onClick={() => onOpenNote?.(from.id)} className="flex w-full min-w-0 items-center gap-2 rounded-[6px] px-1.5 py-1 text-left text-[14px] text-a-muted transition-colors duration-[120ms] hover:bg-a-row-hover hover:text-a-ink">
                      <span aria-hidden className="w-5 flex-shrink-0 text-center">{from.emoji ?? '📝'}</span>
                      <span className="min-w-0 flex-1 truncate">{from.title || 'Untitled'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
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
export function SyncIndicatorWrapper({ saveStatus }: { saveStatus: SaveStatus }) {
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
  /** Opens a Notepad file (one shown inside a note) on the Notepad page. */
  onOpenFile?: (fileId: string) => void;
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

export function NotesWorkspace({ onOpenFile, linking, openNoteId, onOpenNoteHandled, onActiveNoteChange, onSidebarContentChange, onOpenSidebar, onCountChange, createOnOpen, onCreateHandled }: NotesWorkspaceProps = {}) {
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
    setBlockIndent,
    setBlocks,
    undoBlocks,
    redoBlocks,
    flushNote,
    otherNotes,
  } = useNotes();

  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Note | null>(null);

  // Notepad files, for a "Notepad file" block inside a note. They live in the same store as notes.
  const codeFiles = useMemo<CodeFilesApi>(() => {
    const files = otherNotes.filter(isNotepadFile);
    return {
      files: files.map((n) => ({ id: n.id, title: n.title, language: fileSettings(n).language })),
      get: (id) => files.find((n) => n.id === id),
      setBlocks,
      create: () => {
        const parts = newFileParts();
        return createNote(parts.title, { blocks: parts.blocks, emoji: parts.emoji }, { activate: false }).id;
      },
      open: (id) => onOpenFile?.(id),
    };
  }, [otherNotes, setBlocks, createNote, onOpenFile]);

  // Opened from a task. Notes are stored per device and never pulled from the
  // server, so a note written elsewhere may simply not be here.
  useEffect(() => {
    if (!openNoteId || isLoading) return;
    if (notes.some((n) => n.id === openNoteId)) {
      setActiveNoteId(openNoteId);
      setSearch('');
    } else {
      toast.error('That note is not available in this workspace', {
        description: 'Sync the workspace and try again.',
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

  const handleCreate = useCallback(() => {
    createNote('Untitled');
  }, [createNote]);

  useEffect(() => {
    if (!createOnOpen || isLoading) return;
    handleCreate();
    onCreateHandled?.();
  }, [createOnOpen, isLoading, handleCreate, onCreateHandled]);

  // ── Pages inside pages ──
  // A note's parent is the note that holds a page block pointing at it (lib/notePages), so the tree is read from the notes.
  const parents = useMemo(() => parentMap(notes), [notes]);
  const [expandedIds, setExpandedIds] = useLocalStorage<string[]>('hitlist-notes-expanded', []);
  const expanded = useMemo(() => new Set(expandedIds), [expandedIds]);
  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, [setExpandedIds]);
  // The open page is always visible in the tree: what it sits under is opened.
  useEffect(() => {
    if (!activeNoteId) return;
    const chain = ancestorsOf(parents, activeNoteId);
    if (chain.some((id) => !expanded.has(id))) setExpandedIds((prev) => [...new Set([...prev, ...chain])]);
  }, [activeNoteId, parents, expanded, setExpandedIds]);

  /** A new, empty page inside `parentId`: made, linked from the parent by a page block, and opened. */
  const createSubPage = useCallback((parentId: string) => {
    const parent = notes.find((n) => n.id === parentId);
    if (!parent) return;
    const child = createNote('Untitled', undefined, { activate: false });
    setBlocks(parentId, withPage(parent.blocks, child));
    setExpandedIds((prev) => (prev.includes(parentId) ? prev : [...prev, parentId]));
    setActiveNoteId(child.id);
  }, [notes, createNote, setBlocks, setExpandedIds, setActiveNoteId]);

  /** What a page block or a link in the open note needs: the pages' live names, opening one, and making a note. */
  const pagesApi = useMemo<PagesApi>(() => ({
    get: (id) => { const n = notes.find((x) => x.id === id); return n ? { id: n.id, title: n.title, emoji: n.emoji } : undefined; },
    open: (id) => setActiveNoteId(id),
    create: () => { const n = createNote('Untitled', undefined, { activate: false }); return { id: n.id, title: n.title }; },
    getFile: (id) => { const f = otherNotes.find((x) => x.id === id && isNotepadFile(x)); return f ? { id: f.id, title: f.title } : undefined; },
    openFile: (id) => onOpenFile?.(id),
    linkables: () => [
      ...notes.map((n) => ({ id: n.id, title: n.title, emoji: n.emoji, kind: 'note' as const })),
      ...otherNotes.filter(isNotepadFile).map((f) => ({ id: f.id, title: f.title, kind: 'file' as const })),
    ],
    createNote: (title) => { const n = createNote(title || 'Untitled', undefined, { activate: false }); return { id: n.id, title: n.title }; },
  }), [notes, otherNotes, createNote, setActiveNoteId, onOpenFile]);

  /** Moves a page under another (null: to the top level); both parents' page blocks are updated. */
  const movePageTo = useCallback((id: string, parentId: string | null) => {
    const changes = movePage(notes, id, parentId);
    if (!changes) { toast.error("A page can't go inside itself"); return; }
    for (const [noteId, blocks] of Object.entries(changes)) setBlocks(noteId, blocks);
    if (parentId) setExpandedIds((prev) => (prev.includes(parentId) ? prev : [...prev, parentId]));
    if (Object.keys(changes).length > 0) toast.success(parentId ? 'Page moved' : 'Page moved to the top level', { duration: 1800 });
  }, [notes, setBlocks, setExpandedIds]);

  /** Deletes pages, and removes the page blocks that pointed at them from whatever held them. */
  const deletePages = useCallback((ids: string[]) => {
    const gone = new Set(ids);
    for (const n of notes) {
      if (gone.has(n.id)) continue;
      const next = withoutPages(n.blocks, gone);
      if (next !== n.blocks) setBlocks(n.id, next);
    }
    for (const id of ids) deleteNote(id);
  }, [notes, setBlocks, deleteNote]);

  const deleteDescendants = useMemo(
    () => (deleteTarget ? descendantsOf(notes, parents, deleteTarget.id) : []),
    [deleteTarget, notes, parents],
  );
  const handleDeleteConfirm = useCallback((withSubPages: boolean) => {
    if (deleteTarget) {
      deletePages(withSubPages ? [deleteTarget.id, ...deleteDescendants] : [deleteTarget.id]);
      setDeleteTarget(null);
    }
  }, [deleteTarget, deleteDescendants, deletePages]);

  /** The other notes that link to the open one (not its parent: that is the path above the title). */
  const linkedFrom = useMemo(() => (activeNote ? backlinks(notes, activeNote.id) : []), [activeNote, notes]);

  const trail = useMemo(
    () => (activeNote ? ancestorsOf(parents, activeNote.id).flatMap((id) => { const n = notes.find((x) => x.id === id); return n ? [{ id: n.id, title: n.title, emoji: n.emoji }] : []; }) : []),
    [activeNote, parents, notes],
  );

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

  // The Notes list is a tree: each page with the pages inside it. A search shows its matches flat.
  const treeRowsNow = search.trim() ? [] : treeRows(notes, parents, expanded);
  const renderTreeRow = (row: ReturnType<typeof treeRows<Note>>[number]) => (
    <NoteListItem
      key={row.note.id}
      note={row.note}
      isActive={row.note.id === activeNoteId}
      onSelect={() => setActiveNoteId(row.note.id)}
      onPin={() => togglePinNote(row.note.id)}
      onDelete={() => setDeleteTarget(row.note)}
      depth={row.depth}
      hasChildren={row.hasChildren}
      expanded={row.expanded}
      onToggle={() => toggleExpanded(row.note.id)}
      onAddChild={() => createSubPage(row.note.id)}
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

      {search.trim() ? (
        filtered.length > 0 && <ul>{filtered.map(renderRow)}</ul>
      ) : (
        notes.length > 0 && <ul>{treeRowsNow.map(renderTreeRow)}</ul>
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
  const notesSignature = `${notes.map((n) => `${n.id}:${n.title}:${n.pinned}`).join('|')}#${[...parents].join(',')}#${expandedIds.join(',')}`;
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
          {activeNote && <ShareSourceControl kind="note" id={activeNote.id} title={activeNote.title || 'Untitled'} flush={() => flushNote(activeNote.id)} />}

          {/* Pin and delete for the open note, in the one quiet pill. */}
          {activeNote && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={topBarPill} aria-label="Note options">
                  <MoreHorizontal className="size-4" strokeWidth={1.75} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={() => togglePinNote(activeNote.id)}>
                  {activeNote.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                  {activeNote.pinned ? 'Unpin note' : 'Pin note'}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => createSubPage(activeNote.id)}>
                  <FilePlus className="size-3.5" /> Add a page inside
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <FolderInput className="size-3.5" /> Move to
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-[320px] w-56 overflow-auto">
                    {parents.has(activeNote.id) && (
                      <DropdownMenuItem onClick={() => movePageTo(activeNote.id, null)}>Top level</DropdownMenuItem>
                    )}
                    {notes
                      .filter((n) => n.id !== activeNote.id && n.id !== parents.get(activeNote.id) && !descendantsOf(notes, parents, activeNote.id).includes(n.id))
                      .slice(0, 60)
                      .map((n) => (
                        <DropdownMenuItem key={n.id} onClick={() => movePageTo(activeNote.id, n.id)}>
                          <span aria-hidden>{n.emoji ?? '📝'}</span>
                          <span className="min-w-0 flex-1 truncate">{n.title || 'Untitled'}</span>
                        </DropdownMenuItem>
                      ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
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
            onSetIndent={setBlockIndent}
            onSetBlocks={setBlocks}
            onUndoBlocks={undoBlocks}
            onRedoBlocks={redoBlocks}
            linking={linking}
            codeFiles={codeFiles}
            pages={pagesApi}
            trail={trail}
            linkedFrom={linkedFrom}
            onOpenNote={setActiveNoteId}
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
              {deleteDescendants.length > 0
                ? `"${deleteTarget?.title || 'Untitled'}" has ${deleteDescendants.length} page${deleteDescendants.length !== 1 ? 's' : ''} inside it. Delete them too, or keep them as separate notes. This cannot be undone.`
                : `"${deleteTarget?.title || 'Untitled'}" will be permanently deleted. This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {deleteDescendants.length > 0 && (
              <AlertDialogAction onClick={() => handleDeleteConfirm(false)} className="bg-a-surface-2 text-a-ink hover:bg-a-row-hover">
                Delete only this page
              </AlertDialogAction>
            )}
            <AlertDialogAction
              onClick={() => handleDeleteConfirm(true)}
              className="bg-destructive text-a-surface hover:bg-destructive/90"
            >
              {deleteDescendants.length > 0 ? `Delete with ${deleteDescendants.length} page${deleteDescendants.length !== 1 ? 's' : ''}` : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
