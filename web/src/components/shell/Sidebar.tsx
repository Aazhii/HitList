import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CalendarCheck, CalendarDays, FileCode2, Leaf, PanelLeftClose, PanelLeftOpen, Sun, ListChecks, Search, StickyNote, Table2, UserCheck, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useIsDesktop } from '@/components/shell/ViewLayout';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { useSidebarMode } from '@/lib/sidebarMode';

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
  const [peek, setPeek] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const bodyProps = { activeView, onViewChange, counts, context, contextFoot, pages, onSearch, workspace };

  const show = useCallback(() => { clearTimeout(closeTimer.current); setPeek(false); setMode('shown'); }, [setMode]);
  const hide = useCallback(() => { clearTimeout(closeTimer.current); setPeek(false); setMode('hidden'); }, [setMode]);

  // Ctrl/Cmd + \ hides the sidebar, or shows it again.
  useEffect(() => {
    if (!isDesktop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '\\' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      e.preventDefault();
      if (mode === 'hidden') show(); else hide();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDesktop, mode, show, hide]);

  // Hidden, as in Notion: a button in the page header's left gutter brings it back (a click keeps it open), and merely pointing at
  // that button or the left edge slides it in over the page until the pointer leaves.
  if (isDesktop && mode === 'hidden') {
    const open = () => { clearTimeout(closeTimer.current); setPeek(true); };
    const close = () => { clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setPeek(false), 250); };
    return (
      <>
        <button
          type="button"
          aria-label="Show sidebar"
          title="Show sidebar (Ctrl/Cmd + \)"
          onClick={show}
          onMouseEnter={open}
          onMouseLeave={close}
          className="fixed left-2 top-[6px] z-30 flex size-8 items-center justify-center rounded-[4px] text-a-muted transition-colors duration-[120ms] hover:bg-a-row-hover hover:text-a-ink"
        >
          <PanelLeftOpen className="size-[17px]" strokeWidth={1.75} aria-hidden />
        </button>
        <div aria-hidden data-testid="sidebar-hot-edge" className="fixed inset-y-0 left-0 z-40 w-1.5" onMouseEnter={open} onMouseLeave={close} />
        <aside
          aria-label="Sidebar"
          aria-hidden={!peek}
          onMouseEnter={open}
          onMouseLeave={close}
          onFocus={open}
          className={cn(
            'fixed inset-y-1 left-1 z-50 flex w-[248px] flex-col overflow-hidden rounded-[8px] border border-a-line bg-a-bg shadow-[var(--a-shadow-xl)] transition-[transform,visibility] duration-[120ms]',
            peek ? 'visible translate-x-0' : 'invisible -translate-x-[260px]',
          )}
        >
          <SidebarBody {...bodyProps} />
        </aside>
      </>
    );
  }

  if (isDesktop) {
    return (
      <aside aria-label="Sidebar" className="flex h-full w-[248px] flex-shrink-0 flex-col border-r border-a-line bg-a-bg">
        <SidebarBody {...bodyProps} onCollapse={hide} />
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

function SidebarBody({ activeView, onViewChange, counts, context, contextFoot, pages, onSearch, workspace, onCollapse }: Omit<SidebarProps, 'mobileOpen' | 'onMobileOpenChange'> & { onCollapse?: () => void }) {
  const shared = useWorkspaces();
  const views = VIEWS.filter((v) => v.id !== 'assigned' || (shared.available && shared.workspaces.length > 0));
  return (
    <div className="group/side flex h-full min-h-0 flex-col">
      {/* Logo / workspace row; the hide button shows while the pointer is over the sidebar, as in Notion. */}
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
        {onCollapse && (
          <button
            type="button"
            aria-label="Hide sidebar"
            title="Hide sidebar (Ctrl/Cmd + \)"
            onClick={onCollapse}
            className="flex size-6 flex-shrink-0 items-center justify-center rounded-[4px] text-a-faint opacity-0 transition-[opacity,background-color] duration-[120ms] hover:bg-a-row-hover hover:text-a-ink focus-visible:opacity-100 group-hover/side:opacity-100"
          >
            <PanelLeftClose className="size-[17px]" strokeWidth={1.75} aria-hidden />
          </button>
        )}
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
    </div>
  );
}
