import { FileText, Trash2 } from 'lucide-react';
import { useNotePages } from '@/components/notes/codeContext';
import type { NoteBlock } from '@/types/notes';

/** A sub-page, in the text of its parent: the page's icon and live title; a click opens it. */
export function PageBlock({ block, onRemove }: { block: NoteBlock; onRemove: () => void }) {
  const pages = useNotePages();
  const page = block.pageId ? pages?.get(block.pageId) : undefined;
  if (!page) {
    return (
      <div className="flex items-center gap-2 py-[3px] text-[14px] text-a-faint">
        <FileText className="size-4 flex-shrink-0" strokeWidth={1.75} aria-hidden />
        <span className="flex-1">Page not available here. It may have been deleted, or it is not in this workspace.</span>
        <button type="button" onClick={onRemove} className="inline-flex h-6 items-center gap-1 rounded-[4px] px-1.5 text-[12px] text-a-muted hover:bg-a-row-hover hover:text-a-ink" title="Remove this block">
          <Trash2 className="size-3.5" strokeWidth={1.75} aria-hidden /> Remove
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => pages?.open(page.id)}
      title="Open page"
      className="flex w-full min-w-0 items-center gap-2 rounded-[6px] py-[3px] text-left transition-colors duration-[120ms] hover:bg-a-row-hover"
    >
      {page.emoji && page.emoji !== '' ? <span className="w-5 flex-shrink-0 text-center text-[16px] leading-none" aria-hidden>{page.emoji}</span> : <FileText className="size-4 flex-shrink-0 text-a-muted" strokeWidth={1.75} aria-hidden />}
      <span className="min-w-0 flex-1 truncate border-b border-a-line-strong text-[14px] font-medium text-a-ink">{page.title || 'Untitled'}</span>
    </button>
  );
}
