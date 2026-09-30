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
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">{tabs}</div>
          {actions && <div className="flex flex-shrink-0 items-center gap-1 pb-1">{actions}</div>}
        </div>
      )}
    </header>
  );
}

/** The one quiet button in a page header, such as Filter. DS `sm`: 28px, 6px. */
export const topBarPill = cn(
  'flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-[13px] text-a-muted transition-colors duration-[120ms]',
  'hover:bg-a-row-hover hover:text-a-ink data-[state=open]:bg-a-row-hover data-[state=open]:text-a-ink',
);

/** The one accent button in a page header, such as New. DS `sm`: 28px, 6px. */
export const topBarPrimary = cn(
  'flex h-7 items-center gap-1.5 rounded-[6px] bg-a-accent px-2.5 text-[13px] font-semibold text-a-surface',
  'transition-colors duration-[120ms] hover:bg-a-accent-600 active:bg-a-accent-700',
);

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
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex items-center gap-1 border-b border-a-line"
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
              'relative -mb-px flex h-9 items-center border-b-2 px-3 text-[14px] transition-colors duration-[120ms]',
              active
                ? 'border-a-accent font-semibold text-a-accent'
                : 'border-transparent text-a-muted hover:text-a-ink',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
