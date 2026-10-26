import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { NotepadWorkspace } from '@/components/NotepadWorkspace';
import { useNotes } from '@/hooks/useNotes';
import { notesStorageKey } from '@/lib/notesStorage';
import { setActiveUserId } from '@/lib/storage';
import { FILE_EMOJI } from '@/lib/notepad';
import { Toaster } from '@/components/ui/sonner';

const file = (id: string, title: string, content: string, language = 'python') => ({
  id, title, emoji: FILE_EMOJI, createdAt: 1, updatedAt: 1, pinned: false,
  blocks: [{ id: `${id}-b`, type: 'code', content, language }],
});
const note = { id: 'n1', title: 'A normal note', emoji: '📝', createdAt: 1, updatedAt: 1, pinned: false, blocks: [{ id: 'p', type: 'paragraph', content: 'hi' }] };
const stored = () => JSON.parse(localStorage.getItem(notesStorageKey('12345')) ?? '[]') as Array<ReturnType<typeof file>>;

beforeEach(() => {
  setActiveUserId('12345');
  localStorage.setItem(notesStorageKey('12345'), JSON.stringify([note, file('f1', 'script.py', 'print(1)'), file('f2', 'query.sql', 'SELECT 1', 'sql')]));
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('[]', { status: 200 }));
});
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); setActiveUserId(null); });

const editorView = (container: HTMLElement) => EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!;

describe('notes and files share one store but show separately', () => {
  it('Notes shows only notes, Notepad only files', async () => {
    const notes = renderHook(() => useNotes());
    await waitFor(() => expect(notes.result.current.isLoading).toBe(false));
    expect(notes.result.current.notes.map((n) => n.id)).toEqual(['n1']);
    expect(notes.result.current.activeNote?.id).toBe('n1');
    const files = renderHook(() => useNotes({ files: true }));
    await waitFor(() => expect(files.result.current.isLoading).toBe(false));
    expect(files.result.current.notes.map((n) => n.id).sort()).toEqual(['f1', 'f2']);
    expect(files.result.current.activeNote?.id).not.toBe('n1');
  });

  it('what one view saves keeps the other view\'s items in the store', async () => {
    const files = renderHook(() => useNotes({ files: true }));
    await waitFor(() => expect(files.result.current.isLoading).toBe(false));
    act(() => files.result.current.updateNoteTitle('f1', 'renamed.py'));
    expect(stored().map((n) => n.id).sort()).toEqual(['f1', 'f2', 'n1']);
    expect(stored().find((n) => n.id === 'f1')?.title).toBe('renamed.py');
  });
});

