import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { useState, type ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NotesWorkspace } from '@/components/NotesWorkspace';
import { ViewLayoutContext } from '@/components/shell/ViewLayout';
import { notesStorageKey } from '@/lib/notesStorage';
import { setActiveUserId } from '@/lib/storage';

type Stored = { id: string; title: string; emoji?: string; blocks: Array<Record<string, unknown>>; updatedAt: number; createdAt: number; pinned?: boolean };
const note = (id: string, title: string, blocks: Array<Record<string, unknown>> = [{ id: `${id}-p`, type: 'paragraph', content: '' }], updatedAt = 1): Stored =>
  ({ id, title, emoji: '📝', blocks, createdAt: 1, updatedAt, pinned: false });
const pageBlock = (pageId: string) => ({ id: `pb-${pageId}`, type: 'page', content: pageId, pageId });
const stored = () => JSON.parse(localStorage.getItem(notesStorageKey('12345')) ?? '[]') as Stored[];
const seed = (notes: Stored[]) => localStorage.setItem(notesStorageKey('12345'), JSON.stringify(notes));

// root ─ child ─ grand
//      └ sibling          other (top level)
const tree = () => [
  note('root', 'Root', [pageBlock('child'), pageBlock('sibling')], 10),
  note('child', 'Child', [pageBlock('grand')], 9),
  note('grand', 'Grand', undefined, 8),
  note('sibling', 'Sibling', undefined, 7),
  note('other', 'Other', undefined, 6),
];

function Harness() {
  const [sidebar, setSidebar] = useState<ReactNode>(null);
  return (
    <ViewLayoutContext.Provider value={{ openContext: () => {}, closeContext: () => {}, toggleCollapsed: () => {}, collapsible: false, collapsed: false }}>
      <aside aria-label="sidebar">{sidebar}</aside>
      <NotesWorkspace onSidebarContentChange={setSidebar} />
    </ViewLayoutContext.Provider>
  );
}
const sidebar = () => within(screen.getByLabelText('sidebar'));

beforeEach(() => {
  setActiveUserId('12345');
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('[]', { status: 200 }));
});
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); setActiveUserId(null); });

describe('the page tree in the sidebar', () => {
  it('shows top-level pages, and a page\'s sub-pages once it is opened with its arrow', async () => {
    seed(tree());
    render(<Harness />);
    await sidebar().findByText('Root');
    expect(sidebar().queryByText('Child')).toBeNull();
    expect(sidebar().getByText('Other')).toBeInTheDocument();
    fireEvent.click(sidebar().getByRole('button', { name: 'Expand Root' }));
    expect(sidebar().getByText('Child')).toBeInTheDocument();
    expect(sidebar().getByText('Sibling')).toBeInTheDocument();
    expect(sidebar().queryByText('Grand')).toBeNull();
    fireEvent.click(sidebar().getByRole('button', { name: 'Expand Child' }));
    expect(sidebar().getByText('Grand')).toBeInTheDocument();
    fireEvent.click(sidebar().getByRole('button', { name: 'Collapse Root' }));
    expect(sidebar().queryByText('Child')).toBeNull();
  });

  it('opening a deep page opens what it sits under, and shows its path above the title', async () => {
    seed(tree());
    render(<Harness />);
    await sidebar().findByText('Root');
    fireEvent.click(sidebar().getByRole('button', { name: 'Expand Root' }));
    fireEvent.click(sidebar().getByRole('button', { name: 'Expand Child' }));
    fireEvent.click(sidebar().getByRole('button', { name: /^Grand/ }));
    const path = await screen.findByRole('navigation', { name: 'Page path' });
    expect(within(path).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['📝 Root', '📝 Child']);
    fireEvent.click(within(path).getByRole('button', { name: /Root/ }));
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Page path' })).toBeNull());
  });
});

