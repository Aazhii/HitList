import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommandPalette } from '@/components/CommandPalette';
import { searchPalette, type PaletteItem } from '@/lib/paletteSearch';

const items: PaletteItem[] = [
  { kind: 'list', id: 'l1', title: 'Work' },
  { kind: 'database', id: 'd1', title: 'Reading list', emoji: '📚' },
  { kind: 'note', id: 'n1', title: 'Onboarding plan' },
  { kind: 'task', id: 't1', title: 'Plan offsite agenda', hint: 'Work' },
  { kind: 'task', id: 't2', title: 'Reply to legal' },
];

describe('searchPalette', () => {
  it('groups in a fixed order and drops what does not match', () => {
    const groups = searchPalette(items, 'plan');
    expect(groups.map((g) => g.kind)).toEqual(['note', 'task']);
    expect(groups[1].items.map((i) => i.id)).toEqual(['t1']);
  });

  it('needs every word, and puts a title that starts with the query first', () => {
    expect(searchPalette(items, 'reading list')[0].items[0].id).toBe('d1');
    const tasks: PaletteItem[] = [
      { kind: 'task', id: 'a', title: 'Draft the plan' },
      { kind: 'task', id: 'b', title: 'Plan the draft' },
    ];
    expect(searchPalette(tasks, 'plan')[0].items.map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('lists a few of each kind for an empty query', () => {
    expect(searchPalette(items, '').flatMap((g) => g.items)).toHaveLength(5);
  });
});

describe('CommandPalette', () => {
  function setup() {
    const onOpenItem = vi.fn();
    const onOpenChange = vi.fn();
    render(<CommandPalette open onOpenChange={onOpenChange} getItems={() => items} onOpenItem={onOpenItem} />);
    return { onOpenItem, onOpenChange };
  }

  it('filters across kinds as you type, and opens the highlighted one on Enter', async () => {
    const { onOpenItem, onOpenChange } = setup();
    await screen.findByRole('option', { name: /Onboarding plan/ });
    const box = screen.getByRole('combobox', { name: 'Search' });
    fireEvent.change(box, { target: { value: 'plan' } });
    expect(screen.getAllByRole('option')).toHaveLength(2);
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ kind: 'task', id: 't1' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('opens what is clicked', async () => {
    const { onOpenItem } = setup();
    fireEvent.click(await screen.findByRole('option', { name: /Reading list/ }));
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ kind: 'database', id: 'd1' }));
  });

  it('says so when nothing matches', async () => {
    setup();
    await screen.findAllByRole('option');
    fireEvent.change(screen.getByRole('combobox', { name: 'Search' }), { target: { value: 'zzz' } });
    await waitFor(() => expect(screen.getByText(/Nothing matches/)).toBeInTheDocument());
  });
});
