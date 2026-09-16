/**
 * Browser Back between screens.
 *
 * The app has no router: which page, list, layout and saved view are on screen
 * are all React state, so Back left the app entirely — the one thing nobody
 * expects it to do. This pushes a history entry whenever that combination
 * changes, and puts it back when Back (or Forward) is pressed.
 *
 * Deliberately not a router: no paths, no route table, nothing to keep in step
 * with the UI. One entry per screen, restored through the callback.
 */
import { useEffect, useRef } from 'react';

export interface ScreenState {
  /** 'tasks' | 'notes' | 'automations' */
  view: string;
  listId: string;
  layout: string;
  /** The saved view whose tab is open, or null. */
  viewId: string | null;
}

const KEY = 'hitlist-screen';

function sameScreen(a: ScreenState, b: ScreenState): boolean {
  return a.view === b.view && a.listId === b.listId && a.layout === b.layout && a.viewId === b.viewId;
}

/**
 * Keeps `screen` in the browser's history, and calls `onRestore` when the user
 * goes back or forward. `onRestore` is held in a ref, so a fresh closure each
 * render does not re-register the listener.
 */
export function useHistoryState(screen: ScreenState, onRestore: (screen: ScreenState) => void): void {
  const restoreRef = useRef(onRestore);
  useEffect(() => { restoreRef.current = onRestore; }, [onRestore]);

  /** What the current history entry holds, so an unchanged screen pushes nothing. */
  const currentRef = useRef<ScreenState | null>(null);
  /** Set while restoring, so putting the screen back does not push a new entry. */
  const restoringRef = useRef(false);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const state = (event.state as Record<string, unknown> | null)?.[KEY] as ScreenState | undefined;
      if (!state) return;
      restoringRef.current = true;
      currentRef.current = state;
      restoreRef.current(state);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (restoringRef.current) { restoringRef.current = false; return; }

    const previous = currentRef.current;
    currentRef.current = screen;

    // The first screen replaces the entry the app was opened with, so Back from
    // it leaves the app rather than stepping through an entry nobody chose.
    if (previous === null) {
      window.history.replaceState({ ...(window.history.state as object ?? {}), [KEY]: screen }, '');
      return;
    }
    if (sameScreen(previous, screen)) return;

    window.history.pushState({ [KEY]: screen }, '');
  }, [screen]);
}
