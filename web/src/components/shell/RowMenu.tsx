/**
 * The menu behind a sidebar row's "⋯" (showcase 1134–1144): 280px, 8px radius, a small caption
 * ("Page"), 32px items with 16px icons in the secondary colour, hairlines between groups, and a
 * meta line at the foot ("Last edited by You / Sep 29, 2026, 7:02 PM").
 *
 * The prototype also lists Add to Favorites, Duplicate, Copy link, Open in new tab and keyboard
 * hints; only what a row can actually do is offered here, so no item is a dead one.
 */
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

export function RowMenuContent({
  caption, footer, children, className,
}: { caption: string; footer?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <DropdownMenuContent
      align="start"
      side="right"
      sideOffset={8}
      className={cn('w-[280px] rounded-[8px] shadow-[var(--a-shadow-xl)]', className)}
    >
      <div className="px-2.5 py-1.5 text-[12px] font-medium text-a-faint">{caption}</div>
      {children}
      {footer && (
        <>
          <DropdownMenuSeparator />
          <div className="px-2.5 pt-1.5 pb-1 text-[12px] leading-[1.6] text-a-faint">{footer}</div>
        </>
      )}
    </DropdownMenuContent>
  );
}

export function RowMenuItem({
  icon: Icon, label, onSelect, destructive,
}: { icon: LucideIcon; label: string; onSelect: () => void; destructive?: boolean }) {
  return (
    <DropdownMenuItem
      variant={destructive ? 'destructive' : 'default'}
      onSelect={onSelect}
      className="min-h-8 px-2.5 py-1.5"
    >
      <Icon className={cn('size-4', !destructive && 'text-a-muted')} strokeWidth={1.75} aria-hidden />
      <span className="flex-1">{label}</span>
    </DropdownMenuItem>
  );
}
