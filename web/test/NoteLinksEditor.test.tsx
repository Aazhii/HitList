import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NoteEditor } from '@/components/NoteEditor';
import type { NoteBlock } from '@/types/notes';
import type { PagesApi } from '@/components/notes/codeContext';
import { noteLinkMarkdown } from '@/lib/noteLinks';

afterEach(() => vi.restoreAllMocks());

const para = (id: string, content = ''): NoteBlock => ({ id, type: 'paragraph', content });

function setup(initial: NoteBlock[], titles: Record<string, string> = { n1: 'Roadmap', n2: 'Meeting notes' }) {
  let latest = initial;
  const created: string[] = [];
  const api: PagesApi = {
    get: (id) => (titles[id] ? { id, title: titles[id], emoji: '📝' } : undefined),
    open: vi.fn(),
    create: () => ({ id: 'sub', title: 'Untitled' }),
    getFile: (id) => (id === 'f1' ? { id, title: 'script.py' } : undefined),
    openFile: vi.fn(),
    linkables: () => [
      ...Object.entries(titles).map(([id, title]) => ({ id, title, emoji: '📝', kind: 'note' as const })),
      { id: 'f1', title: 'script.py', kind: 'file' as const },
    ],
    createNote: (title) => { created.push(title); return { id: `new-${created.length}`, title }; },
  };
  function Editor() {
    const [blocks, setBlocks] = useState(initial);
    return <NoteEditor
      blocks={blocks}
      onUpdateBlock={(id, changes) => setBlocks((cur) => { const out = cur.map((x) => (x.id === id ? { ...x, ...changes } : x)); latest = out; return out; })}
      onAddBlock={() => 'x'} onDeleteBlock={vi.fn()} onChangeBlockType={vi.fn()} onMoveBlock={vi.fn()}
      pages={api}
      noteId="here"
    />;
  }
  render(<Editor />);
  return { blocks: () => latest, api, created };
}

const typeInto = (box: HTMLElement, value: string) => {
  const ta = box as HTMLTextAreaElement;
  ta.focus();
  fireEvent.change(ta, { target: { value } });
  ta.setSelectionRange(value.length, value.length);
  fireEvent.select(ta);
  fireEvent.keyUp(ta, { key: value.at(-1) ?? 'a' });
};

describe('a link to a note inside a line', () => {
  it('shows the note\'s live title as a chip (not the markdown), and opens it on click', () => {
    const t = setup([para('a', `see ${noteLinkMarkdown('note', 'n1', 'Old name')} now`), para('b', '')]);
    const chip = screen.getByRole('button', { name: 'Page: Roadmap' });
    expect(chip).toHaveTextContent('Roadmap');
    // The raw markdown lives only in the hidden text box underneath, never in what is drawn.
    expect(screen.queryAllByText(/hitlist:\/\//).filter((el) => el.tagName !== 'TEXTAREA')).toEqual([]);
    fireEvent.click(chip);
    expect(t.api.open).toHaveBeenCalledWith('n1');
  });

  it('a link to a Notepad file opens Notepad', () => {
    const t = setup([para('a', noteLinkMarkdown('file', 'f1', 'x')), para('b', '')]);
    fireEvent.click(screen.getByRole('button', { name: 'File: script.py' }));
    expect(t.api.openFile).toHaveBeenCalledWith('f1');
  });

  it('a link to something that is gone is shown quietly, with the text that was linked', () => {
    setup([para('a', noteLinkMarkdown('note', 'gone', 'Lost page')), para('b', '')]);
    const chip = screen.getByTitle('Not available here');
    expect(chip).toHaveTextContent('Lost page');
  });

  it('an ordinary web link is still an ordinary link', () => {
    setup([para('a', '[docs](https://example.com/x)'), para('b', '')]);
    expect(screen.getByRole('link', { name: 'docs' })).toHaveAttribute('href', 'https://example.com/x');
  });
});

describe('typing [[ to link', () => {
  it('lists pages and files, narrows as you type, and Enter makes the link', async () => {
    const t = setup([para('a', ''), para('b', '')]);
    typeInto(screen.getAllByRole('textbox')[0], 'see [[');
    const menu = await screen.findByRole('listbox', { name: 'Link to a page or file' });
    expect(within(menu).getAllByRole('option').map((o) => o.getAttribute('aria-label'))).toEqual(['Roadmap', 'Meeting notes', 'script.py']);
    typeInto(screen.getAllByRole('textbox')[0], 'see [[meet');
    await waitFor(() => expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.getAttribute('aria-label'))).toEqual(['Meeting notes', 'Create page "meet"']));
    fireEvent.keyDown(screen.getAllByRole('textbox')[0], { key: 'Enter' });
    await waitFor(() => expect(t.blocks()[0].content).toBe('see [Meeting notes](hitlist://note/n2)'));
    expect(screen.queryByRole('listbox', { name: 'Link to a page or file' })).toBeNull();
  });

  it('arrows move the choice, and a click on an option links it', async () => {
    const t = setup([para('a', ''), para('b', '')]);
    typeInto(screen.getAllByRole('textbox')[0], '[[');
    await screen.findByRole('listbox');
    fireEvent.keyDown(screen.getAllByRole('textbox')[0], { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getAllByRole('textbox')[0], { key: 'Enter' });
    await waitFor(() => expect(t.blocks()[0].content).toBe('[Meeting notes](hitlist://note/n2)'));
    typeInto(screen.getAllByRole('textbox')[1], '[[');
    fireEvent.click(await screen.findByRole('option', { name: 'script.py' }));
    await waitFor(() => expect(t.blocks()[1].content).toBe('[script.py](hitlist://file/f1)'));
  });

  it('"Create page" makes a new note with the typed title and links it', async () => {
    const t = setup([para('a', ''), para('b', '')]);
    typeInto(screen.getAllByRole('textbox')[0], '[[Brand new');
    fireEvent.click(await screen.findByRole('option', { name: 'Create page "Brand new"' }));
    await waitFor(() => expect(t.blocks()[0].content).toBe('[Brand new](hitlist://note/new-1)'));
    expect(t.created).toEqual(['Brand new']);
  });

  it('Esc closes the menu and leaves the text as typed', async () => {
    const t = setup([para('a', ''), para('b', '')]);
    typeInto(screen.getAllByRole('textbox')[0], 'x [[ro');
    await screen.findByRole('listbox');
    fireEvent.keyDown(screen.getAllByRole('textbox')[0], { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(t.blocks()[0].content).toBe('x [[ro');
  });

  it('does not open when the editor has no way to look pages up', () => {
    render(<NoteEditor blocks={[para('a', '')]} onUpdateBlock={vi.fn()} onAddBlock={() => 'x'} onDeleteBlock={vi.fn()} onChangeBlockType={vi.fn()} onMoveBlock={vi.fn()} />);
    typeInto(screen.getAllByRole('textbox')[0], 'a [[');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
