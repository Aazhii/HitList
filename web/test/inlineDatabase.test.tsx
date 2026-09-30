import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { create, createField, createRow, createView } = vi.hoisted(() => ({
  create: vi.fn(), createField: vi.fn(), createRow: vi.fn(), createView: vi.fn(),
}));
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  databaseApi: { create, createRow },
  fieldApi: { createField },
  viewApi: { create: createView },
}));

import { createInlineDatabase } from '@/lib/inlineDatabase';
import { SlashMenu, filterSlashCommands } from '@/components/notes/SlashMenu';

beforeEach(() => {
  create.mockReset().mockResolvedValue({ id: 'db1', name: 'Untitled database' });
  createField.mockReset().mockImplementation(async (input: { name: string }) => ({ id: `f-${input.name}`, name: input.name }));
  createRow.mockReset().mockResolvedValue({ id: 'r' });
  createView.mockReset().mockResolvedValue({ id: 'v' });
});

describe('createInlineDatabase', () => {
  it('makes the prototype\'s blank database: Name, Tags, Status, Date and three Untitled rows', async () => {
    const db = await createInlineDatabase('table');
    expect(db.id).toBe('db1');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Untitled database', titleLabel: 'Name' }));
    expect(createField.mock.calls.map(([f]) => f.name)).toEqual(['Tags', 'Status', 'Date']);
    expect(createRow).toHaveBeenCalledTimes(3);
    expect(createRow).toHaveBeenCalledWith('db1', { title: 'Untitled' });
    expect(createView).not.toHaveBeenCalled();
  });

  it('gives a board its "By status board" view, grouped by Status', async () => {
    await createInlineDatabase('board');
    expect(createView).toHaveBeenCalledWith(expect.objectContaining({
      name: 'By status board', layout: 'board', scopeDatabaseId: 'db1',
      filters: expect.objectContaining({ groupBy: 'f-Status' }),
    }));
  });
});

describe('the slash menu\'s database group', () => {
  it('offers three commands, found by typing "database", "board" or "link"', () => {
    expect(filterSlashCommands('database').map((c) => c.action)).toContain('db-table');
    expect(filterSlashCommands('board').map((c) => c.action)).toContain('db-board');
    expect(filterSlashCommands('link').map((c) => c.action)).toContain('db-linked');
  });

  it('captions each group once and hands the whole command to onSelect', () => {
    const onSelect = vi.fn();
    render(<SlashMenu query="" position={{ top: 0, left: 0 }} onSelect={onSelect} onClose={() => {}} selectedIndex={0} />);
    expect(screen.getByText('Basic blocks')).toBeInTheDocument();
    expect(screen.getByText('Database')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('option', { name: /Create board/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ action: 'db-board', type: 'database' }));
  });
});
