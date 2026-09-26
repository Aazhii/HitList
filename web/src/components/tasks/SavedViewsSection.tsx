/**
 * Saved views, above the lists in the tasks context column.
 *
 * A view is a named filter, sort, layout and — optionally — list. Picking one
 * applies all of that at once. The row shows as current whenever the screen
 * matches the view, so it is never lit while showing something else.
 */
import { useEffect, useRef, useState } from 'react';
import { Bookmark, MoreHorizontal, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ApiSavedView } from '@/lib/api';
import { getListColorDot, type KaizenList } from '@/types/todo';
import {
  ContextSectionHeader,
  contextIconButton,
  contextRowClass,
  useViewLayout,
} from '@/components/shell/ViewLayout';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface SavedViewsSectionProps {
  views: ApiSavedView[];
  lists: KaizenList[];
  activeViewId: string | null;
  online: boolean;
  onApply: (view: ApiSavedView) => void;
  onRename: (view: ApiSavedView, name: string) => void;
  onUpdateToCurrent: (view: ApiSavedView) => void;
  onDelete: (view: ApiSavedView) => void;
}

export function SavedViewsSection({
  views, lists, activeViewId, online, onApply, onRename, onUpdateToCurrent, onDelete,
}: SavedViewsSectionProps) {
  const { closeContext } = useViewLayout();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (renamingId) renameRef.current?.focus(); }, [renamingId]);

  const commitRename = (view: ApiSavedView) => {
    const name = renameValue.trim();
    if (name && name !== view.name) onRename(view, name);
    setRenamingId(null);
  };

  return (
    <div className="mb-5">
      <ContextSectionHeader label="Views" />

      {views.length === 0 ? (
        <p className="px-3 pb-1 text-[12.5px] leading-relaxed text-a-faint">
          Set a filter, then use <span className="font-semibold">Save as view</span> to keep it here.
        </p>
      ) : (
        <ul className="space-y-0.5">
          {views.map((view) => {
            const active = view.id === activeViewId;
            const list = view.scopeListId ? lists.find((l) => l.id === view.scopeListId) : undefined;

            if (renamingId === view.id) {
              return (
                <li key={view.id} className={contextRowClass(true)}>
                  <Bookmark className="size-3.5 flex-shrink-0 text-a-accent-700" strokeWidth={2.75} aria-hidden />
                  <input
                    ref={renameRef}
                    value={renameValue}
                    maxLength={100}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(view)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(view);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    className="min-w-0 flex-1 border-b border-a-accent bg-transparent text-[14.5px] font-semibold text-a-ink outline-none"
                    aria-label="Rename view"
                  />
                </li>
              );
            }

            return (
              <li key={view.id} className="group relative">
                <button
                  type="button"
                  onClick={() => { onApply(view); closeContext(); }}
                  aria-current={active ? 'true' : undefined}
                  className={contextRowClass(active)}
                  title={list ? `Opens ${list.name}` : undefined}
                >
                  <Bookmark
                    className={cn('size-3.5 flex-shrink-0', active ? 'text-a-accent-700' : 'text-a-faint')}
                    strokeWidth={2.75}
                    aria-hidden
                  />
                  <span className={cn('min-w-0 flex-1 truncate text-[14.5px]', active ? 'font-semibold text-a-ink' : 'text-a-muted')}>
                    {view.name}
                  </span>
                  {list && (
                    <span
                      className={cn('size-2 flex-shrink-0 rounded-full transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0 group-has-[[data-state=open]]:opacity-0', getListColorDot(list.color))}
                      aria-label={`In ${list.name}`}
                    />
                  )}
                </button>

                <div className="absolute top-1/2 right-2 -translate-y-1/2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 has-[[data-state=open]]:opacity-100">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className={contextIconButton} aria-label={`Options for ${view.name}`}>
                        <MoreHorizontal className="size-3.5" strokeWidth={2.75} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem onClick={() => { setRenamingId(view.id); setRenameValue(view.name); }}>
                        <Pencil className="size-3.5" /> Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onUpdateToCurrent(view)}>
                        <RefreshCw className="size-3.5" /> Update to current filters
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={() => onDelete(view)}>
                        <Trash2 className="size-3.5" /> Delete view
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!online && views.length > 0 && (
        <p className="px-3 pt-1.5 text-[12px] text-a-faint">Saved on this device only while offline.</p>
      )}
    </div>
  );
}
