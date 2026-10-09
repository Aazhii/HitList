/**
 * The code editor inside a note: a `code` block (text kept in the block) and a `codefile` block (a Notepad file shown
 * and edited live). Loaded on demand by NoteEditor, so the editor engine is not part of the app's first load.
 */
import { useCallback, useEffect, useRef, type KeyboardEvent } from 'react';
import { Copy, Download, ExternalLink, FileCode2, Trash2, WrapText } from 'lucide-react';
import { toast } from 'sonner';
import type { EditorView } from '@codemirror/view';
import { cn } from '@/lib/utils';
import { CodeEditor } from '@/components/code/CodeEditor';
import { useNoteCode } from '@/components/notes/codeContext';
import { CODE_LANGUAGES, fileNameFor, isIndentChoice, languageById } from '@/lib/codeLanguages';
import { downloadTextFile } from '@/lib/download';
import { fileSettings, fileText, withFileChanges } from '@/lib/notepad';
import type { NoteBlock } from '@/types/notes';

const SELECT = 'h-6 rounded-[4px] border border-a-line bg-a-surface px-1.5 text-[12px] text-a-ink outline-none focus-visible:ring-2 focus-visible:ring-a-accent-700';
const HEAD_BUTTON = 'inline-flex h-6 items-center gap-1 rounded-[4px] px-1.5 text-[12px] text-a-muted transition-colors duration-[120ms] hover:bg-a-row-hover hover:text-a-ink';

function useCopy(text: string) {
  return useCallback(() => {
    const done = () => toast.success('Copied to the clipboard', { duration: 1800 });
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => toast.error("Couldn't copy"));
    else toast.error("Couldn't copy");
  }, [text]);
}

/** A code block's keyboard hand-offs: Esc chooses the block, an arrow past either end moves on. */
function useBlockKeys(blockId: string) {
  const code = useNoteCode();
  const view = useRef<EditorView | null>(null);
  const onView = useCallback((v: EditorView | null) => {
    view.current = v;
    code.registerFocus(blockId, v ? () => v.focus() : null);
    if (v && code.consumeFocus(blockId)) v.focus();
  }, [code, blockId]);
  const onEdge = useCallback((direction: 'up' | 'down') => code.leaveBlock(blockId, direction), [code, blockId]);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // CodeMirror keeps Esc for its own panels and completions; what it did not take chooses the block.
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); code.exitBlock(blockId); }
  };
  return { onView, onEdge, onKeyDown };
}

