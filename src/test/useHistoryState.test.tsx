/**
 * Browser Back between screens: one history entry per screen, restored on
 * popstate, and nothing pushed for a screen that did not change.
 */
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHistoryState, type ScreenState } from '@/hooks/useHistoryState';

function Harness({ screen, onRestore }: { screen: ScreenState; onRestore: (s: ScreenState) => void }) {
  useHistoryState(screen, onRestore);
  return null;
}

const screen = (over: Partial<ScreenState> = {}): ScreenState => ({
  view: 'tasks', listId: 'list-1', layout: 'table', viewId: null, ...over,
});

afterEach(() => { vi.restoreAllMocks(); });

describe('useHistoryState', () => {
  it('replaces the first entry rather than pushing one nobody chose', () => {
    const push = vi.spyOn(window.history, 'pushState');
    const replace = vi.spyOn(window.history, 'replaceState');

    render(<Harness screen={screen()} onRestore={vi.fn()} />);

    expect(replace).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it('pushes an entry when the screen changes, and not when it does not', () => {
    const push = vi.spyOn(window.history, 'pushState');
    const { rerender } = render(<Harness screen={screen()} onRestore={vi.fn()} />);

    rerender(<Harness screen={screen({ layout: 'board' })} onRestore={vi.fn()} />);
    expect(push).toHaveBeenCalledTimes(1);

    // Same screen, new object: nothing to record.
    rerender(<Harness screen={screen({ layout: 'board' })} onRestore={vi.fn()} />);
    expect(push).toHaveBeenCalledTimes(1);

    rerender(<Harness screen={screen({ layout: 'board', viewId: 'v1' })} onRestore={vi.fn()} />);
    expect(push).toHaveBeenCalledTimes(2);
  });

  it('puts the screen back on Back, without recording it again', () => {
    const push = vi.spyOn(window.history, 'pushState');
    const onRestore = vi.fn();
    const { rerender } = render(<Harness screen={screen()} onRestore={onRestore} />);

    rerender(<Harness screen={screen({ view: 'notes' })} onRestore={onRestore} />);
    expect(push).toHaveBeenCalledTimes(1);

    const previous = screen();
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { 'hitlist-screen': previous } }));
    });
    expect(onRestore).toHaveBeenCalledWith(previous);

    // The app puts that screen back; that must not become a new entry.
    rerender(<Harness screen={previous} onRestore={onRestore} />);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('ignores a history entry that is not ours', () => {
    const onRestore = vi.fn();
    render(<Harness screen={screen()} onRestore={onRestore} />);

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { somethingElse: true } }));
    });
    expect(onRestore).not.toHaveBeenCalled();
  });
});
