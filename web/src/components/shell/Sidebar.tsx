import { useEffect, useState, type ReactNode } from 'react';
import { CalendarDays, Leaf, Sun, ListChecks, Search, StickyNote, Table2, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useIsDesktop } from '@/components/shell/ViewLayout';

export type AppView = 'tasks' | 'notes' | 'databases' | 'calendar' | 'automations' | 'library' | 'today';

const VIEWS: ReadonlyArray<{ id: AppView; label: string; icon: typeof ListChecks }> = [
  // The front door: the one task to do next.
  { id: 'today', label: 'Today', icon: Sun },
  { id: 'tasks', label: 'Tasks', icon: ListChecks },
  { id: 'notes', label: 'Notes', icon: StickyNote },
  { id: 'databases', label: 'Databases', icon: Table2 },
  // One calendar for everything that has a date: tasks and database records.
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'automations', label: 'Automations', icon: Zap },
];

export interface SidebarProps {
  activeView: AppView;
  onViewChange: (view: AppView) => void;
  /** A count badge per nav row, e.g. open task count. Omitted rows show no badge. */
  counts?: Partial<Record<AppView, number>>;
  /** The active view's own sections below the primary nav: lists, notes, databases, calendar sources. */
  context: ReactNode;
  /** Pinned to the foot of the sidebar, e.g. Tasks' momentum card. */
  contextFoot?: ReactNode;
  /** Favorites and Recents, under the view's own sections. */
  pages?: ReactNode;
  /** Opens the ⌘K palette. */
  onSearch?: () => void;
  /** Whether the sidebar's mobile sheet is open, and how to change that. */
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}

/**
 * The one 248px sidebar every view shares: logo/workspace row, a search row,
 * the primary nav (with per-view count badges), then that view's own
 * contextual sections.
 *
 * Replaces the old pairing of a 64px icon-only rail (primary nav, all views)
 * plus a separate 248px context column that only Tasks used — Notes,
 * Databases and Calendar built their own full-page layout instead. This is
 * the one sidebar for every view, matching `HitList Notion x Zoho.dc.html`
 * lines 38–106.
 *
 * Below `md` it moves into a sheet, opened from the top header.
 */
export function Sidebar({
  activeView,
  onViewChange,
  counts,
  context,
  contextFoot,
  pages,
  onSearch,
  mobileOpen,
  onMobileOpenChange,
}: SidebarProps) {
  const isDesktop = useIsDesktop();

  // Leaving the mobile layout must not strand an open sheet.
  useEffect(() => {
    if (isDesktop) onMobileOpenChange(false);
  }, [isDesktop, onMobileOpenChange]);

  const body = <SidebarBody activeView={activeView} onViewChange={onViewChange} counts={counts} context={context} contextFoot={contextFoot} pages={pages} onSearch={onSearch} />;

  if (isDesktop) {
    return (
      <aside aria-label="Sidebar" className="flex h-full w-[248px] flex-shrink-0 flex-col border-r border-a-line bg-a-bg">
        {body}
      </aside>
    );
  }

  return (
    <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
      <SheetContent side="left" className="w-[280px] max-w-[85vw] gap-0 border-a-line bg-a-bg p-0">
        <SheetTitle className="sr-only">Sidebar</SheetTitle>
        <SheetDescription className="sr-only">Navigation and this view's sections</SheetDescription>
        {body}
      </SheetContent>
    </Sheet>
  );
}

function SidebarBody({ activeView, onViewChange, counts, context, contextFoot, pages, onSearch }: Omit<SidebarProps, 'mobileOpen' | 'onMobileOpenChange'>) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Logo / workspace row */}
      <div className="flex flex-shrink-0 items-center gap-2 px-3.5 pt-3 pb-1.5">
        <span className="flex size-[22px] flex-shrink-0 items-center justify-center rounded-[4px] bg-a-accent" aria-hidden>
          <Leaf className="size-[13px] text-white" strokeWidth={1.75} />
        </span>
        <span className="text-[14px] font-semibold text-a-ink">HitList</span>
      </div>

      {/* Search row: opens the ⌘K palette. */}
      <div className="flex-shrink-0 px-2">
        <button
          type="button"
          onClick={onSearch}
          className="flex min-h-[28px] w-full items-center gap-2 rounded-[4px] px-2 text-left text-[14px] text-a-muted transition-colors duration-[120ms] hover:bg-a-row-hover"
        >
          <Search className="size-4" strokeWidth={1.75} />
          <span className="flex-1">Search</span>
          <span className="font-mono text-[11px] text-a-faint">Ctrl K</span>
        </button>
      </div>

      {/* Primary nav */}
      <nav aria-label="Views" className="flex flex-shrink-0 flex-col gap-[1px] px-2 pt-1.5 pb-2">
        {VIEWS.map(({ id, label, icon: Icon }) => {
          const active = id === activeView;
          const count = counts?.[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => onViewChange(id)}
              aria-current={active ? 'page' : undefined}
              style={active ? { backgroundColor: 'rgba(55,53,47,0.08)' } : undefined}
              className={cn(
                'flex min-h-[28px] w-full items-center gap-2.5 rounded-[4px] px-2 text-left text-[14px] transition-colors duration-[120ms]',
                active ? 'font-semibold text-a-ink' : 'text-a-muted hover:bg-a-row-hover hover:text-a-ink',
              )}
            >
              <Icon className="size-[17px] flex-shrink-0" strokeWidth={1.75} />
              <span className="flex-1">{label}</span>
              {/* Hidden on the active view — a count for where you already are is noise. */}
              {!active && count !== undefined && count > 0 && (
                <span className="font-mono text-[11px] text-a-faint">{count}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* This view's own contextual sections. */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3">{context}{pages}</div>

      {contextFoot && (
        <div className="flex-shrink-0 border-t border-a-line-soft p-3">{contextFoot}</div>
      )}
    </div>
  );
}
