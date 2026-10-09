import { FileCode2, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNotePages } from '@/components/notes/codeContext';
import type { NoteLink } from '@/lib/noteLinks';

/**
 * A link to another note or a Notepad file, in the middle of a line. The title is looked up live by id (so a rename
 * shows everywhere); the text that was linked is the fallback. A click opens it; a missing target is shown quietly.
 */
export function NoteLinkChip({ link, fallback }: { link: NoteLink; fallback: React.ReactNode }) {
  const pages = useNotePages();
  const target = link.kind === 'file' ? pages?.getFile(link.id) : pages?.get(link.id);
  const Icon = link.kind === 'file' ? FileCode2 : FileText;
  const missing = !!pages && !target;
  const open = () => { if (target) (link.kind === 'file' ? pages?.openFile : pages?.open)?.(link.id); };
  return (
    <button
      type="button"
      title={missing ? 'Not available here' : link.kind === 'file' ? 'Open in Notepad' : 'Open page'}
      aria-label={target ? `${link.kind === 'file' ? 'File' : 'Page'}: ${target.title || 'Untitled'}` : undefined}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); open(); }}
      onKeyDown={(e) => e.stopPropagation()}
      className={cn(
        'inline-flex max-w-full items-baseline gap-1 rounded-[4px] px-0.5 align-baseline underline decoration-a-line-strong underline-offset-[3px] transition-colors duration-[120ms] hover:bg-a-row-hover',
        missing ? 'text-a-faint line-through decoration-1' : 'text-a-ink',
      )}
    >
      <Icon className="size-3.5 flex-shrink-0 translate-y-[2px] text-a-muted" strokeWidth={1.75} aria-hidden />
      <span className="min-w-0 [overflow-wrap:anywhere]">{target ? target.title || 'Untitled' : fallback}</span>
    </button>
  );
}
