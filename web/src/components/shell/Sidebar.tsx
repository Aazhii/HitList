import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CalendarCheck, CalendarDays, FileCode2, Leaf, PanelLeft, Sun, ListChecks, Search, StickyNote, Table2, UserCheck, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useIsDesktop } from '@/components/shell/ViewLayout';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import {
  SIDEBAR_COLLAPSE_AT,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  clampSidebarWidth,
  useSidebarMode,
  useSidebarWidth,
} from '@/lib/sidebarMode';

export type AppView = 'tasks' | 'notes' | 'notepad' | 'databases' | 'calendar' | 'automations' | 'library' | 'today' | 'assigned' | 'weekly';

const VIEWS: ReadonlyArray<{ id: AppView; label: string; icon: typeof ListChecks }> = [
  // The front door: the one task to do next.
  { id: 'today', label: 'Today', icon: Sun },
  { id: 'tasks', label: 'Tasks', icon: ListChecks },
  // Only shown when there are shared workspaces to be assigned in.
  { id: 'assigned', label: 'Assigned to me', icon: UserCheck },
  { id: 'notes', label: 'Notes', icon: StickyNote },
  // Code and text files, with colours for each language; they are kept as notes.
  { id: 'notepad', label: 'Notepad', icon: FileCode2 },
  { id: 'databases', label: 'Databases', icon: Table2 },
  // One calendar for everything that has a date: tasks and database records.
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'automations', label: 'Automations', icon: Zap },
  // What moved this week, and the prompt that turns it into the Monday update.
  { id: 'weekly', label: 'Weekly update', icon: CalendarCheck },
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
  /** The workspace row at the top (the switcher); the plain app name when omitted. */
  workspace?: ReactNode;
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
  workspace,
  mobileOpen,
  onMobileOpenChange,
}: SidebarProps) {
  const isDesktop = useIsDesktop();

  // Leaving the mobile layout must not strand an open sheet.
  useEffect(() => {
    if (isDesktop) onMobileOpenChange(false);
  }, [isDesktop, onMobileOpenChange]);

  const [mode, setMode] = useSidebarMode();
  const [width, setWidth] = useSidebarWidth();
  // While the edge is being dragged: the raw width the pointer asks for, before it is clamped or snapped shut.
  const [dragging, setDragging] = useState<number | null>(null);

  const bodyProps = { activeView, onViewChange, counts, context, contextFoot, pages, onSearch, workspace };

  // Below the collapse point the sidebar snaps shut while you are still dragging, as in IntelliJ, so you can see what you get.
  const live = dragging === null ? (mode === 'hidden' ? 0 : width) : (dragging < SIDEBAR_COLLAPSE_AT ? 0 : clampSidebarWidth(dragging));
  const collapsed = live === 0;

  const toggle = useCallback(() => setMode(mode === 'hidden' ? 'shown' : 'hidden'), [mode, setMode]);

  // Ctrl/Cmd + \ hides the sidebar, or shows it again — the same shortcut Postman uses.
  useEffect(() => {
    if (!isDesktop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '\\' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDesktop, toggle]);

  const startDrag = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = mode === 'hidden' ? 0 : width;
    let last = startWidth;
    const onMove = (ev: MouseEvent) => {
      last = Math.max(0, startWidth + (ev.clientX - startX));
      setDragging(last);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.classList.remove('is-resizing-sidebar');
      setDragging(null);
      if (last < SIDEBAR_COLLAPSE_AT) setMode('hidden');
      else { setWidth(last); setMode('shown'); }
    };
    document.body.classList.add('is-resizing-sidebar');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [mode, width, setMode, setWidth]);

  // The keyboard way to do the same: arrows resize, and going under the collapse point closes it.
  const onHandleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = (mode === 'hidden' ? 0 : width) + (e.key === 'ArrowRight' ? 16 : -16);
    if (next < SIDEBAR_COLLAPSE_AT) setMode('hidden');
    else { setWidth(next); setMode('shown'); }
  }, [mode, width, setMode, setWidth]);

  const handle = isDesktop && (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={live}
      aria-valuemin={0}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      tabIndex={0}
      data-testid="sidebar-resize"
      onMouseDown={startDrag}
      onKeyDown={onHandleKey}
      // Double-click resets, the way a column divider does.
      onDoubleClick={() => { setWidth(SIDEBAR_DEFAULT_WIDTH); setMode('shown'); }}
      className={cn(
        'z-30 w-1.5 cursor-col-resize transition-colors duration-[120ms] hover:bg-a-accent/40 focus-visible:bg-a-accent/40',
        collapsed ? 'fixed inset-y-0 left-0' : 'absolute inset-y-0 -right-[3px]',
      )}
    />
  );

  // The toggle sits at the bottom left in both states, as in Postman, so it never moves and nothing can cover it.
  const toggleButton = isDesktop && collapsed && (
    <button
      type="button"
      aria-label="Toggle sidebar"
      title="Toggle left sidebar (Ctrl/Cmd + \)"
      onClick={toggle}
      className="fixed bottom-2 left-2 z-30 flex size-8 items-center justify-center rounded-[4px] border border-a-line bg-a-bg text-a-muted shadow-[var(--a-shadow-sm)] transition-colors duration-[120ms] hover:bg-a-row-hover hover:text-a-ink"
    >
      <PanelLeft className="size-[17px]" strokeWidth={1.75} aria-hidden />
    </button>
  );

  if (isDesktop) {
    if (collapsed) {
      return <>{handle}{toggleButton}</>;
    }
    return (
      <aside
        aria-label="Sidebar"
        style={{ width: live }}
        className={cn(
          'relative flex h-full flex-shrink-0 flex-col border-r border-a-line bg-a-bg',
          dragging === null && 'transition-[width] duration-[120ms]',
        )}
      >
        <SidebarBody {...bodyProps} onToggle={toggle} />
        {handle}
      </aside>
    );
  }

  return (
    <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
      <SheetContent side="left" className="w-[280px] max-w-[85vw] gap-0 border-a-line bg-a-bg p-0">
        <SheetTitle className="sr-only">Sidebar</SheetTitle>
        <SheetDescription className="sr-only">Navigation and this view's sections</SheetDescription>
        <SidebarBody {...bodyProps} />
      </SheetContent>
    </Sheet>
  );
}

