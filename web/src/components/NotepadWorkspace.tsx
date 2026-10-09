import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Code2, Copy, Download, FileCode2, MoreHorizontal, Plus, Trash2, WrapText } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useNotes } from '@/hooks/useNotes';
import { useSyncedSize } from '@/hooks/useSyncedSize';
import { CodeEditor } from '@/components/code/CodeEditor';
import { SyncIndicatorWrapper } from '@/components/NotesWorkspace';
import { EmptyState, ILL } from '@/components/EmptyState';
import { RowMenuContent, RowMenuItem } from '@/components/shell/RowMenu';
import { BTN_MD, TopBar, topBarPill, topBarPrimary } from '@/components/shell/TopBar';
import { ViewLayoutContext, ContextSectionHeader, contextIconButton, contextRowClass, useViewLayout } from '@/components/shell/ViewLayout';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CODE_LANGUAGES, fileNameFor, INDENT_CHOICES, isIndentChoice, languageById, languageForFileName, PLAIN_TEXT,
} from '@/lib/codeLanguages';
import { downloadTextFile } from '@/lib/download';
import { fileSettings, fileText, newFileParts, withFileChanges } from '@/lib/notepad';
import { NOTE_SYNC_LIMIT, NOTE_SYNC_WARN, type Note } from '@/types/notes';

const SELECT = 'h-8 rounded-[6px] border border-a-line bg-a-surface px-2 text-[13px] text-a-ink outline-none focus-visible:ring-2 focus-visible:ring-a-accent-700';
const TOOL = 'inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-a-line bg-a-surface px-2.5 text-[13px] text-a-ink transition-colors duration-[120ms] hover:bg-a-row-hover disabled:pointer-events-none disabled:opacity-50';
const FONT_SIZES = [11, 12, 13, 14, 16, 18] as const;

// ── A file in the sidebar ──────────────────────────────────────────────────────
function FileListItem({ note, isActive, onSelect, onDelete }: { note: Note; isActive: boolean; onSelect: () => void; onDelete: () => void }) {
  const { closeContext } = useViewLayout();
  const language = languageById(fileSettings(note).language);
  const name = note.title || 'Untitled';
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => { onSelect(); closeContext(); }}
        aria-current={isActive ? 'true' : undefined}
        className={cn(contextRowClass(isActive), 'pr-9')}
      >
        <FileCode2 className="size-4 flex-shrink-0 text-a-faint" strokeWidth={1.75} aria-hidden />
        <span className={cn('min-w-0 flex-1 truncate text-[14px]', isActive ? 'font-semibold text-a-ink' : 'text-a-muted')}>{name}</span>
        <span className="flex-shrink-0 text-[11px] text-a-faint">{language.id === PLAIN_TEXT ? '' : language.label}</span>
      </button>
      <div className="absolute top-1/2 right-2 -translate-y-1/2 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 group-focus-within:opacity-100 has-[[data-state=open]]:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={contextIconButton} aria-label={`Options for ${name}`}>
              <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
            </button>
          </DropdownMenuTrigger>
          <RowMenuContent caption="File">
            <RowMenuItem icon={Trash2} label="Delete" onSelect={onDelete} destructive />
          </RowMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

