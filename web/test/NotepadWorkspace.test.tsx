import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { NotepadWorkspace } from '@/components/NotepadWorkspace';
import { useNotes } from '@/hooks/useNotes';
import { notesStorageKey } from '@/lib/notesStorage';
import { setActiveUserId } from '@/lib/storage';
import { FILE_EMOJI } from '@/lib/notepad';

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
