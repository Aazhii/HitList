import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IconRail } from '@/components/shell/IconRail';

describe('IconRail', () => {
  it('shows supported views without advertising automations', () => {
    render(
      <IconRail
        activeView="tasks"
        onViewChange={vi.fn()}
        account={<span>Account</span>}
      />,
    );

    expect(screen.getByRole('button', { name: 'Tasks' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Databases' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Calendar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Automations' })).not.toBeInTheDocument();
  });
});
