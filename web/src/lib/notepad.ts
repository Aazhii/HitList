/**
 * Notepad files. A file is an ordinary note — so it syncs, backs up, restores and is shared exactly like one — whose
 * emoji is a marker no emoji picker offers, and whose first code block holds the text, the language and the editor
 * settings. The title is the file name.
 *
 * The marker lives in the emoji (not in the blocks) so a list of notes, which carries the emoji but not the blocks,
 * can tell files apart without opening them.
 */
import type { Note, NoteBlock } from '@/types/notes';
import { createEmptyBlock } from '@/types/notes';
import { isIndentChoice, PLAIN_TEXT, type IndentChoice } from '@/lib/codeLanguages';

export const FILE_EMOJI = '</>';

export function isNotepadFile(note: { emoji?: string | null }): boolean {
  return note.emoji === FILE_EMOJI;
}

/** The block that holds a file's text: the first code block, or the first block if somehow there is none. */
export function fileBlock(note: Pick<Note, 'blocks'>): NoteBlock | undefined {
  return note.blocks.find((b) => b.type === 'code') ?? note.blocks[0];
}

export function fileText(note: Pick<Note, 'blocks'>): string {
  return fileBlock(note)?.content ?? '';
}

export interface FileSettings {
  language: string;
  indent: IndentChoice;
  wrap: boolean;
}

export function fileSettings(note: Pick<Note, 'blocks'>): FileSettings {
  const block = fileBlock(note);
  return {
    language: block?.language ?? PLAIN_TEXT,
    indent: isIndentChoice(block?.codeIndent) ? block.codeIndent : '2',
    wrap: block?.codeWrap === true,
  };
}

/** A new, empty file's title, emoji marker and blocks. */
export function newFileParts(language: string = PLAIN_TEXT, title = 'Untitled'): { title: string; emoji: string; blocks: NoteBlock[] } {
  const block: NoteBlock = { ...createEmptyBlock('code'), language };
  return { title, emoji: FILE_EMOJI, blocks: [block] };
}

/** The note's blocks with a file's text and/or settings changed; same array when nothing differs. */
export function withFileChanges(
  blocks: NoteBlock[],
  changes: Partial<Pick<NoteBlock, 'content' | 'language' | 'codeIndent' | 'codeWrap'>>,
): NoteBlock[] {
  const index = Math.max(0, blocks.findIndex((b) => b.type === 'code'));
  const current = blocks[index];
  if (!current) return blocks;
  const next = { ...current, ...changes };
  const same = (Object.keys(changes) as Array<keyof typeof changes>).every((k) => current[k] === next[k]);
  return same ? blocks : blocks.map((b, i) => (i === index ? next : b));
}
