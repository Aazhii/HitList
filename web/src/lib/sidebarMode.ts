import { useCallback, useState } from 'react';

/**
 * How the desktop sidebar is shown, as in Notion. Kept per device (local storage only): it is a layout preference, so nothing syncs.
 * - shown: the sidebar beside the page.
 * - hidden: no sidebar; a button at the top left brings it back, and pointing at that button or the left edge slides it in over the page.
 */
export type SidebarMode = 'shown' | 'hidden';

export const SIDEBAR_MODE_KEY = 'hitlist-sidebar-mode';

export function readSidebarMode(): SidebarMode {
  try {
    const value = window.localStorage.getItem(SIDEBAR_MODE_KEY);
    // 'hover' was an earlier mode that is now what hidden does; anything else, including the old 'sections', is shown.
    return value === 'hidden' || value === 'hover' ? 'hidden' : 'shown';
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
