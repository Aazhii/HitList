import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '@/components/shell/Sidebar';

describe('Sidebar', () => {
  it('shows every view, Automations included', () => {
    render(
      <Sidebar
        activeView="tasks"
        onViewChange={vi.fn()}
        context={null}
        mobileOpen
        onMobileOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Tasks' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Databases' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Calendar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Automations' })).toBeInTheDocument();
  });

  it('marks the active view current and shows a count badge', () => {
    render(
      <Sidebar
        activeView="databases"
        onViewChange={vi.fn()}
        counts={{ tasks: 5 }}
        context={null}
        mobileOpen
        onMobileOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Databases' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /^Tasks/ })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  describe('resizing and hiding it', () => {
    beforeEach(() => {
      window.localStorage.clear();
      // The desktop layout: the setup's matchMedia says no for every query.
      vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
        matches: true, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
        addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList);
    });
    afterEach(() => vi.restoreAllMocks());
    const mount = () => render(
      <Sidebar
        activeView="tasks"
        onViewChange={vi.fn()}
        context={<p>My lists</p>}
        pages={<p>Favorites</p>}
        mobileOpen={false}
        onMobileOpenChange={vi.fn()}
      />,
    );

    const drag = (handle: HTMLElement, from: number, to: number) => {
      fireEvent.mouseDown(handle, { button: 0, clientX: from });
      fireEvent.mouseMove(window, { clientX: to });
      fireEvent.mouseUp(window, { clientX: to });
    };

    it('the same toggle button sits at the bottom left whether it is open or shut, and the choice is kept', async () => {
      const user = userEvent.setup();
      const first = mount();
      expect(screen.queryByRole('button', { name: 'Sidebar options' })).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Toggle sidebar' }));
      expect(window.localStorage.getItem('hitlist-sidebar-mode')).toBe('hidden');
      expect(document.querySelector('aside')).toBeNull();
      first.unmount();
      // Reopening from the remembered state uses the same button, which is never covered by anything.
      mount();
      expect(document.querySelector('aside')).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Toggle sidebar' }));
      expect(screen.getByRole('navigation', { name: 'Views' })).toBeInTheDocument();
      expect(screen.getByText('My lists')).toBeInTheDocument();
      expect(screen.getByText('Favorites')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Toggle sidebar' })).toBeInTheDocument();
    });

    it('dragging the edge resizes it, within bounds, and the width is kept', () => {
      const first = mount();
      drag(screen.getByTestId('sidebar-resize'), 248, 320);
      expect(document.querySelector('aside')).toHaveStyle({ width: '320px' });
      expect(window.localStorage.getItem('hitlist-sidebar-width')).toBe('320');
      // Past the far edge it stops at the maximum.
      drag(screen.getByTestId('sidebar-resize'), 320, 900);
      expect(document.querySelector('aside')).toHaveStyle({ width: '440px' });
      first.unmount();
      mount();
      expect(document.querySelector('aside')).toHaveStyle({ width: '440px' });
    });

    it('dragging it down to a sliver closes it, and dragging the left edge out opens it again', () => {
      mount();
      drag(screen.getByTestId('sidebar-resize'), 248, 60);
      expect(document.querySelector('aside')).toBeNull();
      expect(window.localStorage.getItem('hitlist-sidebar-mode')).toBe('hidden');
      // Shut, the handle sits on the left edge: pulling it out brings the sidebar back at that width.
      drag(screen.getByTestId('sidebar-resize'), 0, 300);
      expect(document.querySelector('aside')).toHaveStyle({ width: '300px' });
      expect(screen.getByText('My lists')).toBeInTheDocument();
    });

    it('the handle also resizes with the arrow keys, and double-clicking it resets the width', () => {
      mount();
      const handle = screen.getByTestId('sidebar-resize');
      fireEvent.keyDown(handle, { key: 'ArrowRight' });
      expect(document.querySelector('aside')).toHaveStyle({ width: '264px' });
      fireEvent.doubleClick(handle);
      expect(document.querySelector('aside')).toHaveStyle({ width: '248px' });
    });

    it('Ctrl+\\ hides the sidebar and shows it again', () => {
      mount();
      fireEvent.keyDown(window, { key: '\\', ctrlKey: true });
      expect(document.querySelector('aside')).toBeNull();
      fireEvent.keyDown(window, { key: '\\', ctrlKey: true });
      expect(screen.getByRole('navigation', { name: 'Views' })).toBeInTheDocument();
    });

    it('the earlier "hover" choice now means hidden, and the earlier "sections" choice means shown', () => {
      window.localStorage.setItem('hitlist-sidebar-mode', 'hover');
      const a = mount();
      expect(document.querySelector('aside')).toBeNull();
      expect(screen.getByRole('button', { name: 'Toggle sidebar' })).toBeInTheDocument();
      a.unmount();
      window.localStorage.setItem('hitlist-sidebar-mode', 'sections');
      mount();
      expect(screen.getByText('My lists')).toBeInTheDocument();
    });
  });
});