function Header({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-1.5 border-b border-a-line bg-a-surface-2 px-2 py-1">{children}</div>;
}

// ── A code block ───────────────────────────────────────────────────────────────
export function CodeBlockView({ block, onChange }: { block: NoteBlock; onChange: (changes: Partial<NoteBlock>) => void }) {
  const keys = useBlockKeys(block.id);
  const copy = useCopy(block.content);
  const language = languageById(block.language);
  return (
    <div onKeyDown={keys.onKeyDown} className="overflow-hidden rounded-[8px] border border-a-line bg-a-surface" data-code-block>
      <Header>
        <label className="sr-only" htmlFor={`lang-${block.id}`}>Language</label>
        <select id={`lang-${block.id}`} value={language.id} onChange={(e) => onChange({ language: e.target.value })} className={SELECT}>
          {CODE_LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
        <span className="flex-1" />
        <button type="button" onClick={() => onChange({ codeWrap: block.codeWrap ? undefined : true })} aria-pressed={!!block.codeWrap} title="Wrap long lines" className={cn(HEAD_BUTTON, block.codeWrap && 'bg-a-accent-tint text-a-accent-700')}>
          <WrapText className="size-3.5" strokeWidth={1.75} aria-hidden /> Wrap
        </button>
        <button type="button" onClick={copy} className={HEAD_BUTTON} title="Copy the code">
          <Copy className="size-3.5" strokeWidth={1.75} aria-hidden /> Copy
        </button>
      </Header>
      <CodeEditor
        value={block.content}
        onChange={(content) => onChange({ content })}
        language={block.language}
        indent={isIndentChoice(block.codeIndent) ? block.codeIndent : '2'}
        wrap={!!block.codeWrap}
        autoHeight
        ariaLabel="Code block"
        onView={keys.onView}
        onEdge={keys.onEdge}
        fontSize={13}
      />
    </div>
  );
}

// ── A Notepad file shown in a note ─────────────────────────────────────────────
export function CodeFileView({ block, onRemove }: { block: NoteBlock; onRemove: () => void }) {
  const { codeFiles } = useNoteCode();
  const keys = useBlockKeys(block.id);
  const file = block.fileId ? codeFiles?.get(block.fileId) : undefined;
  const text = file ? fileText(file) : '';
  const copy = useCopy(text);
  const latest = useRef(file);
  useEffect(() => { latest.current = file; });

  if (!file || !codeFiles) {
    return (
      <div className="flex items-center gap-2 rounded-[8px] border border-dashed border-a-line-strong px-3 py-2 text-[13px] text-a-faint">
        <FileCode2 className="size-4" strokeWidth={1.75} aria-hidden />
        <span className="flex-1">File not available here. It may have been deleted, or it is not in this workspace.</span>
        <button type="button" onClick={onRemove} className={HEAD_BUTTON} title="Remove this block">
          <Trash2 className="size-3.5" strokeWidth={1.75} aria-hidden /> Remove
        </button>
      </div>
    );
  }

  const settings = fileSettings(file);
  const change = (changes: Parameters<typeof withFileChanges>[1]) => {
    const current = latest.current;
    if (current) codeFiles.setBlocks(current.id, withFileChanges(current.blocks, changes));
  };

  return (
    <div onKeyDown={keys.onKeyDown} className="overflow-hidden rounded-[8px] border border-a-line bg-a-surface" data-code-file={file.id}>
      <Header>
        <FileCode2 className="size-3.5 flex-shrink-0 text-a-faint" strokeWidth={1.75} aria-hidden />
        <button type="button" onClick={() => codeFiles.open(file.id)} className="min-w-0 truncate text-[12px] font-medium text-a-ink hover:underline" title="Open in Notepad">
          {file.title || 'Untitled'}
        </button>
        <label className="sr-only" htmlFor={`file-lang-${block.id}`}>Language</label>
        <select id={`file-lang-${block.id}`} value={languageById(settings.language).id} onChange={(e) => change({ language: e.target.value })} className={SELECT}>
          {CODE_LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
        <span className="flex-1" />
        <button type="button" onClick={copy} className={HEAD_BUTTON} title="Copy the file">
          <Copy className="size-3.5" strokeWidth={1.75} aria-hidden /> Copy
        </button>
        <button type="button" onClick={() => downloadTextFile(fileNameFor(file.title, settings.language), text)} className={HEAD_BUTTON} title="Download the file">
          <Download className="size-3.5" strokeWidth={1.75} aria-hidden /> Download
        </button>
        <button type="button" onClick={() => codeFiles.open(file.id)} className={HEAD_BUTTON} title="Open in Notepad">
          <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden /> Open
        </button>
        <button type="button" onClick={onRemove} className={HEAD_BUTTON} title="Remove from this note (the file is kept)" aria-label="Remove from this note">
          <Trash2 className="size-3.5" strokeWidth={1.75} aria-hidden />
        </button>
      </Header>
      <CodeEditor
        value={text}
        onChange={(content) => change({ content })}
        language={settings.language}
        indent={settings.indent}
        wrap={settings.wrap}
        autoHeight
        ariaLabel={`Code of ${file.title || 'file'}`}
        onView={keys.onView}
        onEdge={keys.onEdge}
        fontSize={13}
      />
    </div>
  );
}
