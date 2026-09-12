import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Plus, Search, Pin, PinOff, Trash2, FileText, Clock, MoreHorizontal,
  StickyNote, Loader2, CheckCircle2, AlertCircle, WifiOff,
  PanelLeftClose, PanelLeftOpen, RefreshCw,
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
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
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

// ── Note list item ─────────────────────────────────────────────────────────────
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
  const preview = getNotePreview(note);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full text-left px-3 py-2.5 rounded-xl transition-all duration-150 group relative',
        isActive
          ? 'bg-primary/10 ring-1 ring-primary/20'
          : 'hover:bg-muted/60'
      )}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        <span className="text-base leading-none mt-0.5 flex-shrink-0">{note.emoji ?? '📝'}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={cn(
              'text-sm font-medium truncate flex-1',
              isActive ? 'text-foreground' : 'text-foreground/90'
            )}>
              {note.title || 'Untitled'}
            </span>
            {note.pinned && <Pin className="size-2.5 text-primary flex-shrink-0" />}
          </div>
          {preview && (
            <p className="text-xs text-muted-foreground truncate mt-0.5 leading-relaxed">
              {preview}
            </p>
          )}
          <p className="text-[10px] text-muted-foreground/60 mt-1 flex items-center gap-1">
            <Clock className="size-2.5" />
            {formatNoteDate(note.updatedAt)}
          </p>
        </div>
      </div>

      {/* Context menu */}
      <div
        className={cn(
          'absolute right-2 top-2 transition-opacity duration-150',
          'opacity-0 group-hover:opacity-100'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" className="size-5 rounded-md text-muted-foreground hover:text-foreground">
              <MoreHorizontal className="size-3" />
            </Button>
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
    </button>
  );
}

// ── Empty state (no notes at all) ──────────────────────────────────────────────
function NotesEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-20 px-8 text-center animate-fade-in">
      <div className="size-20 rounded-3xl bg-muted/50 flex items-center justify-center mb-6 ring-1 ring-border/50">
        <StickyNote className="size-9 text-muted-foreground/40" />
      </div>
      <h3 className="text-xl font-semibold text-foreground mb-2">No notes yet</h3>
      <p className="text-sm text-muted-foreground max-w-xs leading-relaxed mb-8">
        Capture ideas, meeting notes, or anything on your mind. Notes live alongside your tasks.
      </p>
      <Button onClick={onCreate} className="gap-2 rounded-xl h-9 px-4">
        <Plus className="size-4" />
        New note
      </Button>
    </div>
  );
}

// ── Empty state (note selected but no content) ─────────────────────────────────
function SelectNotePrompt({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-20 px-8 text-center animate-fade-in">
      <div className="size-16 rounded-2xl bg-muted/40 flex items-center justify-center mb-5">
        <FileText className="size-7 text-muted-foreground/40" />
      </div>
      <h3 className="text-base font-medium text-foreground mb-1.5">Select a note</h3>
      <p className="text-sm text-muted-foreground max-w-xs leading-relaxed mb-6">
        Choose a note from the list, or create a new one.
      </p>
      <Button onClick={onCreate} variant="outline" className="gap-2 rounded-xl h-8 px-3 text-xs">
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
          className="text-5xl leading-none mb-4 block hover:scale-105 transition-transform duration-150 cursor-pointer focus:outline-none"
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
              className="text-xl p-1.5 rounded-lg hover:bg-muted transition-colors duration-100 text-center"
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
    <div className="flex flex-col h-full animate-fade-in">
      {/* Note header */}
      <div className="px-8 pt-10 pb-4 flex-shrink-0">
        {/* Emoji */}
        <EmojiPicker
          emoji={note.emoji ?? '📝'}
          onSelect={(e) => onUpdateEmoji(note.id, e)}
        />

        {/* Title */}
        <textarea
          ref={titleRef}
          value={note.title}
          onChange={(e) => onUpdateTitle(note.id, e.target.value)}
          placeholder="Untitled"
          rows={1}
          className={cn(
            'w-full resize-none bg-transparent outline-none border-none p-0',
            'text-3xl font-bold tracking-tight text-foreground leading-tight',
            'placeholder:text-muted-foreground/30 field-sizing-content',
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

        {/* Metadata */}
        <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground/60">
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            Edited {formatNoteDate(note.updatedAt)}
          </span>
          <span>·</span>
          <span>{note.blocks.length} block{note.blocks.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      <Separator className="mx-8 w-auto" />

      {/* Slash command hint */}
      <div className="px-8 pt-2 pb-1 flex-shrink-0 flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-muted-foreground/35 font-medium flex items-center gap-1">
          <kbd className="font-mono bg-muted/50 px-1 py-px rounded border border-border/40 text-[9px] text-muted-foreground/60">/</kbd>
          <span>commands</span>
        </span>
        <span className="text-muted-foreground/20 text-[10px]">·</span>
        <span className="text-[10px] text-muted-foreground/35 font-medium flex items-center gap-1">
          <kbd className="font-mono bg-muted/50 px-1 py-px rounded border border-border/40 text-[9px] text-muted-foreground/60">↵</kbd>
          <span>new block</span>
        </span>
        <span className="text-muted-foreground/20 text-[10px]">·</span>
        <span className="text-[10px] text-muted-foreground/35 font-medium flex items-center gap-1">
          <kbd className="font-mono bg-muted/50 px-1 py-px rounded border border-border/40 text-[9px] text-muted-foreground/60">Tab</kbd>
          <span>table cells</span>
        </span>
      </div>

      {/* Editor */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-8 py-4 pb-24">
          <NoteEditor
            blocks={note.blocks}
            onUpdateBlock={(blockId, changes) => onUpdateBlock(note.id, blockId, changes)}
            onAddBlock={(afterBlockId, type) => onAddBlock(note.id, afterBlockId, type)}
            onDeleteBlock={(blockId) => onDeleteBlock(note.id, blockId)}
            onChangeBlockType={(blockId, type) => onChangeBlockType(note.id, blockId, type)}
            onMoveBlock={(blockId, direction) => onMoveBlock(note.id, blockId, direction)}
          />
        </div>
      </ScrollArea>
    </div>
  );
}

// ── Sync status indicator ──────────────────────────────────────────────────────
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
        'flex items-center gap-1 text-[10px] font-medium select-none transition-all duration-300 ease-in-out',
        isIdle                    && 'opacity-0 pointer-events-none',
        (isSaving || isSyncing)   && 'opacity-100 text-muted-foreground/70',
        isSaved && !isOffline     && 'opacity-100 text-primary/70',
        isOffline                 && 'opacity-100 text-amber-500/80',
        isError && !isOffline     && 'opacity-100 text-destructive',
      )}
      aria-live="polite"
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      {showSpinner && <Loader2 className="size-3 animate-spin" />}
      {showCheck   && <CheckCircle2 className="size-3" />}
      {showWifi    && <WifiOff className="size-3" />}
      {showAlert   && <AlertCircle className="size-3" />}
      {label}
    </span>
  );
}

