import { createContext, useContext } from 'react';
import type { NoteBlock } from '@/types/notes';

/** What a note's code blocks need from the editor around them (and, for embedded files, from the notes store). */
export interface CodeFilesApi {
  /** Every Notepad file, for the picker. */
  files: ReadonlyArray<{ id: string; title: string; language: string }>;
  /** A file's note, or undefined when it is not here (deleted, or not in this workspace). */
  get: (id: string) => { id: string; title: string; blocks: NoteBlock[] } | undefined;
  setBlocks: (id: string, blocks: NoteBlock[]) => void;
  /** Makes an empty file and returns its id. */
  create: () => string;
  /** Opens a file in Notepad. */
  open: (id: string) => void;
}

export interface NoteCodeContextValue {
  codeFiles?: CodeFilesApi;
  /** Esc inside a code block: leave the text and choose the block. */
  exitBlock: (blockId: string) => void;
  /** Arrow past the first or last line: move to the neighbouring block. */
  leaveBlock: (blockId: string, direction: 'up' | 'down') => void;
  /** True (once) when the block was just made or arrowed into and should take the keyboard. */
  consumeFocus: (blockId: string) => boolean;
  /** A mounted code editor offers its focus, so a later request can reach it. */
  registerFocus: (blockId: string, focus: (() => void) | null) => void;
}

const NOOP: NoteCodeContextValue = {
  exitBlock: () => {}, leaveBlock: () => {}, consumeFocus: () => false, registerFocus: () => {},
};

export const NoteCodeContext = createContext<NoteCodeContextValue>(NOOP);
export const useNoteCode = () => useContext(NoteCodeContext);
