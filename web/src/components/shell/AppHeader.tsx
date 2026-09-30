import type { ReactNode } from 'react';
import { CircleHelp, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AppHeaderProps {
  /** "Tasks", "Notes" … */
  crumb1: string;
  /** The active list/note/database name, or a date range for Calendar. */
  crumb2?: string;
  /** Small always-on sync indicator — a dot + short label, never a banner. */
  sync: { tone: 'success' | 'warning' | 'danger'; label: string };
  /** The bell, already wired to its own data — just placed here. */
  bell?: ReactNode;
  /** The account avatar button (UserMenu). */
  account: ReactNode;
  /** Opens the sidebar sheet on mobile. */
  onOpenSidebar: () => void;
}

const SYNC_DOT_CLASS: Record<AppHeaderProps['sync']['tone'], string> = {
  success: 'bg-a-sage',
  warning: 'bg-a-tag-yellow',
  danger: 'bg-a-tag-red',
};

/**
 * The 44px row above every page header: breadcrumb, sync status, bell, help,
 * account — matches `HitList Notion x Zoho.dc.html` lines 107–114.
 *
 * Sits above `TopBar` (the page-header block: title/subtitle/tabs/actions),
 * which is unchanged — this is new chrome, not a TopBar replacement.
 */
export function AppHeader({ crumb1, crumb2, sync, bell, account, onOpenSidebar }: AppHeaderProps) {
  return (
    // 44px, and the content column starts 48px in — showcase 108.
    <header className="flex h-11 flex-shrink-0 items-center gap-2 px-3 md:pr-3 md:pl-12">
      <button
        type="button"
        onClick={onOpenSidebar}
        className="-ml-1 flex size-8 flex-shrink-0 items-center justify-center rounded-[4px] text-a-muted transition-colors duration-[120ms] hover:bg-a-row-hover hover:text-a-ink md:hidden"
        aria-label="Open sidebar"
      >
        <Menu className="size-[17px]" strokeWidth={1.75} />
      </button>

      {/* --text-tertiary for the trail, --gray-300 for the separator, and the
          current page in --text-primary at 500 — showcase 109. */}
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[14px] text-a-muted">
        <span className="truncate">{crumb1}</span>
        {crumb2 && (
          <>
            <span className="text-a-faint" aria-hidden>/</span>
            <span className="truncate font-medium text-a-ink">{crumb2}</span>
          </>
        )}
      </nav>

      <div className="flex-1" />

      {/* design-check-ignore: pill — the DS Badge is a pill; showcase 111 uses it for sync. */}
      <span className="flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] text-a-muted shadow-[inset_0_0_0_1px_var(--a-line)]">
        <span className={cn('size-[6px] rounded-full', SYNC_DOT_CLASS[sync.tone])} aria-hidden />
        {sync.label}
      </span>

      {bell}

      <button
        type="button"
        aria-label="Help"
        className="flex size-7 flex-shrink-0 items-center justify-center rounded-[4px] text-a-muted transition-colors duration-[120ms] hover:bg-a-row-hover hover:text-a-ink"
      >
        <CircleHelp className="size-4" strokeWidth={1.75} />
      </button>

      {account}
    </header>
  );
}
