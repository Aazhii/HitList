/**
 * The library (showcase 831–869): every page you can open — task lists, notes, databases — in one
 * table, with tabs for Recents, Favorites, each kind, and All. Opening a row goes to the page.
 */
import { useMemo, useState } from 'react';
import { Clock, File, Layers, ListChecks, Navigation, Plus, Search, Star, StickyNote, Table2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TopBar, topBarPrimary } from '@/components/shell/TopBar';
import { ViewLayoutContext } from '@/components/shell/ViewLayout';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  PAGE_KIND_LABEL, agoLabel, libraryPages, pageKey, type LibraryTab, type PageInfo, type PageRef,
} from '@/lib/pages';
import type { Recent } from '@/hooks/usePageMarks';
import type { PageKind } from '@/lib/api';

const TABS: ReadonlyArray<{ id: LibraryTab; label: string; icon: typeof Clock }> = [
  { id: 'recents', label: 'Recents', icon: Clock },
  { id: 'favorites', label: 'Favorites', icon: Star },
  { id: 'notes', label: 'Notes', icon: StickyNote },
  { id: 'lists', label: 'Lists', icon: ListChecks },
  { id: 'databases', label: 'Databases', icon: Table2 },
  { id: 'all', label: 'All pages', icon: Layers },
];

const SOURCE_ICON: Record<PageKind, typeof File> = { list: ListChecks, note: StickyNote, database: Table2 };

const COLS = [
  { name: 'Page name', icon: File, w: 340 },
  { name: 'Source', icon: Navigation, w: 200 },
  { name: 'Last edited time', icon: Clock, w: 140 },
  { name: 'Last visited time', icon: Clock, w: 140 },
] as const;

export interface LibraryPageProps {
  directory: PageInfo[];
  favorites: PageRef[];
  recents: Recent[];
  initialTab?: LibraryTab;
  onOpen: (page: PageInfo) => void;
  onCreate: (kind: PageKind) => void;
  /** The Source cell: go to that kind's own view. */
  onOpenSource: (kind: PageKind) => void;
  onOpenSidebar?: () => void;
}

