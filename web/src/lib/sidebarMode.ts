import { useCallback, useState } from 'react';

/**
 * How the desktop sidebar is shown. Kept per device (local storage only): it is a layout preference, so nothing syncs.
 * - shown: the whole sidebar.
 * - sections: only the workspace row, search and the view list; the view's own sections (lists, notes, favorites…) are hidden.
 * - hidden: no sidebar; a small button reopens it.
 * - hover: no sidebar until the pointer reaches the left edge, then it slides in over the page.
 */
export type SidebarMode = 'shown' | 'sections' | 'hidden' | 'hover';

export const SIDEBAR_MODE_KEY = 'hitlist-sidebar-mode';
const MODES: readonly SidebarMode[] = ['shown', 'sections', 'hidden', 'hover'];

export function readSidebarMode(): SidebarMode {
  try {
    const value = window.localStorage.getItem(SIDEBAR_MODE_KEY);
    return MODES.includes(value as SidebarMode) ? (value as SidebarMode) : 'shown';
  } catch {
    return 'shown';
  }
}

export function useSidebarMode(): [SidebarMode, (mode: SidebarMode) => void] {
  const [mode, setModeState] = useState<SidebarMode>(readSidebarMode);
  const setMode = useCallback((next: SidebarMode) => {
    setModeState(next);
    try { window.localStorage.setItem(SIDEBAR_MODE_KEY, next); } catch { /* storage blocked: the choice lasts until reload */ }
  }, []);
  return [mode, setMode];
}
