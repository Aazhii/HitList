/**
 * SyncStatusBar — non-intrusive sync status indicator
 *
 * Renders:
 *  - A subtle pulsing dot + "Syncing…" label while saving
 *  - An error banner with Retry + Dismiss when error is set
 *  - A soft "Working offline" notice when backend is unavailable
 *  - Nothing when idle and online
 */

import { AlertCircle, CheckCircle2, Loader2, RefreshCw, WifiOff, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SyncStatusBarProps {
  loading: boolean;
  saving: boolean;
  error: string | null;
  serverOnline: boolean;
  /** True when the backend went offline mid-session (silent fallback active) */
  backendUnavailable?: boolean;
  onRetry: () => void;
  onDismissError: () => void;
}

export function SyncStatusBar({
  loading,
  saving,
  error,
  serverOnline,
  backendUnavailable = false,
  onRetry,
  onDismissError,
}: SyncStatusBarProps) {
  // Show a brief "Saved" confirmation after saving completes
  const [showSaved, setShowSaved] = useState(false);
  // Use a ref so the effect always sees the latest previous value without
  // triggering an extra render cycle that would miss the transition.
  const prevSavingRef = useRef(false);

  useEffect(() => {
    const wasSaving = prevSavingRef.current;
    prevSavingRef.current = saving;
    if (wasSaving && !saving && !error) {
      setShowSaved(true);
      const t = setTimeout(() => setShowSaved(false), 1800);
      return () => clearTimeout(t);
    }
  }, [saving, error]);

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

  // Loading state (initial fetch)
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-2 animate-fade-in">
        <Loader2 className="size-3 text-muted-foreground animate-spin" />
        <span className="text-[11px] text-muted-foreground">
          {serverOnline ? 'Loading from server…' : 'Loading…'}
        </span>
      </div>
    );
  }

  // Backend went offline mid-session — non-blocking offline notice
  if (backendUnavailable && !serverOnline) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="mx-4 md:mx-6 mt-3 rounded-xl border border-amber-500/20 bg-amber-500/8 px-4 py-2 flex items-center gap-2.5 animate-fade-in"
      >
        <WifiOff className="size-3.5 text-amber-500 flex-shrink-0" />
        <p className="text-xs text-amber-600 dark:text-amber-400 flex-1 min-w-0 font-medium">
          Working offline — changes saved locally
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRetry}
          className="h-6 px-2 text-[11px] gap-1 text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 hover:bg-amber-500/10 flex-shrink-0 rounded-lg"
        >
          <RefreshCw className="size-2.5" />
          Reconnect
        </Button>
      </div>
    );
  }

  // Saving state — subtle inline indicator in header area
  if (saving) {
    return (
      <div
        className={cn(
          'flex items-center justify-end gap-1.5 px-4 md:px-6 py-1 animate-fade-in'
        )}
      >
        <span className="relative flex size-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex rounded-full size-1.5 bg-primary" />
        </span>
        <span className="text-[10px] text-muted-foreground font-medium">Syncing…</span>
      </div>
    );
  }

  // Saved confirmation — brief flash
  if (showSaved) {
    return (
      <div className="flex items-center justify-end gap-1.5 px-4 md:px-6 py-1 animate-fade-in">
        <CheckCircle2 className="size-3 text-primary" />
        <span className="text-[10px] text-primary font-medium">Saved</span>
      </div>
    );
  }

  return null;
}
