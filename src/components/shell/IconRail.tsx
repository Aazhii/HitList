import type { ReactNode } from 'react';
import { Leaf, ListChecks, StickyNote, Table2, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

export type AppView = 'tasks' | 'notes' | 'automations' | 'databases';

const VIEWS: ReadonlyArray<{ id: AppView; label: string; icon: typeof ListChecks }> = [
  { id: 'tasks', label: 'Tasks', icon: ListChecks },
  { id: 'notes', label: 'Notes', icon: StickyNote },
  { id: 'automations', label: 'Automations', icon: Zap },
  { id: 'databases', label: 'Databases', icon: Table2 },
];

interface IconRailProps {
  activeView: AppView;
  onViewChange: (view: AppView) => void;
  /** The notification bell, rendered in the rail. */
  bell: ReactNode;
  /** The account menu. */
  account: ReactNode;
}

/**
 * The app's views, then the bell and the account.
 *
 * The only dark surface in the product, so "where am I" is answered by contrast
 * rather than by a label. List vs Matrix is a mode within Tasks and lives in the
 * top bar, not here.
 *
 * This replaces two switchers: the Tasks/Notes/Automations block in the old
 * sidebar, and a mobile-only header toggle that could not reach Automations.
 */
export function IconRail({ activeView, onViewChange, bell, account }: IconRailProps) {
  return (
    <nav
      aria-label="Views"
      className={cn(
        'flex h-14 flex-shrink-0 items-center justify-around gap-1 bg-a-rail px-2',
        'md:h-full md:w-16 md:flex-col md:justify-start md:gap-1.5 md:px-0 md:py-[18px]',
      )}
    >
      <span className="mb-3.5 hidden size-9 items-center justify-center rounded-full bg-a-accent md:flex" aria-hidden>
        <Leaf className="size-[19px] text-a-rail-fg" strokeWidth={2.75} />
      </span>

      {VIEWS.map(({ id, label, icon: Icon }) => {
        const active = id === activeView;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onViewChange(id)}
            aria-current={active ? 'page' : undefined}
            aria-label={label}
            title={label}
            className={cn(
              'flex size-10 items-center justify-center rounded-[14px] transition-colors duration-150',
              active
                ? 'bg-a-rail-fg/14 text-a-rail-fg'
                : 'text-a-rail-fg/50 hover:bg-a-rail-fg/10 hover:text-a-rail-fg',
            )}
          >
            <Icon className="size-[19px]" strokeWidth={2.75} />
          </button>
        );
      })}

      <div className="flex items-center gap-1 md:mt-auto md:flex-col md:gap-1.5">
        {bell}
        {account}
      </div>
    </nav>
  );
}
