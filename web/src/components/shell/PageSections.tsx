/**
 * The sidebar's Favorites and Recents (showcase 1336–1352): pages you starred, and the last few you
 * opened, each a row of emoji (or a list's colour dot) and name. A row's "⋯" opens the page menu.
 */
import { EllipsisIcon, EyeOff, Star, StarOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ContextSectionHeader, contextIconButton, contextRowClass } from '@/components/shell/ViewLayout';
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { RowMenuContent, RowMenuItem } from '@/components/shell/RowMenu';
import { pageKey, SIDEBAR_RECENTS, type PageInfo } from '@/lib/pages';

export interface PageSectionsProps {
  favorites: PageInfo[];
  recents: PageInfo[];
  /** The page on screen, so its row is marked. */
  activeKey?: string;
  isFavorite: (page: PageInfo) => boolean;
  onOpen: (page: PageInfo) => void;
  onToggleFavorite: (page: PageInfo) => void;
  onRemoveRecent: (page: PageInfo) => void;
  onViewAll: () => void;
}

export function PageSections({
  favorites, recents, activeKey, isFavorite, onOpen, onToggleFavorite, onRemoveRecent, onViewAll,
}: PageSectionsProps) {
  if (favorites.length === 0 && recents.length === 0) return null;
  const shown = recents.slice(0, SIDEBAR_RECENTS);

  const row = (page: PageInfo, section: 'fav' | 'rec') => (
    <li key={`${section}:${pageKey(page)}`} className="group relative">
      <button
        type="button"
        onClick={() => onOpen(page)}
        aria-current={activeKey === pageKey(page) ? 'true' : undefined}
        className={cn(contextRowClass(activeKey === pageKey(page)), 'pr-9')}
      >
        {page.dotClass
          ? <span className={cn('size-2 flex-shrink-0 rounded-full', page.dotClass)} aria-hidden />
          : <span className="w-4 flex-shrink-0 text-center text-[14px] leading-none" aria-hidden>{page.emoji ?? '📄'}</span>}
        <span className="min-w-0 flex-1 truncate">{page.name}</span>
      </button>
      <div className="absolute top-1/2 right-2 -translate-y-1/2 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 group-focus-within:opacity-100 has-[[data-state=open]]:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={contextIconButton} aria-label={`Options for ${page.name}`}>
              <EllipsisIcon className="size-4" strokeWidth={1.75} />
            </button>
          </DropdownMenuTrigger>
          <RowMenuContent
            caption="Page"
            footer={page.editedAt ? <>Last edited by You<br />{new Date(page.editedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</> : undefined}
          >
            <RowMenuItem
              icon={isFavorite(page) ? StarOff : Star}
              label={isFavorite(page) ? 'Remove from Favorites' : 'Add to Favorites'}
              onSelect={() => onToggleFavorite(page)}
            />
            {section === 'rec' && <RowMenuItem icon={EyeOff} label="Remove from Recents" onSelect={() => onRemoveRecent(page)} />}
          </RowMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );

  return (
    <div className="mb-3">
      {favorites.length > 0 && (
        <>
          <ContextSectionHeader label="Favorites" />
          <ul className="space-y-0.5 px-1">{favorites.map((p) => row(p, 'fav'))}</ul>
        </>
      )}
      {shown.length > 0 && (
        <>
          <ContextSectionHeader label="Recents" />
          <ul className="space-y-0.5 px-1">
            {shown.map((p) => row(p, 'rec'))}
            <li>
              <button type="button" onClick={onViewAll} className={contextRowClass(false)}>
                <EllipsisIcon className="size-4 flex-shrink-0" strokeWidth={1.75} aria-hidden />
                <span>View all</span>
              </button>
            </li>
          </ul>
        </>
      )}
    </div>
  );
}
