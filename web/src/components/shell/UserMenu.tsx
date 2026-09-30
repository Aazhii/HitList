import { useState } from 'react';
import { Keyboard } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** The shortcuts the app actually has, so the list can be trusted. */
const SHORTCUTS: Array<{ keys: string; does: string }> = [
  { keys: '/', does: 'In a note or on an empty line: choose a block type' },
  { keys: '@', does: 'In a note or a text cell: add the line to a quadrant' },
  { keys: '↵', does: 'In a note: start a new block' },
  { keys: 'Tab', does: 'In a note table: move to the next cell' },
  { keys: '⌘ / Ctrl + B, I, U', does: 'Bold, italic, underline the selection' },
  { keys: '⌘ / Ctrl + ⇧ + X', does: 'Strike the selection through' },
  { keys: '↑ ↓ ← →', does: 'In a menu: move; ↵ chooses, Esc closes' },
];

/**
 * The account menu, in the top header's right corner (showcase 1108–1111): the workspace and its
 * store, then the entries. There is no sign-in in this app — data is tied to the browser — so the
 * prototype's "Sign out" is not offered; the reminders entry point lands here with T4.3.
 */
export function UserMenu() {
  const [shortcuts, setShortcuts] = useState(false);

  return (
    <>
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

        <DropdownMenuContent
          side="bottom"
          align="end"
          sideOffset={12}
          role="menu"
          aria-label="Account"
          className="w-[272px] overflow-hidden rounded-[12px] p-0 text-[13px] shadow-[var(--a-shadow-xl)]"
        >
          <div className="flex flex-col gap-1.5 border-b border-a-line-soft px-4 py-3.5">
            <div className="flex items-center gap-2">
              <span className="flex-1 font-semibold text-a-ink">Local workspace</span>
              {/* design-check-ignore: pill — the DS Badge is a pill. */}
              <span className="flex flex-shrink-0 items-center rounded-full border border-transparent bg-a-blue-tint px-2 py-[3px] text-[11px] leading-none font-medium text-a-accent">
                PostgreSQL
              </span>
            </div>
            <span className="text-[12px] text-a-faint">Same-origin Spring Boot service</span>
          </div>

          <div className="flex flex-col p-1.5">
            <DropdownMenuItem onSelect={() => setShortcuts(true)} className="gap-2.5 px-2.5 py-2 text-[14px] text-a-muted">
              <Keyboard className="size-[15px] flex-shrink-0" strokeWidth={1.75} aria-hidden />
              Keyboard shortcuts
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={shortcuts} onOpenChange={setShortcuts}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>What you can type or press in HitList.</DialogDescription>
          </DialogHeader>
          <dl className="flex flex-col">
            {SHORTCUTS.map(({ keys, does }) => (
              <div key={keys} className="flex items-baseline gap-3 border-b border-a-line-soft py-2 last:border-b-0">
                <dt className="w-[140px] flex-shrink-0 font-mono text-[12px] text-a-ink">{keys}</dt>
                <dd className="flex-1 text-a-muted">{does}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </>
  );
}