// ── The open file ──────────────────────────────────────────────────────────────
function FileEditor({
  note, onTitle, onBlocks,
}: {
  note: Note;
  onTitle: (title: string) => void;
  onBlocks: (blocks: Note['blocks']) => void;
}) {
  const settings = fileSettings(note);
  const text = fileText(note);
  const [fontSize, setFontSize] = useState<number>(13);
  const [cursor, setCursor] = useState({ line: 1, column: 1, selected: 0 });
  const { size, packed } = useSyncedSize(JSON.stringify(note.blocks));
  const language = languageById(settings.language);

  const change = useCallback((changes: Parameters<typeof withFileChanges>[1]) => {
    onBlocks(withFileChanges(note.blocks, changes));
  }, [note.blocks, onBlocks]);

  const copy = useCallback(() => {
    const done = () => toast.success('Copied to the clipboard', { duration: 1800 });
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => toast.error("Couldn't copy"));
    else toast.error("Couldn't copy");
  }, [text]);

  const download = useCallback(() => {
    downloadTextFile(fileNameFor(note.title, settings.language), text);
  }, [note.title, settings.language, text]);

  // ⌘/Ctrl+S: there is nothing to save by hand; say so instead of letting the browser offer to save the page.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        toast('Saved. Changes are saved as you type.', { duration: 1800 });
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const sizeText = `${size.toLocaleString()} of ${NOTE_SYNC_LIMIT.toLocaleString()} characters${packed ? ' (compressed)' : ''}`;
  const tooLong = size > NOTE_SYNC_LIMIT;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-a-line px-4 py-2 md:px-6">
        <input
          value={note.title}
          onChange={(e) => onTitle(e.target.value)}
          // Naming it `report.py` is enough to colour it as Python, unless a language was already chosen.
          onBlur={() => {
            const guess = languageForFileName(note.title);
            if (settings.language === PLAIN_TEXT && guess !== PLAIN_TEXT) change({ language: guess });
          }}
          placeholder="File name, e.g. script.py"
          aria-label="File name"
          spellCheck={false}
          className="h-8 min-w-[160px] flex-1 bg-transparent text-[14px] font-semibold text-a-ink outline-none placeholder:font-normal placeholder:text-a-faint"
        />
        <label className="sr-only" htmlFor="notepad-language">Language</label>
        <select id="notepad-language" value={language.id} onChange={(e) => change({ language: e.target.value })} className={SELECT}>
          {CODE_LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
        <label className="sr-only" htmlFor="notepad-indent">Indentation</label>
        <select
          id="notepad-indent"
          value={settings.indent}
          onChange={(e) => { if (isIndentChoice(e.target.value)) change({ codeIndent: e.target.value }); }}
          className={SELECT}
        >
          {INDENT_CHOICES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <label className="sr-only" htmlFor="notepad-size">Font size</label>
        <select id="notepad-size" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} className={SELECT}>
          {FONT_SIZES.map((n) => <option key={n} value={n}>{n}px</option>)}
        </select>
        <button type="button" onClick={() => change({ codeWrap: !settings.wrap })} aria-pressed={settings.wrap} title="Wrap long lines" className={cn(TOOL, settings.wrap && 'bg-a-accent-tint text-a-accent-700')}>
          <WrapText className="size-4" strokeWidth={1.75} aria-hidden /> Wrap
        </button>
        <button type="button" onClick={copy} className={TOOL} title="Copy the whole file">
          <Copy className="size-4" strokeWidth={1.75} aria-hidden /> Copy
        </button>
        <button type="button" onClick={download} className={TOOL} title={`Download as ${fileNameFor(note.title, settings.language)}`}>
          <Download className="size-4" strokeWidth={1.75} aria-hidden /> Download
        </button>
      </div>

      <div className="min-h-0 flex-1">
        <CodeEditor
          key={note.id}
          value={text}
          onChange={(content) => change({ content })}
          language={settings.language}
          indent={settings.indent}
          wrap={settings.wrap}
          fontSize={fontSize}
          ariaLabel={`Code of ${note.title || 'this file'}`}
          onCursor={setCursor}
        />
      </div>

      <div className="flex items-center gap-3 border-t border-a-line px-4 py-1.5 text-[12px] text-a-faint md:px-6">
        <span>Ln {cursor.line}, Col {cursor.column}{cursor.selected ? ` (${cursor.selected} selected)` : ''}</span>
        <span aria-hidden>·</span>
        <span>{language.label}</span>
        <span aria-hidden>·</span>
        <span>{settings.indent === 'tab' ? 'Tabs' : `${settings.indent} spaces`}</span>
        <span
          role={tooLong ? 'alert' : undefined}
          className={cn('ml-auto', tooLong ? 'font-semibold text-q-do' : size > NOTE_SYNC_WARN ? 'text-q-delegate' : undefined)}
        >
          {tooLong ? `Too long to sync: ${sizeText}. Split it into another file.` : size > NOTE_SYNC_WARN ? sizeText : ''}
        </span>
      </div>
    </div>
  );
}

// ── The page ───────────────────────────────────────────────────────────────────
export interface NotepadWorkspaceProps {
  openNoteId?: string | null;
  onOpenNoteHandled?: () => void;
  onActiveNoteChange?: (id: string | null) => void;
  onSidebarContentChange?: (content: ReactNode) => void;
  onOpenSidebar?: () => void;
  onCountChange?: (count: number) => void;
  createOnOpen?: boolean;
  onCreateHandled?: () => void;
}

/**
 * Notepad: code files, kept as notes (lib/notepad) and edited in the code editor. The sidebar lists the files;
 * the page is the open one, with language, indentation, wrap, copy and download.
 */