function SidebarBody({ activeView, onViewChange, counts, context, contextFoot, pages, onSearch, workspace, onToggle }: Omit<SidebarProps, 'mobileOpen' | 'onMobileOpenChange'> & { onToggle?: () => void }) {
  const shared = useWorkspaces();
  const views = VIEWS.filter((v) => v.id !== 'assigned' || (shared.available && shared.workspaces.length > 0));
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Logo / workspace row. */}
      <div className="flex min-w-0 flex-shrink-0 items-center gap-2 px-3.5 pt-3 pb-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {workspace ?? (
            <>
              <span className="flex size-[22px] flex-shrink-0 items-center justify-center rounded-[4px] bg-a-accent" aria-hidden>
                <Leaf className="size-[13px] text-white" strokeWidth={1.75} />
              </span>
              <span className="text-[14px] font-semibold text-a-ink">HitList</span>
            </>
          )}
        </div>
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
        {views.map(({ id, label, icon: Icon }) => {
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
      {/* Each section header carries 12px above it (the prototype's rhythm); -mt-2 takes back the nav's own bottom padding for the first. */}
      <div className="-mt-1.5 min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3">{context}{pages}</div>

      {contextFoot && (
        <div className="flex-shrink-0 border-t border-a-line-soft p-3">{contextFoot}</div>
      )}

      {/* The toggle lives at the bottom left, as in Postman: always in the same place, whether the sidebar is open or shut. */}
      {onToggle && (
        <div className="flex flex-shrink-0 items-center border-t border-a-line-soft px-2 py-1.5">
          <button
            type="button"
            aria-label="Toggle sidebar"
            title="Toggle left sidebar (Ctrl/Cmd + \)"
            onClick={onToggle}
            className="flex size-7 items-center justify-center rounded-[4px] text-a-faint transition-colors duration-[120ms] hover:bg-a-row-hover hover:text-a-ink"
          >
            <PanelLeft className="size-[17px]" strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
