import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Sidebar } from '@/components/shell/Sidebar';

describe('Sidebar', () => {
  it('shows supported views without advertising automations', () => {
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
    expect(screen.queryByRole('button', { name: 'Automations' })).not.toBeInTheDocument();
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
});
