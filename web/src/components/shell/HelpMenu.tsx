import { useState } from 'react';
import { CircleHelp, Keyboard } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ShortcutsDialog } from '@/components/shell/ShortcutsDialog';

/** The header's "?" : what can be typed or pressed. */
export function HelpMenu() {
  const [shortcuts, setShortcuts] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Help"
            className="flex size-7 flex-shrink-0 items-center justify-center rounded-[4px] text-a-muted transition-colors duration-[120ms] hover:bg-a-row-hover hover:text-a-ink data-[state=open]:bg-a-row-hover"
          >
            <CircleHelp className="size-4" strokeWidth={1.75} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={12} className="w-[220px]">
          <DropdownMenuItem onSelect={() => setShortcuts(true)}>
            <Keyboard className="size-4 text-a-muted" strokeWidth={1.75} aria-hidden /> Keyboard shortcuts
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
    </>
  );
}
