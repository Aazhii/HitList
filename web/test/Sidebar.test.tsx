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

    it('Hide Sidebar removes it and leaves a button that brings it back; the choice is remembered', async () => {
      const user = userEvent.setup();
      const first = mount();
      await user.click(screen.getByRole('button', { name: 'Sidebar options' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Hide Sidebar' }));
      expect(screen.queryByRole('navigation', { name: 'Views' })).not.toBeInTheDocument();
      expect(window.localStorage.getItem('hitlist-sidebar-mode')).toBe('hidden');
      first.unmount();
      mount();
      await user.click(screen.getByRole('button', { name: 'Show sidebar' }));
      expect(screen.getByRole('navigation', { name: 'Views' })).toBeInTheDocument();
      expect(screen.getByText('My lists')).toBeInTheDocument();
    });

    it('Hide Sections keeps the views and hides the lists, notes and favorites under them', async () => {
      const user = userEvent.setup();
      mount();
      await user.click(screen.getByRole('button', { name: 'Sidebar options' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Hide Sections' }));
      expect(screen.getByRole('button', { name: 'Notes' })).toBeInTheDocument();
      expect(screen.queryByText('My lists')).not.toBeInTheDocument();
      expect(screen.queryByText('Favorites')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Sidebar options' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Show Sections' }));
      expect(screen.getByText('My lists')).toBeInTheDocument();
    });

    it('Show on hover keeps it out of sight until the pointer reaches the left edge', async () => {
      const user = userEvent.setup();
      mount();
      await user.click(screen.getByRole('button', { name: 'Sidebar options' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Show on hover' }));
      const aside = document.querySelector('aside') as HTMLElement;
      expect(aside).toHaveAttribute('aria-hidden', 'true');
      fireEvent.mouseEnter(screen.getByTestId('sidebar-hot-edge'));
      expect(aside).toHaveAttribute('aria-hidden', 'false');
    });

    it('Ctrl+\\ hides the sidebar and shows it again', () => {
      mount();
      fireEvent.keyDown(window, { key: '\\', ctrlKey: true });
      expect(screen.queryByRole('navigation', { name: 'Views' })).not.toBeInTheDocument();
      fireEvent.keyDown(window, { key: '\\', ctrlKey: true });
      expect(screen.getByRole('navigation', { name: 'Views' })).toBeInTheDocument();
    });
  });
});
