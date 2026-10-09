/** "Notepad file" in the slash menu: the files there are, to show one in the note, or a new one. Opens where the slash menu was. */
import { useEffect } from 'react';
import { FileCode2, Plus } from 'lucide-react';
import { languageById } from '@/lib/codeLanguages';
import type { CodeFilesApi } from '@/components/notes/codeContext';

export function FilePicker({
  position, files, onPick, onNew, onClose,
}: {
  position: { top: number; left: number };
  files: CodeFilesApi['files'];
  onPick: (fileId: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('[data-file-picker]')) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    // Attached a tick late: the press that chose "Notepad file" is still travelling and would close this at once.
    const attach = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    document.addEventListener('keydown', onKey);
    return () => { window.clearTimeout(attach); document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  return (
    <div
      data-file-picker
      role="listbox"
      aria-label="Notepad files"
      className="fixed z-50 max-h-[320px] w-[300px] overflow-auto rounded-[8px] border border-a-line bg-a-surface p-1.5 text-[14px] text-a-ink shadow-[var(--a-shadow-lg)] animate-fade-in"
      style={{ top: position.top, left: Math.max(8, position.left) }}
    >
      <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-a-faint">Show a Notepad file</p>
      <button type="button" onClick={onNew} className="flex min-h-[30px] w-full items-center gap-2.5 rounded-[6px] px-2 py-1 text-left text-a-accent-700 hover:bg-a-line-soft">
        <Plus className="size-4" strokeWidth={1.75} aria-hidden />
        <span>New file</span>
      </button>
      {files.length === 0 && <p className="px-2 py-2 text-[13px] text-a-faint">No files yet. Make one here, or on the Notepad page.</p>}
      {files.map((f) => (
        <button
          key={f.id}
          type="button"
          role="option"
          aria-selected={false}
          aria-label={`Show ${f.title || 'Untitled'}`}
          onClick={() => onPick(f.id)}
          className="flex min-h-[30px] w-full items-center gap-2.5 rounded-[6px] px-2 py-1 text-left hover:bg-a-line-soft"
        >
          <FileCode2 className="size-4 text-a-muted" strokeWidth={1.75} aria-hidden />
          <span className="min-w-0 flex-1 truncate">{f.title || 'Untitled'}</span>
          <span className="text-[11px] text-a-faint">{languageById(f.language).label}</span>
        </button>
      ))}
    </div>
  );
}