describe('making pages inside pages', () => {
  it('the + on a row makes an empty page inside it, links it, and opens it', async () => {
    seed(tree());
    render(<Harness />);
    await sidebar().findByText('Other');
    fireEvent.click(sidebar().getByRole('button', { name: 'Add a page inside Other' }));
    await waitFor(() => expect(stored()).toHaveLength(6));
    const created = stored().find((n) => !['root', 'child', 'grand', 'sibling', 'other'].includes(n.id))!;
    const other = stored().find((n) => n.id === 'other')!;
    expect(other.blocks.some((b) => b.type === 'page' && b.pageId === created.id)).toBe(true);
    // The empty line the note started with is used up by the link, not left behind.
    expect(other.blocks).toHaveLength(1);
    expect(created.title).toBe('Untitled');
    expect(await screen.findByRole('navigation', { name: 'Page path' })).toBeInTheDocument();
  });

  it('/page in a note turns the line into a page, makes the page, and opens it', async () => {
    seed([note('other', 'Other')]);
    render(<Harness />);
    const line = await screen.findByLabelText(/Block 1/);
    fireEvent.change(line, { target: { value: '/' } });
    fireEvent.change(line, { target: { value: '/page' } });
    fireEvent.keyDown(line, { key: 'Enter' });
    await waitFor(() => expect(stored()).toHaveLength(2));
    const child = stored().find((n) => n.id !== 'other')!;
    const parent = stored().find((n) => n.id === 'other')!;
    expect(parent.blocks[0]).toMatchObject({ type: 'page', pageId: child.id });
    expect(await screen.findByRole('navigation', { name: 'Page path' })).toBeInTheDocument();
  });

  it('a page block shows the page\'s live title and opens it; a missing page says so', async () => {
    seed([note('p', 'Parent', [pageBlock('k'), pageBlock('ghost')], 5), note('k', 'Kid renamed', undefined, 4)]);
    render(<Harness />);
    const kid = await screen.findByRole('button', { name: /Kid renamed/ });
    expect(screen.getByText(/Page not available here/)).toBeInTheDocument();
    fireEvent.click(kid);
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Page path' })).toBeInTheDocument());
  });
});

describe('deleting a page that holds pages', () => {
  const open = async (name: string) => {
    render(<Harness />);
    await sidebar().findByText('Root');
    fireEvent.pointerDown(await screen.findByRole('button', { name: `Options for ${name}` }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitem', { name: /delete/i }));
  };

  it('offers to keep the sub-pages, which then become top-level notes', async () => {
    seed(tree());
    await open('Root');
    expect(await screen.findByText(/has 3 pages inside it/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete only this page' }));
    await waitFor(() => expect(stored().map((n) => n.id).sort()).toEqual(['child', 'grand', 'other', 'sibling']));
    // Child still holds Grand; Root is gone, so Child and Sibling are top-level.
    expect(stored().find((n) => n.id === 'child')!.blocks.some((b) => b.pageId === 'grand')).toBe(true);
    await sidebar().findByText('Child');
    expect(sidebar().getByText('Sibling')).toBeInTheDocument();
  });

  it('or deletes the whole branch', async () => {
    seed(tree());
    await open('Root');
    fireEvent.click(await screen.findByRole('button', { name: 'Delete with 3 pages' }));
    await waitFor(() => expect(stored().map((n) => n.id)).toEqual(['other']));
  });

  it('deleting a sub-page removes its link from its parent', async () => {
    seed(tree());
    render(<Harness />);
    await sidebar().findByText('Root');
    fireEvent.click(sidebar().getByRole('button', { name: 'Expand Root' }));
    fireEvent.pointerDown(await screen.findByRole('button', { name: 'Options for Sibling' }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitem', { name: /delete/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(stored().some((n) => n.id === 'sibling')).toBe(false));
    expect(stored().find((n) => n.id === 'root')!.blocks.some((b) => b.pageId === 'sibling')).toBe(false);
    expect(stored().find((n) => n.id === 'root')!.blocks.some((b) => b.pageId === 'child')).toBe(true);
  });
});

describe('moving a page', () => {
  it('Move to puts the open page under another, updating both parents', async () => {
    seed(tree());
    render(<Harness />);
    await sidebar().findByText('Root');
    fireEvent.click(sidebar().getByRole('button', { name: 'Expand Root' }));
    fireEvent.click(sidebar().getByRole('button', { name: /^Sibling/ }));
    await screen.findByRole('navigation', { name: 'Page path' });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Note options' }), { button: 0, ctrlKey: false });
    const trigger = await screen.findByRole('menuitem', { name: /move to/i });
    fireEvent.keyDown(trigger, { key: 'ArrowRight' });
    fireEvent.click(await screen.findByRole('menuitem', { name: /Other/ }));
    await waitFor(() => expect(stored().find((n) => n.id === 'other')!.blocks.some((b) => b.pageId === 'sibling')).toBe(true));
    expect(stored().find((n) => n.id === 'root')!.blocks.some((b) => b.pageId === 'sibling')).toBe(false);
  });

  it('never offers a page\'s own sub-pages as somewhere to move it', async () => {
    seed(tree());
    render(<Harness />);
    await sidebar().findByText('Root');
    fireEvent.click(sidebar().getByRole('button', { name: /^Root/ }));
    fireEvent.pointerDown(await screen.findByRole('button', { name: 'Note options' }), { button: 0, ctrlKey: false });
    fireEvent.keyDown(await screen.findByRole('menuitem', { name: /move to/i }), { key: 'ArrowRight' });
    await screen.findByRole('menuitem', { name: /Other/ });
    for (const name of ['Child', 'Grand', 'Sibling']) expect(screen.queryByRole('menuitem', { name })).toBeNull();
  });
});
