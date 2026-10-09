import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { NoteEditor } from '@/components/NoteEditor';
import type { NoteBlock } from '@/types/notes';
import type { CodeFilesApi } from '@/components/notes/codeContext';
import { FILE_EMOJI, newFileParts } from '@/lib/notepad';
import { fromClipboard, toClipboard } from '@/lib/noteClipboard';

afterEach(() => vi.restoreAllMocks());

const para = (id: string, content = ''): NoteBlock => ({ id, type: 'paragraph', content });
const viewIn = (el: Element) => EditorView.findFromDOM(el.querySelector('.cm-editor') as HTMLElement)!;

function setup(initial: NoteBlock[], files: Array<{ id: string; title: string; blocks: NoteBlock[] }> = []) {
  let latest = initial;
  const fileState = new Map(files.map((f) => [f.id, f]));
  const created: string[] = [];
  const api: CodeFilesApi = {
    files: files.map((f) => ({ id: f.id, title: f.title, language: f.blocks[0]?.language ?? 'plaintext' })),
    get: (id) => fileState.get(id),
    setBlocks: vi.fn((id: string, blocks: NoteBlock[]) => { const f = fileState.get(id); if (f) fileState.set(id, { ...f, blocks }); }),
    create: () => { const parts = newFileParts(); const id = `new-${created.length}`; fileState.set(id, { id, title: parts.title, blocks: parts.blocks }); created.push(id); return id; },
    open: vi.fn(),
  };
  function Editor() {
    const [blocks, setBlocks] = useState(initial);
    const set = (fn: (x: NoteBlock[]) => NoteBlock[]) => setBlocks((cur) => { const out = fn(cur); latest = out; return out; });
    return <NoteEditor
      blocks={blocks}
      onUpdateBlock={(id, changes) => set((cur) => cur.map((x) => (x.id === id ? { ...x, ...changes } : x)))}
      onAddBlock={() => 'x'}
      onDeleteBlock={(id) => set((cur) => cur.filter((x) => x.id !== id))}
      onChangeBlockType={(id, type) => set((cur) => cur.map((x) => (x.id === id ? { ...x, type } : x)))}
      onMoveBlock={vi.fn()}
      onSetBlocks={(next) => { latest = next; setBlocks(next); }}
      codeFiles={api}
      noteId="n"
    />;
  }
  const view = render(<Editor />);
  return { blocks: () => latest, api, container: view.container };
}

describe('code blocks in a note', () => {
  it('a code block is the code editor with a language, saved on the block', async () => {
    const t = setup([para('a', 'intro'), { id: 'c', type: 'code', content: 'x = 1', language: 'python' }]);
    await waitFor(() => expect(t.container.querySelector('[data-code-block] .cm-editor')).not.toBeNull());
    const wrapper = t.container.querySelector('[data-code-block]') as HTMLElement;
    expect((screen.getByLabelText('Language') as HTMLSelectElement).value).toBe('python');
    act(() => viewIn(wrapper).dispatch({ changes: { from: 5, insert: '\ny = 2' }, userEvent: 'input.type' }));
    expect(t.blocks()[1].content).toBe('x = 1\ny = 2');
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'go' } });
    expect(t.blocks()[1].language).toBe('go');
    expect(t.blocks()[1].content).toBe('x = 1\ny = 2');
  });

  it('Esc inside a code block chooses the block; ⌘F inside it is the editor\'s own, not the note\'s', async () => {
    const t = setup([para('a', 'intro'), { id: 'c', type: 'code', content: 'x', language: 'python' }]);
    await waitFor(() => expect(t.container.querySelector('[data-code-block] .cm-editor')).not.toBeNull());
    const content = (t.container.querySelector('[data-code-block] .cm-content') as HTMLElement);
    fireEvent.keyDown(content, { key: 'f', metaKey: true });
    expect(screen.queryByRole('search')).toBeNull();
    fireEvent.keyDown(content, { key: 'Escape' });
    expect(t.container.querySelector('[data-block-id="c"]')?.getAttribute('data-selected')).toBe('true');
  });

  it('arrow down on the last line moves to the next block', async () => {
    const t = setup([{ id: 'c', type: 'code', content: 'x', language: 'python' }, para('b', 'after')]);
    await waitFor(() => expect(t.container.querySelector('[data-code-block] .cm-editor')).not.toBeNull());
    const content = t.container.querySelector('[data-code-block] .cm-content') as HTMLElement;
    fireEvent.keyDown(content, { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByDisplayValue('after')));
  });

  it('Copy puts the code on the clipboard', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    const t = setup([{ id: 'c', type: 'code', content: 'print(1)', language: 'python' }]);
    await waitFor(() => expect(t.container.querySelector('[data-code-block] .cm-editor')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /copy/i }));
    expect(write).toHaveBeenCalledWith('print(1)');
  });

  it('a copied code block keeps its language when pasted', () => {
    const blocks: NoteBlock[] = [{ id: 'c', type: 'code', content: 'x', language: 'rust', codeIndent: '4', codeWrap: true }];
    const pasted = fromClipboard(toClipboard(blocks, new Set(['c']))!.json)!;
    expect(pasted[0]).toMatchObject({ type: 'code', language: 'rust', codeIndent: '4', codeWrap: true });
  });
});

