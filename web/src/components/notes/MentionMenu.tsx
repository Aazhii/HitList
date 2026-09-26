/**
 * The "@" menu: Add to quadrant → workspace → quadrant.
 *
 * Three cascading columns in one floating panel. Each column opens when the row
 * before it is hovered, or entered with → / ↵, so the whole path can be walked
 * by pointer or keyboard. The editor keeps focus in its textarea throughout and
 * forwards navigation keys here through the imperative handle.
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { ChevronRight, KanbanSquare, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { QUADRANTS, getListColorDot, type KaizenList, type Quadrant } from '@/types/todo';

export interface MentionMenuHandle {
  /** Handles a navigation key. Returns true when the key was used. */
  handleKey: (key: string) => boolean;
}

interface MentionMenuProps {
  position: { top: number; left: number };
  lists: KaizenList[];
  /** Listed first: usually the list open in Tasks. */
  preferredListId?: string;
  /** Filters the column that has focus. */
  query: string;
  /** A task is being created; rows are inert. */
  pending: boolean;
  /** Shown in place of the rows, e.g. when the block is empty. */
  message?: string | null;
  onSelect: (listId: string, quadrant: Quadrant) => void;
  onClose: () => void;
}

const COL_W = 212;

const itemClass = (active: boolean) => cn(
  'flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left text-[14.5px] text-a-ink transition-colors duration-100',
  active ? 'bg-a-accent-tint' : 'hover:bg-a-row-hover',
);

function ColumnHeader({ children }: { children: React.ReactNode }) {
  return <p className="px-2.5 pt-2.5 pb-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-a-faint">{children}</p>;
}

