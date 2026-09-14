import type { ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useViewLayout } from '@/components/shell/ViewLayout';

interface TopBarProps {
  /** A colour dot before the title, such as the active list's colour. */
  dotClass?: string;
  title: ReactNode;
  /** One line of counts. Hidden on narrow screens. */
  subtitle?: ReactNode;
  /** Right-aligned: a mode toggle, one quiet pill, one accent button. Never more. */
  actions?: ReactNode;
}

/**
 * The 56px bar above every view.
 *
 * Below `md` it also carries the button that opens the context column's sheet.
 */
export function TopBar({ dotClass, title, subtitle, actions }: TopBarProps) {
  const { openContext } = useViewLayout();

  return (
    <header className="flex h-14 flex-shrink-0 items-center gap-3 border-b border-a-line px-3 md:px-[26px]">
      <button
        type="button"
        onClick={openContext}
        className="-ml-1 flex size-9 flex-shrink-0 items-center justify-center rounded-full text-a-muted transition-colors duration-150 hover:bg-a-row-hover hover:text-a-ink md:hidden"
        aria-label="Open sidebar"
      >
        <Menu className="size-[18px]" strokeWidth={2.75} />
      </button>

      {dotClass && <span className={cn('size-[9px] flex-shrink-0 rounded-full', dotClass)} aria-hidden />}

      <h1 className="min-w-0 truncate font-display text-[22px] leading-none text-a-ink">{title}</h1>

      {subtitle && (
        <p className="hidden min-w-0 truncate text-[13.5px] text-a-faint lg:block">{subtitle}</p>
      )}

      {actions && (
        <div className="ml-auto flex flex-shrink-0 items-center gap-2 md:gap-2.5">{actions}</div>
      )}
    </header>
  );
}

/** The one quiet pill in a top bar, such as Filter. */
export const topBarPill = cn(
  'flex h-8 items-center gap-2 rounded-full px-3.5 text-[13.5px] text-a-muted transition-colors duration-150',
  'shadow-[inset_0_0_0_1px_var(--a-line)] hover:text-a-ink data-[state=open]:text-a-ink',
);

/** The one accent button in a top bar, such as Add task. */
export const topBarPrimary = cn(
  'flex h-[34px] items-center gap-[7px] rounded-full bg-a-accent px-3 font-display text-[15px] text-a-bg sm:px-4',
  'transition-colors duration-150 hover:bg-a-accent-600',
);

interface TopBarToggleProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}

/** A segmented control for a mode within a view, such as List / Matrix. */
export function TopBarToggle<T extends string>({ label, value, options, onChange }: TopBarToggleProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex items-center gap-0.5 rounded-full bg-[color-mix(in_srgb,var(--a-ink)_7%,transparent)] p-[3px]"
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
              'flex h-7 items-center rounded-full px-3 text-[13.5px] transition-colors duration-150 sm:px-3.5',
              active
                ? 'bg-a-bg font-semibold text-a-ink shadow-[0_1px_2px_rgba(46,43,37,0.14)]'
                : 'text-a-muted hover:text-a-ink',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
