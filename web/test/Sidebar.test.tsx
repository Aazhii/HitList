import { fireEvent, render, screen, within } from '@testing-library/react';
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

  describe('hiding it', () => {
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

    it('has no menu or bottom button, just a Hide sidebar button in the top row, and hiding keeps the choice', async () => {
      const user = userEvent.setup();
      const first = mount();
      expect(screen.queryByRole('button', { name: 'Sidebar options' })).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Hide sidebar' }));
      expect(window.localStorage.getItem('hitlist-sidebar-mode')).toBe('hidden');
      expect(screen.getByRole('button', { name: 'Show sidebar' })).toBeInTheDocument();
      first.unmount();
      mount();
      await user.click(screen.getByRole('button', { name: 'Show sidebar' }));
      expect(screen.getByRole('navigation', { name: 'Views' })).toBeInTheDocument();
      expect(screen.getByText('My lists')).toBeInTheDocument();
      expect(screen.getByText('Favorites')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Hide sidebar' })).toBeInTheDocument();
    });

    it('hidden, pointing at the button or the left edge slides it in over the page, and a click keeps it open', async () => {
      const user = userEvent.setup();
      mount();
      await user.click(screen.getByRole('button', { name: 'Hide sidebar' }));
      const aside = document.querySelector('aside') as HTMLElement;
      expect(aside).toHaveAttribute('aria-hidden', 'true');
      fireEvent.mouseEnter(screen.getByTestId('sidebar-hot-edge'));
      expect(aside).toHaveAttribute('aria-hidden', 'false');
      expect(aside.className).toContain('fixed');
      // While peeking there is no hide button; the show button pins it.
      expect(within(aside).queryByRole('button', { name: 'Hide sidebar' })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Show sidebar' }));
      expect((document.querySelector('aside') as HTMLElement).className).not.toContain('fixed');
    });

    it('Ctrl+\\ hides the sidebar and shows it again', () => {
      mount();
      fireEvent.keyDown(window, { key: '\\', ctrlKey: true });
      expect(screen.getByRole('button', { name: 'Show sidebar' })).toBeInTheDocument();
      fireEvent.keyDown(window, { key: '\\', ctrlKey: true });
      expect(screen.queryByRole('button', { name: 'Show sidebar' })).not.toBeInTheDocument();
      expect(screen.getByRole('navigation', { name: 'Views' })).toBeInTheDocument();
    });

    it('the earlier "hover" choice now means hidden, and the earlier "sections" choice means shown', () => {
      window.localStorage.setItem('hitlist-sidebar-mode', 'hover');
      const a = mount();
      expect(screen.getByRole('button', { name: 'Show sidebar' })).toBeInTheDocument();
      a.unmount();
      window.localStorage.setItem('hitlist-sidebar-mode', 'sections');
      mount();
      expect(screen.getByText('My lists')).toBeInTheDocument();
    });
  });
});
