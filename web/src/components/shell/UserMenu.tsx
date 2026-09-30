import { Database } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * The account menu, in the top header's right corner.
 */
export function UserMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* 26x26 at 4px radius on --gray-200, 12px/600 — showcase 114. A square,
            not a circle: the design's account button matches the sidebar rows. */}
        <button
          type="button"
          className="flex size-[26px] flex-shrink-0 items-center justify-center rounded-[4px] bg-a-line text-[12px] font-semibold text-a-ink transition-colors duration-[120ms] hover:bg-a-surface-2"
          aria-label="Account"
        >
          H
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent side="bottom" align="end" className="w-64">
        <div className="space-y-1 px-3 py-3">
          <div className="flex items-center gap-2">
            <p className="flex-1 truncate text-[13px] font-semibold">Local workspace</p>
            <span className="flex flex-shrink-0 items-center gap-1 rounded-[3px] bg-a-sage-tint px-1.5 py-0.5 text-[11px] font-medium text-a-sage-ink">
              <Database className="size-3" /> PostgreSQL
            </span>
          </div>
          <p className="truncate text-[12px] text-a-faint">Same-origin Spring Boot service</p>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
