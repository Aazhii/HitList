import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';

interface ViewLayoutContextValue {
  /** Opens the context column (mobile only, where it lives in a sheet). */
  openContext: () => void;
  /** Closes it — for example after choosing a list. No-op on desktop. */
  closeContext: () => void;
  /** On desktop, hides or shows a collapsible column. */
  toggleCollapsed: () => void;
  /** This view lets the column be hidden on desktop. */
  collapsible: boolean;
  collapsed: boolean;
}

export const ViewLayoutContext = createContext<ViewLayoutContextValue>({
  openContext: () => {},
  closeContext: () => {},
  toggleCollapsed: () => {},
  collapsible: false,
  collapsed: false,
});

export function useViewLayout() {
  return useContext(ViewLayoutContext);
}

const DESKTOP_QUERY = '(min-width: 768px)';

/** True at the `md` breakpoint and above, tracked live. */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(DESKTOP_QUERY).matches
      : true,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(DESKTOP_QUERY);
    const update = () => setIsDesktop(mql.matches);
    update();
    mql.addEventListener?.('change', update);
    return () => mql.removeEventListener?.('change', update);
  }, []);

  return isDesktop;
}

interface ViewLayoutProps {
  /** Names the context column for assistive tech, and titles the mobile sheet. */
  contextLabel: string;
  /** The 248px column: lists for Tasks, notes for Notes, filters for Automations. */
  context: ReactNode;
  /** Pinned to the foot of the context column. */
  contextFoot?: ReactNode;
  /** The 56px top bar. */
  topBar: ReactNode;
  /** When false, `children` manage their own scrolling. */
  scrollMain?: boolean;
  /** Lets the column be hidden on desktop from the top bar, for a wider main area. */
  collapsible?: boolean;
  children: ReactNode;
}

/**
 * The part of the shell that every view shares: a 248px context column, a 56px
 * top bar, and the view's content.
 *
 * Each view renders its own ViewLayout, so view state stays inside the view —
 * Notes keeps its notes hook to itself rather than having it lifted into App.
 *
 * Below `md` the context column moves into a sheet, opened from the top bar.
 * The column is mounted in exactly one place at a time: rendering it in both
 * the hidden desktop aside and the sheet would duplicate its state.
 */
export function ViewLayout({
  contextLabel,
  context,
  contextFoot,
  topBar,
  scrollMain = true,
  collapsible = false,
  children,
}: ViewLayoutProps) {
  const isDesktop = useIsDesktop();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Leaving the mobile layout must not strand an open sheet.
  useEffect(() => {
    if (isDesktop) setSheetOpen(false);
  }, [isDesktop]);

  const value = useMemo<ViewLayoutContextValue>(() => ({
    openContext: () => setSheetOpen(true),
    closeContext: () => setSheetOpen(false),
    toggleCollapsed: () => setCollapsed((c) => !c),
    collapsible,
    collapsed: collapsible && collapsed,
  }), [collapsible, collapsed]);

  const column = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pt-[18px] pb-3">{context}</div>
      {contextFoot && (
        <div className="flex-shrink-0 border-t border-a-line-soft px-1 pt-1 pb-3">{contextFoot}</div>
      )}
    </div>
  );

  return (
    <ViewLayoutContext.Provider value={value}>
      <div className="flex min-h-0 min-w-0 flex-1">
        {isDesktop && !(collapsible && collapsed) && (
          <aside
            aria-label={contextLabel}
            className="w-[248px] flex-shrink-0 border-r border-a-line bg-a-surface"
          >
            {column}
          </aside>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {topBar}
          {/* explicit overflow-x-hidden: per the CSS overflow spec, setting only
              overflow-y computes overflow-x to auto too, so a wide child (e.g. a
              Board view's columns) made this whole pane scroll horizontally as
              well, dragging the Table/Board ViewTabs bar in `children` off-screen
              along with it. */}
          <div className={cn('min-h-0 flex-1', scrollMain ? 'overflow-y-auto overflow-x-hidden' : 'overflow-hidden')}>
            {children}
          </div>
        </div>
      </div>

      {!isDesktop && (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="left" className="w-[280px] max-w-[85vw] gap-0 border-a-line bg-a-surface p-0">
            <SheetTitle className="sr-only">{contextLabel}</SheetTitle>
            <SheetDescription className="sr-only">Navigation for this view</SheetDescription>
            {column}
          </SheetContent>
        </Sheet>
      )}
    </ViewLayoutContext.Provider>
  );
}

// ── Context column primitives ─────────────────────────────────────────────────

/** A small icon button for the column, such as "New list". */
export const contextIconButton = cn(
  'flex size-[22px] items-center justify-center rounded-[4px] text-a-faint transition-colors duration-[120ms]',
  'hover:bg-a-row-hover hover:text-a-ink',
);

/** A 28px row, 4px radius — the showcase's literal sidebar-row metrics, not a pill. */
export function contextRowClass(active: boolean): string {
  return cn(
    'flex min-h-[28px] w-full items-center gap-2.5 rounded-[4px] px-2 text-left text-[14px] transition-colors duration-[120ms]',
    active ? 'bg-a-row-hover font-semibold text-a-ink' : 'text-a-muted hover:bg-a-row-hover hover:text-a-ink',
  );
}

/** The column's small uppercase section label, with an optional action beside it. */
export function ContextSectionHeader({ label, action }: { label: string; action?: ReactNode }) {
  return (
    <div className="mt-3 flex items-center justify-between px-2.5 py-1.5">
      <p className="text-[12px] font-medium text-a-faint">{label}</p>
      {action}
    </div>
  );
}
