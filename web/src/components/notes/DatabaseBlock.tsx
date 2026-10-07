/**
 * A database inside a note (showcase 356–542): a title with an "open" arrow, then the same view tabs,
 * toolbar and table or board the Databases page has — because it is the same component. The block only
 * points at a database (its own, made by "Create database", or a linked view of another): removing
 * the block never removes the database or its records.
 */
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { ArrowUpRight, Table2 } from 'lucide-react';
import { toast } from 'sonner';
import { DatabaseWorkspace } from '@/components/databases/DatabaseWorkspace';
import { useDatabases } from '@/hooks/useDatabases';
import type { DatabaseTaskLinking } from '@/pages/DatabasesPage';
import { breakoutBox } from '@/lib/breakout';

export interface DatabaseBlockProps {
  databaseId: string;
  /** The view it opens on: a board opens on the database's first board view. */
  layout?: 'table' | 'board';
  linking?: DatabaseTaskLinking;
  onOpenDatabase?: (databaseId: string) => void;
  /** Kept for the row's hover controls; the block now always starts at its column, so this is called with 0. */
  onShift?: (left: number) => void;
}

/** The width the note's block controls hang into (index.css --a-gutter). */
const GUTTER = 44;

/**
 * Makes the element as wide as the note page's content (see lib/breakout.ts), whatever the narrow column around it. Measured
 * from the page (`[data-note-page]`) and the column, and measured again when either changes size.
 */
function useWideAsPage(onShift?: (left: number) => void) {
  // A callback ref: the block renders a placeholder while its database loads, so the element can appear later.
  const [el, ref] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState<{ width: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const column = el?.parentElement;
    const page = el?.closest<HTMLElement>('[data-note-page]');
    if (!el || !column || !page) return;
    const measure = () => {
      const p = page.getBoundingClientRect();
      const style = getComputedStyle(page);
      const c = column.getBoundingClientRect();
      const next = breakoutBox({
        pageLeft: p.left, pageWidth: p.width,
        padLeft: parseFloat(style.paddingLeft) || 0, padRight: parseFloat(style.paddingRight) || 0,
        columnLeft: c.left, columnWidth: c.width, inset: GUTTER,
      });
      setBox((prev) => (prev && Math.abs(prev.width - next.width) < 0.5 && Math.abs(prev.left - next.left) < 0.5 ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(page);
    observer.observe(column);
    return () => observer.disconnect();
  }, [el]);
  // The block's own text and toolbar stay where the note's text starts; only the grid scrolls out over the margin. So the
  // row's hover controls stay put too.
  useEffect(() => { onShift?.(0); }, [onShift]);
  return [ref, box
    ? { width: box.width, marginLeft: box.left, paddingLeft: -box.left, '--note-inset': `${-box.left}px` } as React.CSSProperties
    : undefined] as const;
}

export function DatabaseBlock({ databaseId, layout, linking, onOpenDatabase, onShift }: DatabaseBlockProps) {
  const [wideRef, wideStyle] = useWideAsPage(onShift);
  const notify = useCallback((message: string) => toast.error(message, { duration: 3000 }), []);
  const { databases, rows, loading, rowsLoading, createRow, updateRow, deleteRow, updateDatabase } = useDatabases(databaseId, notify);
  const database = databases.find((d) => d.id === databaseId);
  const [title, setTitle] = useState('');
  useEffect(() => { if (database) setTitle(database.name); }, [database]);

  if (!database) {
    return (
      <div className="rounded-[8px] border border-dashed border-a-line-strong px-4 py-3 text-[13px] text-a-faint">
        {loading ? 'Loading database…' : 'This database is no longer there. The block can be removed from its menu.'}
      </div>
    );
  }

  const commitTitle = () => {
    const name = title.trim();
    if (name && name !== database.name) void updateDatabase(database.id, { name, icon: database.icon });
    else setTitle(database.name);
  };

  return (
    <div ref={wideRef} style={wideStyle} aria-label={`Database: ${database.name}`} role="group">
      <div className="mb-1.5 flex h-7 items-center gap-2">
        <Table2 className="size-[18px] flex-shrink-0 text-a-muted" strokeWidth={1.75} aria-hidden />
        <input
          value={title}
          maxLength={100}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') { setTitle(database.name); e.currentTarget.blur(); }
          }}
          aria-label="Database name"
          placeholder="Untitled database"
          className="h-7 w-[300px] max-w-[60%] border-0 bg-transparent p-0 text-[16px] font-semibold text-a-ink outline-none placeholder:text-a-faint"
        />
        {onOpenDatabase && (
          <button
            type="button"
            onClick={() => onOpenDatabase(database.id)}
            aria-label="Open in Databases"
            title="Open in Databases"
            className="flex size-6 items-center justify-center rounded-[4px] text-a-faint transition-colors duration-[120ms] hover:bg-a-line-soft hover:text-a-ink"
          >
            <ArrowUpRight className="size-4" strokeWidth={1.75} />
          </button>
        )}
      </div>
      <DatabaseWorkspace
        inline
        database={database}
        store={{ rows, rowsLoading, createRow, updateRow, deleteRow, updateDatabase }}
        linking={linking}
        startOn={layout}
      />
    </div>
  );
}