// Keep old SaveIndicator as alias for any remaining usages
function SaveIndicator({ status }: { status: SaveStatus }) {
  return <SyncIndicator saveStatus={status} syncStatus="synced" />;
}

// Wrapper that subscribes to live sync status
function SyncIndicatorWrapper({ saveStatus }: { saveStatus: SaveStatus }) {
  const syncStatus = useSyncStatus();
  return <SyncIndicator saveStatus={saveStatus} syncStatus={syncStatus} />;
}

// ── Loading skeleton ───────────────────────────────────────────────────────────
function NotesLoadingSkeleton() {
  return (
    <div className="flex h-full min-h-0">
      {/* Sidebar skeleton */}
      <div className="w-64 border-r border-border bg-card/50 flex flex-col gap-2 p-3 flex-shrink-0">
        <div className="flex items-center justify-between px-1 pt-1 pb-2">
          <Skeleton className="h-4 w-16 rounded-md" />
          <Skeleton className="size-6 rounded-md" />
        </div>
        <Skeleton className="h-7 w-full rounded-lg" />
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-start gap-2.5 px-3 py-2.5">
            <Skeleton className="size-5 rounded-md flex-shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-3/4 rounded-md" />
              <Skeleton className="h-3 w-full rounded-md" />
              <Skeleton className="h-2.5 w-1/2 rounded-md" />
            </div>
          </div>
        ))}
      </div>
      {/* Editor skeleton */}
      <div className="flex-1 flex flex-col gap-5 p-8 pt-10">
        <Skeleton className="size-14 rounded-2xl" />
        <Skeleton className="h-9 w-72 rounded-md" />
        <Skeleton className="h-3.5 w-44 rounded-md" />
        <div className="space-y-2.5 mt-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className={cn('h-4 rounded-md', i % 3 === 0 ? 'w-3/4' : 'w-full')} />
          ))}
        </div>
      </div>
    </div>
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
  const [sidebarOpen, setSidebarOpen] = useState(true);

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

  return (
    <div className="flex h-full min-h-0 animate-fade-in">
      {/* ── Notes sidebar ── */}
      <div className={cn(
        'flex flex-col border-r border-border bg-card/50 flex-shrink-0 transition-all duration-200 overflow-hidden',
        sidebarOpen ? 'w-64' : 'w-0'
      )}>
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-3 pt-4 pb-2 flex-shrink-0">
          <div className="flex items-center gap-2">
            <FileText className="size-3.5 text-primary" />
            <span className="text-xs font-semibold text-foreground">Notes</span>
            <span className="text-[10px] text-muted-foreground bg-muted/60 rounded-full px-1.5 py-0.5">
              {notes.length}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={handleCreate}
            className="size-6 text-muted-foreground hover:text-foreground rounded-md"
            aria-label="New note"
            title="New note"
          >
            <Plus className="size-3.5" />
          </Button>
        </div>

        {/* Search */}
        <div className="px-3 pb-2 flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/50" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search notes…"
              className={cn(
                'w-full h-7 pl-7 pr-3 text-xs rounded-lg bg-muted/40 border border-border/50',
                'outline-none focus:border-primary/40 focus:bg-muted/60 transition-colors duration-150',
                'placeholder:text-muted-foreground/40 text-foreground'
              )}
            />
          </div>
        </div>

        {/* Note list */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-2 pb-4 space-y-0.5">
            {notes.length === 0 && (
              <div className="px-3 py-8 text-center">
                <StickyNote className="size-6 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground/60 mb-2">No notes yet</p>
                <button
                  type="button"
                  onClick={handleCreate}
                  className="text-xs text-primary hover:underline"
                >
                  Create your first note
                </button>
              </div>
            )}

            {pinned.length > 0 && (
              <>
                <div className="px-2 pt-1 pb-0.5">
                  <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                    Pinned
                  </span>
                </div>
                {pinned.map((note) => (
                  <NoteListItem
                    key={note.id}
                    note={note}
                    isActive={note.id === activeNoteId}
                    onSelect={() => setActiveNoteId(note.id)}
                    onPin={() => togglePinNote(note.id)}
                    onDelete={() => setDeleteTarget(note)}
                  />
                ))}
                {unpinned.length > 0 && (
                  <div className="px-2 pt-2 pb-0.5">
                    <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                      Other
                    </span>
                  </div>
                )}
              </>
            )}

            {unpinned.map((note) => (
              <NoteListItem
                key={note.id}
                note={note}
                isActive={note.id === activeNoteId}
                onSelect={() => setActiveNoteId(note.id)}
                onPin={() => togglePinNote(note.id)}
                onDelete={() => setDeleteTarget(note)}
              />
            ))}

            {search && filtered.length === 0 && (
              <div className="px-3 py-6 text-center">
                <p className="text-xs text-muted-foreground/60">No notes match "{search}"</p>
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="mt-1.5 text-xs text-primary hover:underline"
                >
                  Clear search
                </button>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* ── Main editor area ── */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Toolbar — fixed height, all items vertically centered */}
        <div className="flex items-center gap-2 px-3 h-11 border-b border-border flex-shrink-0 bg-background/80 backdrop-blur-sm">
          {/* Sidebar toggle */}
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setSidebarOpen((v) => !v)}
            className="size-7 text-muted-foreground hover:text-foreground rounded-lg flex-shrink-0"
            aria-label={sidebarOpen ? 'Hide notes list' : 'Show notes list'}
            title={sidebarOpen ? 'Hide notes list' : 'Show notes list'}
          >
            {sidebarOpen
              ? <PanelLeftClose className="size-4" />
              : <PanelLeftOpen className="size-4" />
            }
          </Button>

          {activeNote ? (
            <>
              <Separator orientation="vertical" className="h-4 flex-shrink-0" />

              {/* Breadcrumb */}
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <span className="text-sm leading-none flex-shrink-0">{activeNote.emoji}</span>
                <span className="text-xs text-muted-foreground truncate">
                  {activeNote.title || 'Untitled'}
                </span>
              </div>

              {/* Right actions — all inline, same height */}
              <div className="flex items-center gap-1 flex-shrink-0">
                <SyncIndicatorWrapper saveStatus={saveStatus} />

                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => togglePinNote(activeNote.id)}
                  className="size-7 text-muted-foreground hover:text-foreground rounded-lg"
                  aria-label={activeNote.pinned ? 'Unpin note' : 'Pin note'}
                  title={activeNote.pinned ? 'Unpin note' : 'Pin note'}
                >
                  {activeNote.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                </Button>

                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setDeleteTarget(activeNote)}
                  className="size-7 text-muted-foreground hover:text-destructive rounded-lg"
                  aria-label="Delete note"
                  title="Delete note"
                >
                  <Trash2 className="size-3.5" />
                </Button>

                <Button
                  size="xs"
                  onClick={handleCreate}
                  className="h-7 px-2.5 gap-1.5 rounded-lg text-xs flex-shrink-0"
                >
                  <Plus className="size-3" />
                  New
                </Button>
              </div>
            </>
          ) : (
            notes.length > 0 && (
              <Button
                size="xs"
                onClick={handleCreate}
                className="ml-auto h-7 px-2.5 gap-1.5 rounded-lg text-xs"
              >
                <Plus className="size-3" />
                New note
              </Button>
            )
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {activeNote ? (
            <ScrollArea className="h-full">
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
            </ScrollArea>
          ) : notes.length === 0 ? (
            <NotesEmptyState onCreate={handleCreate} />
          ) : (
            <SelectNotePrompt onCreate={handleCreate} />
          )}
        </div>
      </div>

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
              className="bg-destructive/10 text-destructive hover:bg-destructive/20"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