export function LibraryPage({ directory, favorites, recents, initialTab = 'recents', onOpen, onCreate, onOpenSource, onOpenSidebar }: LibraryPageProps) {
  const [tab, setTab] = useState<LibraryTab>(initialTab);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const rows = useMemo(() => {
    const all = libraryPages(tab, directory, favorites, recents);
    const q = search.trim().toLowerCase();
    return q ? all.filter((p) => p.name.toLowerCase().includes(q)) : all;
  }, [tab, directory, favorites, recents, search]);
  // Visit time for every tab, not just Recents.
  const visited = useMemo(() => new Map(recents.map((r) => [pageKey(r), r.visitedAt])), [recents]);

  return (
    <ViewLayoutContext.Provider value={{
      openContext: () => onOpenSidebar?.(),
      closeContext: () => {},
      toggleCollapsed: () => {},
      collapsible: false,
      collapsed: false,
    }}>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <TopBar
        title="Library"
        subtitle={`${rows.length} page${rows.length === 1 ? '' : 's'}`}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={topBarPrimary}>
                <Plus className="size-[15px]" strokeWidth={1.75} aria-hidden />
                New page
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" role="menu" aria-label="New page" className="w-[220px] rounded-[8px] shadow-[var(--a-shadow-xl)]">
              {([['note', StickyNote, 'Note'], ['list', ListChecks, 'Task list'], ['database', Table2, 'Database']] as const).map(([kind, Icon, label]) => (
                <DropdownMenuItem key={kind} onSelect={() => onCreate(kind)} className="min-h-8 px-2.5 py-1.5">
                  <Icon className="size-4 text-a-muted" strokeWidth={1.75} aria-hidden />
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="px-4 pt-4 pb-12 md:px-12">
          <div role="tablist" aria-label="Show" className="mb-2 flex h-9 items-center gap-1">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cn(
                  'inline-flex h-8 items-center gap-2 rounded-[8px] px-3 text-[14px] whitespace-nowrap transition-colors duration-[120ms]',
                  tab === id ? 'bg-a-blue-tint font-semibold text-a-accent' : 'font-medium text-a-faint hover:bg-a-line-soft',
                )}
              >
                <Icon className="size-4" strokeWidth={1.75} aria-hidden />
                {label}
              </button>
            ))}
            <div className="flex-1" />
            {searching && (
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { setSearch(''); setSearching(false); } }}
                placeholder="Search pages"
                aria-label="Search pages"
                className="h-7 w-[200px] rounded-[3px] border border-a-line-strong bg-a-surface px-2.5 text-[13px] text-a-ink outline-none placeholder:text-a-faint focus-visible:border-a-accent"
              />
            )}
            <button
              type="button"
              aria-label="Search pages"
              onClick={() => { setSearching((o) => !o); if (searching) setSearch(''); }}
              className={cn('flex size-7 items-center justify-center rounded-[4px] text-a-muted transition-colors duration-[120ms] hover:bg-a-line-soft hover:text-a-ink', searching && 'bg-a-blue-tint text-a-accent')}
            >
              <Search className="size-4" strokeWidth={1.75} />
            </button>
          </div>

          <div className="-mx-4 overflow-x-auto border-t border-a-line md:-mx-12">
            <div className="box-content w-[820px] px-4 md:px-12">
              <div className="flex h-9 border-b border-a-line bg-a-bg" role="row">
                {COLS.map(({ name, icon: Icon, w }) => (
                  <div key={name} role="columnheader" style={{ width: w }} className="box-border flex flex-none items-center gap-1.5 border-r border-a-line-soft px-2 text-[13px] font-semibold text-a-ink">
                    <Icon className="size-[15px] text-a-faint" strokeWidth={1.75} aria-hidden />
                    {name}
                  </div>
                ))}
              </div>

              {rows.map((page) => {
                const SourceIcon = SOURCE_ICON[page.kind];
                return (
                  <div key={pageKey(page)} role="row" className="group flex min-h-10 border-b border-a-line-soft hover:bg-a-row-alt">
                    <button
                      type="button"
                      onClick={() => onOpen(page)}
                      className="box-border flex w-[340px] flex-none items-center gap-2.5 border-r border-a-line-soft px-2 text-left"
                    >
                      {page.dotClass
                        ? <span className={cn('mx-[3px] size-2.5 flex-none rounded-full', page.dotClass)} aria-hidden />
                        : <span className="w-4 flex-none text-center" aria-hidden>{page.emoji ?? '📄'}</span>}
                      <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-a-ink">{page.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenSource(page.kind)}
                      className="box-border flex w-[200px] flex-none items-center gap-2 border-r border-a-line-soft px-2 text-left text-[14px] text-a-ink"
                    >
                      <SourceIcon className="size-4 text-a-muted" strokeWidth={1.75} aria-hidden />
                      <span className="underline decoration-a-line-strong underline-offset-[3px]">{PAGE_KIND_LABEL[page.kind]}</span>
                    </button>
                    <div className="box-border flex w-[140px] flex-none items-center border-r border-a-line-soft px-2 text-[14px] text-a-ink">
                      {agoLabel(page.editedAt) || <span className="text-a-faint">—</span>}
                    </div>
                    <div className="box-border flex w-[140px] flex-none items-center px-2 text-[14px] text-a-ink">
                      {agoLabel(visited.get(pageKey(page))) || <span className="text-a-faint">—</span>}
                    </div>
                  </div>
                );
              })}

              {rows.length === 0 && (
                <p className="px-2 py-7 text-a-faint">
                  {tab === 'favorites'
                    ? 'Nothing here yet. Star a page to see it under Favorites.'
                    : tab === 'recents' ? 'Nothing here yet. Pages you open show up here.' : 'Nothing here yet.'}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
    </ViewLayoutContext.Provider>
  );
}