describe('Notepad page', () => {
  it('lists the files (not the notes) and opens one in the editor with its language', async () => {
    const { container } = render(<NotepadWorkspace onSidebarContentChange={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull());
    expect(screen.queryByText('A normal note')).toBeNull();
    expect((screen.getByLabelText('File name') as HTMLInputElement).value).toMatch(/\.(py|sql)$/);
    expect(screen.getByLabelText('Language')).toBeInTheDocument();
  });

  it('the page title steps aside once the file is scrolled, and comes back at the top, losing no control', async () => {
    const { container } = render(<NotepadWorkspace onSidebarContentChange={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull());
    const view = editorView(container);
    const heading = screen.getByRole('heading', { name: 'Notepad' });
    const scrollTo = (top: number) => act(() => {
      Object.defineProperty(view.scrollDOM, 'scrollTop', { value: top, configurable: true });
      view.scrollDOM.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    expect(heading.className).toContain('text-[32px]');

    scrollTo(60);
    await waitFor(() => expect(heading.className).toContain('text-[16px]'));
    // It shrinks rather than going away, and everything it shares its row with is still there to click.
    expect(screen.getByRole('heading', { name: 'Notepad' })).toBe(heading);
    expect(screen.getByLabelText('New file')).toBeInTheDocument();
    expect(screen.getByLabelText('File name')).toBeInTheDocument();
    expect(screen.getByLabelText('Language')).toBeInTheDocument();

    scrollTo(0);
    await waitFor(() => expect(heading.className).toContain('text-[32px]'));
  });

  it('opening another file puts the page title back to full size', async () => {
    const { container, rerender } = render(<NotepadWorkspace onSidebarContentChange={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull());
    const view = editorView(container);
    act(() => {
      Object.defineProperty(view.scrollDOM, 'scrollTop', { value: 60, configurable: true });
      view.scrollDOM.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    const heading = screen.getByRole('heading', { name: 'Notepad' });
    await waitFor(() => expect(heading.className).toContain('text-[16px]'));

    // Another file starts at its own first line, so the header starts open again.
    const open = (screen.getByLabelText('File name') as HTMLInputElement).value;
    rerender(<NotepadWorkspace onSidebarContentChange={vi.fn()} openNoteId={open === 'script.py' ? 'f2' : 'f1'} />);
    await waitFor(() => expect(heading.className).toContain('text-[32px]'));
  });

  it('Beautify lays the JSON out at the file\'s indentation and saves it; it is not offered for other languages', async () => {
    localStorage.setItem(notesStorageKey('12345'), JSON.stringify([
      file('j1', 'body.json', '{"a":1,"b":[1,2]}', 'json'),
    ]));
    const { container } = render(<NotepadWorkspace onSidebarContentChange={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /Beautify/ }));
    await waitFor(() => expect(stored().find((n) => n.id === 'j1')?.blocks[0].content)
      .toBe('{\n    "a": 1,\n    "b": [\n        1,\n        2\n    ]\n}'));

    // The indentation the file is set to is the one it uses.
    fireEvent.change(screen.getByLabelText('Indentation'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /Beautify/ }));
    await waitFor(() => expect(stored().find((n) => n.id === 'j1')?.blocks[0].content)
      .toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}'));

    // Another language has no Beautify: this one is for JSON.
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'python' } });
    await waitFor(() => expect(screen.queryByRole('button', { name: /Beautify/ })).toBeNull());
  });

  it('with something selected, Beautify lays out only that piece and leaves the rest alone', async () => {
    const source = '{\n    "a": 1,\n    "b": {"x":1,"y":[2,3]},\n    "c": 3\n}';
    localStorage.setItem(notesStorageKey('12345'), JSON.stringify([file('j1', 'b.json', source, 'json')]));
    const { container } = render(<NotepadWorkspace onSidebarContentChange={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull());
    const view = editorView(container);

    // Just the object that is the value of "b".
    const from = source.indexOf('{"x"');
    const to = source.indexOf('}', source.indexOf('[2,3]')) + 1;
    act(() => view.dispatch({ selection: { anchor: from, head: to } }));
    fireEvent.click(screen.getByRole('button', { name: /Beautify/ }));

    await waitFor(() => expect(view.state.doc.toString()).toContain('"x": 1'));
    // The piece is laid out and sits at the indentation of the line it started on; nothing else moved.
    expect(view.state.doc.toString()).toBe(
      '{\n    "a": 1,\n    "b": {\n        "x": 1,\n        "y": [\n            2,\n            3\n        ]\n    },\n    "c": 3\n}',
    );
  });

  it('a selection that is not JSON on its own is refused, and nothing moves', async () => {
    const source = '{\n    "a": 1,\n    "b": 2\n}';
    localStorage.setItem(notesStorageKey('12345'), JSON.stringify([file('j1', 'b.json', source, 'json')]));
    // The toast surface has to be mounted for a refusal to be visible at all.
    const { container } = render(<><NotepadWorkspace onSidebarContentChange={vi.fn()} /><Toaster /></>);
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull());
    const view = editorView(container);

    const from = source.indexOf('"a"');
    act(() => view.dispatch({ selection: { anchor: from, head: from + 7 } }));
    fireEvent.click(screen.getByRole('button', { name: /Beautify/ }));
    expect(await screen.findByText(/not a piece of JSON on its own/)).toBeInTheDocument();
    expect(view.state.doc.toString()).toBe(source);
  });

  it('Beautify leaves text that is not valid JSON exactly as it is, and says what is wrong', async () => {
    const broken = '{\n  "a": 1,\n  "b":\n}';
    localStorage.setItem(notesStorageKey('12345'), JSON.stringify([file('j1', 'body.json', broken, 'json')]));
    const { container } = render(<><NotepadWorkspace onSidebarContentChange={vi.fn()} /><Toaster /></>);
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /Beautify/ }));
    expect(await screen.findByText(/cannot be laid out until the JSON is valid/)).toBeInTheDocument();
    // Both the message and the editor's own warning strip name the line; either one is enough to find it.
    expect(screen.getAllByText(/Line 4: Missing a value/).length).toBeGreaterThan(0);
    expect(stored().find((n) => n.id === 'j1')?.blocks[0].content).toBe(broken);
  });

  it('typing is saved into the file\'s code block', async () => {
    const { container } = render(<NotepadWorkspace onSidebarContentChange={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull());
    const view = editorView(container);
    const open = (screen.getByLabelText('File name') as HTMLInputElement).value;
    const id = open === 'script.py' ? 'f1' : 'f2';
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: ' # more' }, userEvent: 'input.type' }));
    await waitFor(() => expect(stored().find((n) => n.id === id)?.blocks[0].content).toMatch(/ # more$/));
    expect(stored().find((n) => n.id === id)?.blocks[0].type).toBe('code');
  });

  it('changing the language and indentation is saved on the file', async () => {
    const { container } = render(<NotepadWorkspace onSidebarContentChange={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull());
    const open = (screen.getByLabelText('File name') as HTMLInputElement).value;
    const id = open === 'script.py' ? 'f1' : 'f2';
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'go' } });
    fireEvent.change(screen.getByLabelText('Indentation'), { target: { value: 'tab' } });
    await waitFor(() => expect(stored().find((n) => n.id === id)?.blocks[0]).toMatchObject({ language: 'go', codeIndent: 'tab' }));
  });

  it('naming a plain file `report.py` colours it as Python', async () => {
    const onChange = vi.fn();
    localStorage.setItem(notesStorageKey('12345'), JSON.stringify([file('f9', 'Untitled', 'x', 'plaintext')]));
    render(<NotepadWorkspace onSidebarContentChange={onChange} />);
    const name = await screen.findByLabelText('File name');
    fireEvent.change(name, { target: { value: 'report.py' } });
    fireEvent.blur(name);
    await waitFor(() => expect(stored()[0].blocks[0].language).toBe('python'));
  });

  it('Copy puts the whole file on the clipboard; Download saves it under a name with the right extension', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    const created: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => { created.push(b as Blob); return 'blob:f'; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    let saved = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { saved = this.download; });
    const { container } = render(<NotepadWorkspace onSidebarContentChange={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull());
    const text = editorView(container).state.doc.toString();
    fireEvent.click(screen.getByRole('button', { name: /copy/i }));
    expect(write).toHaveBeenCalledWith(text);
    fireEvent.click(screen.getByRole('button', { name: /download/i }));
    expect(saved).toMatch(/\.(py|sql)$/);
    expect(await created[0].text()).toBe(text);
  });

  it('a new file is created as a note with the marker and one empty code block', async () => {
    render(<NotepadWorkspace onSidebarContentChange={vi.fn()} />);
    await screen.findByLabelText('File name');
    fireEvent.click(screen.getAllByRole('button', { name: 'New file' })[0]);
    await waitFor(() => expect(stored().filter((n) => n.emoji === FILE_EMOJI)).toHaveLength(3));
    const created = stored().find((n) => n.emoji === FILE_EMOJI && !['f1', 'f2'].includes(n.id))!;
    expect(created.blocks).toHaveLength(1);
    expect(created.blocks[0]).toMatchObject({ type: 'code', content: '', language: 'plaintext' });
  });

  it('deleting a file asks first and removes only that file', async () => {
    render(<NotepadWorkspace onSidebarContentChange={vi.fn()} />);
    await screen.findByLabelText('File name');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'File options' }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitem', { name: /delete file/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(stored()).toHaveLength(2));
    expect(stored().some((n) => n.id === 'n1')).toBe(true);
  });
});