describe('a Notepad file shown in a note', () => {
  const file = { id: 'f1', title: 'script.py', blocks: [{ id: 'f1-b', type: 'code', content: 'print(1)', language: 'python' } as NoteBlock] };

  it('shows the file live, saves edits to the file (not the note), and keeps the file when the block is removed', async () => {
    const t = setup([para('a', 'intro'), { id: 'cf', type: 'codefile', content: '', fileId: 'f1' }], [file]);
    await waitFor(() => expect(t.container.querySelector('[data-code-file="f1"] .cm-editor')).not.toBeNull());
    const box = t.container.querySelector('[data-code-file="f1"]') as HTMLElement;
    expect(box.textContent).toContain('script.py');
    act(() => viewIn(box).dispatch({ changes: { from: 8, insert: '\nprint(2)' }, userEvent: 'input.type' }));
    expect(t.api.setBlocks).toHaveBeenCalledTimes(1);
    const [id, blocks] = (t.api.setBlocks as ReturnType<typeof vi.fn>).mock.calls[0] as [string, NoteBlock[]];
    expect(id).toBe('f1');
    expect(blocks[0].content).toBe('print(1)\nprint(2)');
    expect(t.blocks()[1].content).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Remove from this note' }));
    expect(t.blocks().map((x) => x.id)).toEqual(['a']);
    expect(t.api.get('f1')).toBeTruthy();
  });

  it('Open sends you to Notepad', async () => {
    const t = setup([{ id: 'cf', type: 'codefile', content: '', fileId: 'f1' }], [file]);
    await waitFor(() => expect(t.container.querySelector('[data-code-file]')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /^open$/i }));
    expect(t.api.open).toHaveBeenCalledWith('f1');
  });

  it('says so when the file is not there, and lets the block be removed', async () => {
    const t = setup([para('a'), { id: 'cf', type: 'codefile', content: '', fileId: 'gone' }]);
    await screen.findByText(/File not available here/);
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(t.blocks().map((x) => x.id)).toEqual(['a']);
  });

  it('/file offers the files, and choosing one turns the line into that file', async () => {
    const t = setup([para('a', '')], [file]);
    const box = screen.getByDisplayValue('');
    fireEvent.change(box, { target: { value: '/' } });
    fireEvent.change(box, { target: { value: '/file' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: 'Show script.py' }));
    expect(t.blocks()[0]).toMatchObject({ type: 'codefile', fileId: 'f1' });
    await waitFor(() => expect(t.container.querySelector('[data-code-file="f1"] .cm-editor')).not.toBeNull());
  });

  it('/file → New file makes an empty file and shows it', async () => {
    const t = setup([para('a', '')]);
    const box = screen.getByDisplayValue('');
    fireEvent.change(box, { target: { value: '/' } });
    fireEvent.change(box, { target: { value: '/file' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('button', { name: 'New file' }));
    expect(t.blocks()[0]).toMatchObject({ type: 'codefile', fileId: 'new-0' });
    expect(newFileParts().emoji).toBe(FILE_EMOJI);
  });
});
