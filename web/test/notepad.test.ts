import { describe, it, expect, vi, afterEach } from 'vitest';
import type { NoteBlock } from '@/types/notes';
import { FILE_EMOJI, fileSettings, fileText, isNotepadFile, newFileParts, withFileChanges } from '@/lib/notepad';
import { NOTE_EMOJIS } from '@/types/notes';
import { downloadTextFile } from '@/lib/download';

afterEach(() => vi.restoreAllMocks());

describe('notepad files', () => {
  it('a file is told apart by an emoji marker that the emoji picker never offers', () => {
    expect(isNotepadFile({ emoji: FILE_EMOJI })).toBe(true);
    expect(isNotepadFile({ emoji: '📝' })).toBe(false);
    expect(isNotepadFile({})).toBe(false);
    expect(NOTE_EMOJIS).not.toContain(FILE_EMOJI);
  });

  it('a new file is one empty code block with the chosen language', () => {
    const f = newFileParts('python', 'script.py');
    expect(f.emoji).toBe(FILE_EMOJI);
    expect(f.title).toBe('script.py');
    expect(f.blocks).toHaveLength(1);
    expect(f.blocks[0]).toMatchObject({ type: 'code', content: '', language: 'python' });
    expect(fileSettings(f)).toEqual({ language: 'python', indent: '2', wrap: false });
  });

  it('reads settings with safe defaults for anything missing or unknown', () => {
    expect(fileSettings({ blocks: [] })).toEqual({ language: 'plaintext', indent: '2', wrap: false });
    const odd = [{ id: 'a', type: 'code', content: 'x', codeIndent: '8' as never, codeWrap: true }] as NoteBlock[];
    expect(fileSettings({ blocks: odd })).toEqual({ language: 'plaintext', indent: '2', wrap: true });
    expect(fileText({ blocks: odd })).toBe('x');
  });

  it('changes the text and settings in the code block only, and returns the same list when nothing differs', () => {
    const blocks = [{ id: 'p', type: 'paragraph', content: 'intro' }, { id: 'c', type: 'code', content: 'a', language: 'go' }] as NoteBlock[];
    const next = withFileChanges(blocks, { content: 'b', codeIndent: 'tab' });
    expect(next[0]).toBe(blocks[0]);
    expect(next[1]).toMatchObject({ id: 'c', content: 'b', language: 'go', codeIndent: 'tab' });
    expect(withFileChanges(blocks, { content: 'a', language: 'go' })).toBe(blocks);
    expect(withFileChanges([], { content: 'x' })).toEqual([]);
  });
});

describe('download', () => {
  it('saves the text under the given name', async () => {
    const urls: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => { urls.push(b as Blob); return 'blob:x'; });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    let clicked: { name: string; href: string } | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked = { name: this.download, href: this.href }; });
    vi.useFakeTimers();
    downloadTextFile('a.py', 'print(1)');
    expect(clicked).toEqual({ name: 'a.py', href: 'blob:x' });
    expect(await urls[0].text()).toBe('print(1)');
    vi.advanceTimersByTime(1500);
    expect(revoke).toHaveBeenCalledWith('blob:x');
    vi.useRealTimers();
  });
});
