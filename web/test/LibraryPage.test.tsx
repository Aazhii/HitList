import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LibraryPage } from '@/pages/LibraryPage';
import type { PageInfo } from '@/lib/pages';

const directory: PageInfo[] = [
  { kind: 'list', id: 'l1', name: 'Work', dotClass: 'bg-violet-500' },
  { kind: 'note', id: 'n1', name: 'Onboarding plan', emoji: '🧭', editedAt: Date.now() - 3_600_000 },
  { kind: 'database', id: 'd1', name: 'Reading list', emoji: '📚' },
];

function setup(over: Partial<React.ComponentProps<typeof LibraryPage>> = {}) {
  const props = {
    directory, favorites: [{ kind: 'note' as const, id: 'n1' }], recents: [{ kind: 'database' as const, id: 'd1', visitedAt: Date.now() - 60_000 }],
    onOpen: vi.fn(), onCreate: vi.fn(), onOpenSource: vi.fn(), ...over,
  };
  render(<LibraryPage {...props} />);
  return props;
}

describe('LibraryPage', () => {
  it('starts on Recents, with when each was opened', () => {
    setup();
    expect(screen.getByRole('tab', { name: 'Recents' })).toHaveAttribute('aria-selected', 'true');
    const row = screen.getByRole('row', { name: /Reading list/ });
    expect(within(row).getByText('1m ago')).toBeInTheDocument();
    expect(screen.queryByText('Onboarding plan')).not.toBeInTheDocument();
  });

  it('switches tabs, and opens a row', () => {
    const { onOpen } = setup();
    fireEvent.click(screen.getByRole('tab', { name: 'Favorites' }));
    fireEvent.click(screen.getByRole('button', { name: /Onboarding plan/ }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ kind: 'note', id: 'n1' }));
    fireEvent.click(screen.getByRole('tab', { name: 'All pages' }));
    expect(screen.getAllByRole('row').length).toBe(1 + 3);
  });

  it('says what to do when there are no favorites', () => {
    setup({ favorites: [] });
    fireEvent.click(screen.getByRole('tab', { name: 'Favorites' }));
    expect(screen.getByText('Nothing here yet. Star a page to see it under Favorites.')).toBeInTheDocument();
    expect(screen.getByText('0 pages')).toBeInTheDocument();
  });

  it('searches by name, and the Source cell goes to that view', () => {
    const { onOpenSource } = setup();
    fireEvent.click(screen.getByRole('tab', { name: 'All pages' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Search pages' })[0]);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search pages' }), { target: { value: 'onb' } });
    expect(screen.getAllByRole('row')).toHaveLength(2);
    fireEvent.click(within(screen.getByRole('row', { name: /Onboarding plan/ })).getByRole('button', { name: /Notes/ }));
    expect(onOpenSource).toHaveBeenCalledWith('note');
  });

  it('creates a page of the chosen kind from New page', async () => {
    const { onCreate } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'New page' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Task list' }));
    expect(onCreate).toHaveBeenCalledWith('list');
  });
});
