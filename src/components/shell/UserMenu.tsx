import { Database } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

/**
 * The account menu, at the foot of the icon rail.
 */
export function UserMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex size-10 items-center justify-center rounded-[14px] transition-colors duration-150 hover:bg-a-rail-fg/10"
          aria-label="Account"
        >
          <Avatar size="sm">
            <AvatarFallback className="bg-a-accent text-[11px] font-semibold text-a-bg">H</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent side="right" align="end" className="w-64">
        <div className="space-y-1 px-3 py-3">
          <div className="flex items-center gap-2">
            <p className="flex-1 truncate text-[13px] font-semibold">Local workspace</p>
            <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-a-sage-tint px-1.5 py-0.5 text-[11px] font-medium text-a-sage-ink">
              <Database className="size-3" /> PostgreSQL
            </span>
          </div>
          <p className="truncate text-[12px] text-a-faint">Same-origin Spring Boot service</p>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
