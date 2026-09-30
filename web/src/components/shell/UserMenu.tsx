import { useRef, useState } from 'react';
import { Bell, Download, Keyboard, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { backupApi } from '@/lib/api';
import { backupFileName, importSummary, parseBackupText } from '@/lib/backupFile';
import { DENSITIES, useDensity } from '@/hooks/useDensity';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ShortcutsDialog } from '@/components/shell/ShortcutsDialog';

/**
 * The account menu, in the top header's right corner (showcase 1108–1111): the workspace and its
 * store, then the entries. There is no sign-in in this app — data is tied to the browser — so the
 * prototype's "Sign out" is not offered; Reminders (browser permission, default lead time) opens from here.
 */
export function UserMenu({ onOpenReminders, dailyLine }: {
  onOpenReminders?: () => void;
  /** The Today page's daily line: whether it is on, and a way to change that. */
  dailyLine?: { enabled: boolean; onChange: (enabled: boolean) => void };
}) {
  const [shortcuts, setShortcuts] = useState(false);
  const [density, setDensity] = useDensity();
  const fileInput = useRef<HTMLInputElement>(null);

  /** Everything in the workspace, as one JSON file the person keeps. */
  const exportBackup = async () => {
    try {
      const file = await backupApi.export();
      const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = backupFileName(new Date());
      link.click();
      URL.revokeObjectURL(url);
      toast.success('Backup downloaded', { duration: 2500 });
    } catch {
      toast.error('Could not make a backup', { duration: 3000 });
    }
  };

  /** Adds what the file holds. Anything already here is left as it is. */
  const importBackup = async (file: File | undefined) => {
    if (!file) return;
    try {
      const result = await backupApi.import(parseBackupText(await file.text()));
      toast.success(importSummary(result), { duration: 5000 });
      // The pages read their data on load, so a reload is the honest way to show what arrived.
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not import that file', { duration: 4000 });
    }
  };

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
            {onOpenReminders && (
              <DropdownMenuItem onSelect={onOpenReminders} className="gap-2.5 px-2.5 py-2 text-[14px] text-a-muted">
                <Bell className="size-[15px] flex-shrink-0" strokeWidth={1.75} aria-hidden />
                Reminders
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => { void exportBackup(); }} className="gap-2.5 px-2.5 py-2 text-[14px] text-a-muted">
              <Download className="size-[15px] flex-shrink-0" strokeWidth={1.75} aria-hidden />
              Export workspace
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => fileInput.current?.click()} className="gap-2.5 px-2.5 py-2 text-[14px] text-a-muted">
              <Upload className="size-[15px] flex-shrink-0" strokeWidth={1.75} aria-hidden />
              Import backup
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setShortcuts(true)} className="gap-2.5 px-2.5 py-2 text-[14px] text-a-muted">
              <Keyboard className="size-[15px] flex-shrink-0" strokeWidth={1.75} aria-hidden />
              Keyboard shortcuts
            </DropdownMenuItem>
            {dailyLine && (
              <DropdownMenuCheckboxItem
                checked={dailyLine.enabled}
                onCheckedChange={dailyLine.onChange}
                className="px-2.5 py-2 text-[14px] text-a-muted"
              >
                Daily summary on Today
              </DropdownMenuCheckboxItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="px-2.5 py-1.5 text-[12px] font-medium text-a-faint">Density</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={density} onValueChange={(v) => setDensity(v as typeof density)}>
              {DENSITIES.map((d) => (
                <DropdownMenuRadioItem key={d.id} value={d.id} className="px-2.5 py-2 text-[14px] text-a-muted">{d.label}</DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        aria-label="Backup file"
        className="hidden"
        onChange={(e) => { void importBackup(e.target.files?.[0]); e.target.value = ''; }}
      />
      <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
    </>
  );
}
