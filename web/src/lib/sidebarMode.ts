import { useCallback, useState } from 'react';

/**
 * How the desktop sidebar is shown, as in Postman and IntelliJ. Kept per device (local storage only): it is a layout
 * preference, so nothing syncs.
 * - shown: the sidebar beside the page, at the width the person dragged it to.
 * - hidden: no sidebar; the toggle button at the bottom left brings it back, and so does dragging the left edge out.
 */
export type SidebarMode = 'shown' | 'hidden';

export const SIDEBAR_MODE_KEY = 'hitlist-sidebar-mode';
export const SIDEBAR_WIDTH_KEY = 'hitlist-sidebar-width';

/** The width it opens at, how far it can be dragged, and the width below which dragging closes it. */
export const SIDEBAR_DEFAULT_WIDTH = 248;
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 440;
export const SIDEBAR_COLLAPSE_AT = 140;

export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

export function readSidebarMode(): SidebarMode {
  try {
    const value = window.localStorage.getItem(SIDEBAR_MODE_KEY);
    // 'hover' was an earlier mode that is now what hidden does; anything else, including the old 'sections', is shown.
    return value === 'hidden' || value === 'hover' ? 'hidden' : 'shown';
  } catch {
    return 'shown';
  }
}

export function readSidebarWidth(): number {
  try {
    const value = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return Number.isFinite(value) && value > 0 ? clampSidebarWidth(value) : SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
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

export function useSidebarWidth(): [number, (width: number) => void] {
  const [width, setWidthState] = useState<number>(readSidebarWidth);
  const setWidth = useCallback((next: number) => {
    const clamped = clampSidebarWidth(next);
    setWidthState(clamped);
    try { window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clamped)); } catch { /* storage blocked: the width lasts until reload */ }
  }, []);
  return [width, setWidth];
}
