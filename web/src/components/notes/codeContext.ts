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

/** What a note's sub-page blocks need from the notes around them. */
export interface PagesApi {
  /** A page (a note) by id, or undefined when it is not here (deleted, or not in this workspace). */
  get: (id: string) => { id: string; title: string; emoji?: string } | undefined;
  /** Opens a page. */
  open: (id: string) => void;
  /** Makes an empty note to be a sub-page of the open note, without opening it. The caller links it with a page block. */
  create: () => { id: string; title: string };
  /** A Notepad file by id (for a link to a file), or undefined when it is not here. */
  getFile: (id: string) => { id: string; title: string } | undefined;
  openFile: (id: string) => void;
  /** Everything a link can point at, for the `[[` menu. */
  linkables: () => ReadonlyArray<{ id: string; title: string; emoji?: string; kind: 'note' | 'file' }>;
  /** Makes a top-level note with this title (the menu's "Create page"), without opening it. */
  createNote: (title: string) => { id: string; title: string };
}

export const NotePagesContext = createContext<PagesApi | undefined>(undefined);
export const useNotePages = () => useContext(NotePagesContext);
