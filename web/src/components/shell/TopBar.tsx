import type { ReactNode } from 'react';
import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useViewLayout } from '@/components/shell/ViewLayout';

interface TopBarProps {
  /** A colour dot before the title, such as the active list's colour. */
  dotClass?: string;
  title: ReactNode;
  /** One line of counts. Hidden on narrow screens. */
  subtitle?: ReactNode;
  /** Red text beside the subtitle, e.g. "2 need attention". */
  attention?: ReactNode;
  /** The layout tabs. They sit on their own row under the title, left-aligned. */
  tabs?: ReactNode;
  /** Right-aligned on the tabs row: one quiet pill, one accent button. Never more. */
  actions?: ReactNode;
}

/**
 * The page header above every view — `HitList Notion x Zoho.dc.html` 117-144.
 *
 * Two rows inside one padded block, not a fixed-height bar: the title row
 * (dot, 32px title, subtitle, attention), then a controls row with the layout
 * tabs on the left and the actions on the right. Deliberately **no bottom
 * border** — the design separates the header from the content with whitespace,
 * and a hairline here reads as a toolbar it is not.
 *
 * Below `md` it also carries the button that opens the sidebar's sheet.
 */
export function TopBar({ dotClass, title, subtitle, attention, tabs, actions }: TopBarProps) {
  const { openContext, toggleCollapsed, collapsible, collapsed } = useViewLayout();

  return (
    <header className="flex-shrink-0 bg-a-surface px-4 pt-2 md:px-12">
      <div className="flex flex-wrap items-center gap-3 pb-1.5">
        <button
          type="button"
          onClick={openContext}
          className="-ml-1 flex size-8 flex-shrink-0 items-center justify-center rounded-[4px] text-a-muted transition-colors duration-[120ms] hover:bg-a-row-hover hover:text-a-ink md:hidden"
          aria-label="Open sidebar"
        >
          <Menu className="size-[18px]" strokeWidth={1.75} />
        </button>

        {/* Desktop only, and only for views that allow it — Notes, which used to
            let its list be hidden for a wider editor. */}
        {collapsible && (
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
            title={collapsed ? 'Show sidebar' : 'Hide sidebar'}
            className="-ml-2 hidden size-8 flex-shrink-0 items-center justify-center rounded-[4px] text-a-muted transition-colors duration-[120ms] hover:bg-a-row-hover hover:text-a-ink md:flex"
          >
            {collapsed
              ? <PanelLeftOpen className="size-[18px]" strokeWidth={1.75} />
              : <PanelLeftClose className="size-[18px]" strokeWidth={1.75} />}
          </button>
        )}

        {/* A rounded square, not a circle — showcase 120 is 14px at radius 3. */}
        {dotClass && <span className={cn('size-[14px] flex-shrink-0 rounded-[3px]', dotClass)} aria-hidden />}

        <h1 className="min-w-0 truncate font-display text-[32px] leading-[1.2] font-bold tracking-[-0.02em] text-a-ink">
          {title}
        </h1>

        {subtitle && (
          <p className="hidden min-w-0 truncate text-[14px] text-a-muted lg:block">{subtitle}</p>
        )}

        {attention && (
          <span className="hidden flex-shrink-0 text-[14px] font-medium text-a-attention lg:block">{attention}</span>
        )}
      </div>

      {(tabs || actions) && (
        <div className="mt-2 flex items-center gap-2">
          <div className="min-w-0 flex-1">{tabs}</div>
          {actions && <div className="flex flex-shrink-0 items-center gap-1 pb-1">{actions}</div>}
        </div>
      )}
    </header>
  );
}

/**
 * DS `Button` size sm (Button.jsx): 28px, 0 12px, 11px / 600, 3px radius (the showcase
 * shifts the DS radii down: sm 3, md 4, lg 6, xl 8 — line 28), 8px gap.
 * Three variants used in page chrome: ghost (Filter), primary (New), secondary
 * (Columns, Fields, Retry). Anything bigger composes these with BTN_MD.
 */
const BTN_SM = 'flex h-7 flex-shrink-0 items-center gap-2 rounded-[3px] border border-transparent px-3 text-[11px] font-semibold whitespace-nowrap transition-colors duration-[120ms] active:translate-y-[0.5px]';

export const topBarPill = cn(
  BTN_SM, 'text-a-muted hover:bg-a-line-soft active:bg-a-line data-[state=open]:bg-a-line-soft',
);

export const topBarPrimary = cn(
  BTN_SM, 'bg-a-accent text-a-surface hover:bg-a-accent-600 active:bg-a-accent-700',
);

export const topBarSecondary = cn(
  BTN_SM, 'border-a-line-strong bg-a-surface text-a-ink hover:bg-a-bg active:bg-a-line-soft',
);

/** DS `Button` size md, to override a size-sm variant: 34px, 0 16px, 13px, 4px radius. */
export const BTN_MD = 'h-[34px] rounded-[4px] px-4 text-[13px]';

interface TopBarToggleProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}

/**
 * The layout tabs — showcase 127, the DS `Tabs` in its line variant.
 *
 * An underline bar, not a segmented pill: plain labels on the page, the active
 * one in brand blue over a 2px blue rule, with a hairline running the width of
 * the row beneath them all.
 */
export function TopBarToggle<T extends string>({ label, value, options, onChange }: TopBarToggleProps<T>) {
  // DS Tabs (Tabs.jsx): 13px / 500, 12px padding, 4px gap, a 1px --border-default
  // rule under the row, and a 2px rule inset 12px on the selected tab, sitting on it.
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex items-stretch gap-1 border-b border-a-line"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'relative flex items-center p-3 text-[13px] leading-[normal] whitespace-nowrap transition-colors duration-[120ms]',
              active ? 'font-semibold text-a-accent' : 'font-medium text-a-muted hover:text-a-ink',
            )}
          >
            {opt.label}
            {active && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-t-[3px] bg-a-accent" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