export const MentionMenu = forwardRef<MentionMenuHandle, MentionMenuProps>(function MentionMenu(
  { position, lists, preferredListId, query, pending, message, onSelect, onClose },
  ref,
) {
  // Which column has focus: 0 action, 1 workspace, 2 quadrant.
  const [level, setLevel] = useState(0);
  const [listIdx, setListIdx] = useState(0);
  const [quadIdx, setQuadIdx] = useState(0);

  const orderedLists = useMemo(() => {
    const pref = lists.find((l) => l.id === preferredListId);
    return pref ? [pref, ...lists.filter((l) => l.id !== pref.id)] : lists;
  }, [lists, preferredListId]);

  const q = query.trim().toLowerCase();
  const shownLists = level === 1 && q ? orderedLists.filter((l) => l.name.toLowerCase().includes(q)) : orderedLists;
  const shownQuads = level === 2 && q ? QUADRANTS.filter((x) => x.label.toLowerCase().includes(q)) : QUADRANTS;

  // A new query starts from the first match. Keyed on the query alone, so
  // stepping back a column with ← keeps the workspace that was chosen.
  useEffect(() => {
    setListIdx(0);
    setQuadIdx(0);
  }, [q]);

  const activeList = shownLists[Math.min(listIdx, shownLists.length - 1)];

  const choose = (quadrant: Quadrant) => {
    if (pending || !activeList) return;
    onSelect(activeList.id, quadrant);
  };

  useImperativeHandle(ref, () => ({
    handleKey(key) {
      if (key === 'Escape') { onClose(); return true; }
      if (pending) return ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab'].includes(key);
      const count = level === 1 ? shownLists.length : level === 2 ? shownQuads.length : 1;
      const move = (d: number) => {
        if (level === 1) setListIdx((i) => (i + d + count) % Math.max(count, 1));
        if (level === 2) setQuadIdx((i) => (i + d + count) % Math.max(count, 1));
      };
      switch (key) {
        case 'ArrowDown': move(1); return true;
        case 'ArrowUp': move(-1); return true;
        case 'ArrowLeft':
          if (level === 0) return false;
          setLevel((l) => l - 1);
          return true;
        case 'ArrowRight':
        case 'Enter':
        case 'Tab':
          if (level === 0) { setLevel(1); return true; }
          if (level === 1) { if (activeList) setLevel(2); return true; }
          if (shownQuads[quadIdx]) choose(shownQuads[quadIdx].id);
          return true;
        default:
          return false;
      }
    },
  }), [level, shownLists, shownQuads, quadIdx, activeList, pending, onClose]);

  const columns = 1 + (level >= 1 ? 1 : 0) + (level >= 2 ? 1 : 0);
  const width = columns * COL_W;
  const left = Math.max(8, Math.min(position.left, window.innerWidth - width - 8));
  const estHeight = 64 + Math.max(1, level >= 1 ? orderedLists.length : 1, level >= 2 ? 4 : 1) * 38;
  const top = position.top + estHeight > window.innerHeight - 8 ? Math.max(8, position.top - estHeight - 30) : position.top;

  return (
    <div
      data-mention-menu
      role="dialog"
      aria-label="Add to quadrant"
      className="fixed z-50 flex overflow-hidden rounded-[16px] border border-a-line bg-a-bg text-a-ink shadow-[var(--a-shadow-md)] animate-fade-in"
      style={{ top, left }}
      // Keep the caret in the block while the menu is used.
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* Column 1: action */}
      <div className="p-1.5" style={{ width: COL_W }}>
        <ColumnHeader>Note block</ColumnHeader>
        {message ? (
          <p className="px-2.5 pb-2 text-[13px] text-a-muted">{message}</p>
        ) : (
          <button
            type="button"
            className={itemClass(level === 0 || level >= 1)}
            onMouseEnter={() => { if (!pending) setLevel((l) => Math.max(l, 1)); }}
            onClick={() => setLevel((l) => Math.max(l, 1))}
            aria-expanded={level >= 1}
          >
            <KanbanSquare className="size-3.5 text-a-accent-700" strokeWidth={2.75} aria-hidden />
            <span className="flex-1">Add to quadrant</span>
            <ChevronRight className="size-3.5 text-a-faint" strokeWidth={2.75} aria-hidden />
          </button>
        )}
      </div>

      {/* Column 2: workspace */}
      {level >= 1 && !message && (
        <div className="border-l border-a-line-soft p-1.5" style={{ width: COL_W }} role="listbox" aria-label="Workspace">
          <ColumnHeader>Workspace</ColumnHeader>
          <div className="max-h-[264px] overflow-y-auto">
            {shownLists.length === 0 && <p className="px-2.5 pb-2 text-[13px] text-a-faint">No workspace matches</p>}
            {shownLists.map((l, i) => (
              <button
                key={l.id}
                type="button"
                role="option"
                aria-selected={i === listIdx}
                className={itemClass(i === listIdx)}
                onMouseEnter={() => { if (pending) return; setListIdx(i); setLevel(2); }}
                onClick={() => { setListIdx(i); setLevel(2); }}
              >
                <span className={cn('size-2 flex-shrink-0 rounded-full', getListColorDot(l.color))} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{l.name}</span>
                <ChevronRight className="size-3.5 text-a-faint" strokeWidth={2.75} aria-hidden />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Column 3: quadrant */}
      {level >= 2 && activeList && !message && (
        <div className="border-l border-a-line-soft p-1.5" style={{ width: COL_W }} role="listbox" aria-label={`Quadrant in ${activeList.name}`}>
          <ColumnHeader>Quadrant</ColumnHeader>
          {shownQuads.map((quad, i) => (
            <button
              key={quad.id}
              type="button"
              role="option"
              aria-selected={level === 2 && i === quadIdx}
              disabled={pending}
              className={itemClass(level === 2 && i === quadIdx)}
              onMouseEnter={() => setQuadIdx(i)}
              onClick={() => choose(quad.id)}
            >
              <span className={cn('size-2 flex-shrink-0 rounded-full', quad.dotClass)} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block leading-tight">{quad.label}</span>
                <span className="block text-[12px] leading-tight text-a-faint">{quad.subtitle}</span>
              </span>
              {pending && level === 2 && i === quadIdx && (
                <Loader2 className="size-3.5 animate-spin text-a-faint" aria-hidden />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
