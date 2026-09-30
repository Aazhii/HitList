/**
 * The ⌘K palette: one box that finds a list, database, note or task and opens it.
 * ↑/↓ move, ↵ opens, Esc closes. Rows are 28px like every other menu row.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckSquare, ListChecks, Search, StickyNote, Table2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { PALETTE_KIND_LABEL, searchPalette, type PaletteItem, type PaletteKind } from '@/lib/paletteSearch';

const KIND_ICON: Record<PaletteKind, typeof Search> = {
  task: CheckSquare, note: StickyNote, database: Table2, list: ListChecks,
};

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Read when the palette opens, so it is always current. */
  getItems: () => PaletteItem[] | Promise<PaletteItem[]>;
  onOpenItem: (item: PaletteItem) => void;
}

export function CommandPalette({ open, onOpenChange, getItems, onOpenItem }: CommandPaletteProps) {
  const [items, setItems] = useState<PaletteItem[]>([]);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setIndex(0);
    let live = true;
    void Promise.resolve(getItems()).then((got) => { if (live) setItems(got); });
    return () => { live = false; };
  }, [open, getItems]);

  const groups = useMemo(() => searchPalette(items, query), [items, query]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => { setIndex(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const choose = (item: PaletteItem | undefined) => {
    if (!item) return;
    onOpenChange(false);
    onOpenItem(item);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => (flat.length ? (i + 1) % flat.length : 0)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0)); }
    if (e.key === 'Enter') { e.preventDefault(); choose(flat[index]); }
  };

  let flatIndex = -1;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[18vh] max-w-[560px] translate-y-0 gap-0 rounded-[12px] p-0 sm:max-w-[560px]"
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">Find a list, database, note or task and open it</DialogDescription>
        <div className="flex items-center gap-2.5 border-b border-a-line-soft px-4">
          <Search className="size-4 flex-shrink-0 text-a-faint" strokeWidth={1.75} aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search tasks, notes, databases and lists"
            aria-label="Search"
            role="combobox"
            aria-expanded
            aria-controls="palette-results"
            className="h-12 min-w-0 flex-1 bg-transparent text-[14px] text-a-ink outline-none placeholder:text-a-faint"
          />
          <kbd className="font-mono text-[11px] text-a-faint">Esc</kbd>
        </div>

        <div ref={listRef} id="palette-results" role="listbox" aria-label="Results" className="max-h-[360px] overflow-y-auto p-1.5">
          {groups.length === 0 && (
            <p className="px-3 py-6 text-center text-[13px] text-a-faint">
              {query.trim() ? `Nothing matches “${query.trim()}”.` : 'Nothing to search yet.'}
            </p>
          )}
          {groups.map((g) => (
            <div key={g.kind} role="group" aria-label={PALETTE_KIND_LABEL[g.kind]}>
              <p className="px-2.5 py-1.5 text-[12px] font-medium text-a-faint">{PALETTE_KIND_LABEL[g.kind]}</p>
              {g.items.map((item) => {
                flatIndex += 1;
                const mine = flatIndex;
                const Icon = KIND_ICON[item.kind];
                return (
                  <button
                    key={`${item.kind}:${item.id}`}
                    type="button"
                    role="option"
                    aria-selected={mine === index}
                    onMouseMove={() => setIndex(mine)}
                    onClick={() => choose(item)}
                    className={cn(
                      'flex min-h-[28px] w-full items-center gap-2.5 rounded-[4px] px-2 py-[3px] text-left text-[14px] text-a-ink',
                      mine === index && 'bg-a-line-soft',
                    )}
                  >
                    {item.emoji
                      ? <span className="w-4 flex-shrink-0 text-center text-[14px] leading-none" aria-hidden>{item.emoji}</span>
                      : <Icon className="size-4 flex-shrink-0 text-a-muted" strokeWidth={1.75} aria-hidden />}
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    {item.hint && <span className="flex-shrink-0 text-[12px] text-a-faint">{item.hint}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <p className="border-t border-a-line-soft px-4 py-2 text-[11px] text-a-faint">↑↓ to move · ↵ to open · esc to close</p>
      </DialogContent>
    </Dialog>
  );
}
