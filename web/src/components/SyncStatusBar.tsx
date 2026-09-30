/**
 * SyncStatusBar — non-intrusive sync status indicator
 *
 * Renders:
 *  - An error banner with Retry + Dismiss when error is set
 *  - The amber offline strip (showcase 146–154) while the server is unreachable
 *  - Nothing otherwise: saving / saved live in AppHeader's pill, loading in the
 *    page's own skeleton
 */

import { AlertCircle, RefreshCw, WifiOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { topBarSecondary } from '@/components/shell/TopBar';

interface SyncStatusBarProps {
  error: string | null;
  serverOnline: boolean;
  onRetry: () => void;
  onDismissError: () => void;
}

export function SyncStatusBar({
  error,
  serverOnline,
  onRetry,
  onDismissError,
}: SyncStatusBarProps) {
  // Error state — most prominent
  if (error) {
    return (
      <div
        role="alert"
        className="mx-4 md:mx-6 mt-3 rounded-xl border border-destructive/25 bg-destructive/8 px-4 py-2.5 flex items-center gap-3 animate-fade-in"
      >
        <AlertCircle className="size-3.5 text-destructive flex-shrink-0" />
        <p className="text-xs text-destructive flex-1 min-w-0 truncate font-medium">{error}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRetry}
          className="h-7 px-2.5 text-xs gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10 flex-shrink-0 rounded-lg"
        >
          <RefreshCw className="size-3" />
          Retry
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onDismissError}
          className="size-7 text-muted-foreground hover:text-foreground flex-shrink-0 rounded-lg"
          aria-label="Dismiss error"
        >
          <X className="size-3.5" />
        </Button>
      </div>
    );
  }

  // The header pill says "Offline" under this same condition, so the two agree.
  if (!serverOnline) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2.5 border-b border-a-amber-line bg-a-amber-tint px-6 py-2 text-[14px] text-a-amber-ink animate-fade-in"
      >
        <WifiOff className="size-[15px] flex-shrink-0" strokeWidth={1.75} aria-hidden />
        <span className="font-semibold">Offline — using local data.</span>
        <span className="min-w-0">Changes are kept on this device and sync when the server is reachable.</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onRetry}
          className={topBarSecondary}
        >
          Retry
        </button>
      </div>
    );
  }

  // Steady state — saving and saved are reported by AppHeader's always-on sync
  // Badge (showcase 111). Rendering them here too put "Saved" on screen twice,
  // in two places, with two independent pieces of logic. This bar now owns only
  // the states that need an explanation and an action: error and offline, both
  // handled above.
  return null;
}