export function NotepadWorkspace({
  openNoteId, onOpenNoteHandled, onActiveNoteChange, onSidebarContentChange, onOpenSidebar, onCountChange, createOnOpen, onCreateHandled,
}: NotepadWorkspaceProps = {}) {
  const {
    notes: files, activeNote, activeNoteId, setActiveNoteId, saveStatus, isLoading,
    createNote, deleteNote, updateNoteTitle, setBlocks,
  } = useNotes({ files: true });
  const [deleteTarget, setDeleteTarget] = useState<Note | null>(null);

  const handleCreate = useCallback(() => {
    const parts = newFileParts();
    createNote(parts.title, { blocks: parts.blocks, emoji: parts.emoji });
  }, [createNote]);

  useEffect(() => {
    if (!openNoteId || isLoading) return;
    if (files.some((n) => n.id === openNoteId)) setActiveNoteId(openNoteId);
    else toast.error('That file is not available in this workspace', { description: 'Sync the workspace and try again.', duration: 3500 });
    onOpenNoteHandled?.();
  }, [openNoteId, isLoading, files, setActiveNoteId, onOpenNoteHandled]);

  useEffect(() => {
    if (!createOnOpen || isLoading) return;
    handleCreate();
    onCreateHandled?.();
  }, [createOnOpen, isLoading, handleCreate, onCreateHandled]);

  useEffect(() => { onActiveNoteChange?.(activeNoteId ?? null); }, [activeNoteId, onActiveNoteChange]);
  useEffect(() => { if (!isLoading) onCountChange?.(files.length); }, [isLoading, files.length, onCountChange]);

  // The sidebar (rendered by App) owns the list; report it up on a primitive signature so this cannot loop.
  const signature = files.map((n) => `${n.id}:${n.title}:${fileSettings(n).language}`).join('|');
  const list = (
    <>
      <ContextSectionHeader
        label="Files"
        action={(
          <button type="button" onClick={handleCreate} className={contextIconButton} aria-label="New file" title="New file">
            <Plus className="size-3.5" strokeWidth={1.75} />
          </button>
        )}
      />
      {files.length === 0 && <p className="px-2.5 py-1 text-[12px] text-a-faint">No files yet.</p>}
      <ul>
        {files.map((note) => (
          <FileListItem key={note.id} note={note} isActive={note.id === activeNoteId} onSelect={() => setActiveNoteId(note.id)} onDelete={() => setDeleteTarget(note)} />
        ))}
      </ul>
    </>
  );
  useEffect(() => {
    if (isLoading) return;
    onSidebarContentChange?.(list);
    return () => onSidebarContentChange?.(null);
    // `list` is a fresh element each render; its signature is what changes.
  }, [isLoading, signature, activeNoteId]);

  if (isLoading) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col p-8" aria-busy>
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const topBar = (
    <TopBar
      title="Notepad"
      subtitle={`${files.length} file${files.length !== 1 ? 's' : ''}`}
      actions={(
        <>
          {(activeNote || files.length > 0) && <SyncIndicatorWrapper saveStatus={saveStatus} />}
          {activeNote && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={topBarPill} aria-label="File options">
                  <MoreHorizontal className="size-4" strokeWidth={1.75} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(activeNote)}>
                  <Trash2 className="size-3.5" /> Delete file
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <button type="button" onClick={handleCreate} className={topBarPrimary} aria-label="New file">
            <Plus className="size-[15px]" strokeWidth={1.75} aria-hidden />
            <span className="hidden sm:inline">New</span>
          </button>
        </>
      )}
    />
  );

  return (
    <>
      <ViewLayoutContext.Provider value={{ openContext: () => onOpenSidebar?.(), closeContext: () => {}, toggleCollapsed: () => {}, collapsible: false, collapsed: false }}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {topBar}
          <div className="min-h-0 flex-1 overflow-hidden">
            {activeNote ? (
              <FileEditor
                note={activeNote}
                onTitle={(title) => updateNoteTitle(activeNote.id, title)}
                onBlocks={(blocks) => setBlocks(activeNote.id, blocks)}
              />
            ) : files.length === 0 ? (
              <div className="pt-4">
                <EmptyState
                  image={ILL.template}
                  title="No files yet"
                  description="A notepad for code and text snippets, with colours for 25+ languages. Copy a file, download it, or drop it into a note."
                  action={(
                    <button type="button" onClick={handleCreate} className={cn(topBarPrimary, BTN_MD)}>
                      <Plus className="size-[15px]" strokeWidth={1.75} aria-hidden />
                      New file
                    </button>
                  )}
                />
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center px-8 py-20 text-center">
                <Code2 className="mb-4 size-8 text-a-faint" strokeWidth={1.75} aria-hidden />
                <h3 className="mb-1.5 font-display text-[20px] text-a-ink">Select a file</h3>
                <p className="max-w-xs text-[14px] text-a-muted">Choose a file from the list, or create a new one.</p>
              </div>
            )}
          </div>
        </div>
      </ViewLayoutContext.Provider>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete file?</AlertDialogTitle>
            <AlertDialogDescription>"{deleteTarget?.title || 'Untitled'}" will be permanently deleted. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleteTarget) deleteNote(deleteTarget.id); setDeleteTarget(null); }}
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
