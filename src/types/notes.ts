import { stripInline } from '@/lib/inlineMarkdown';

// ── Note Block Types ──────────────────────────────────────────────────────────

export type BlockType =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bullet'
  | 'numbered'
  | 'todo'
  | 'quote'
  | 'divider'
  | 'code'
  | 'table'
  | 'callout';

/** A callout's tint: terracotta, or sage. */
export type CalloutTone = 'accent' | 'sage';

// ── Table data ────────────────────────────────────────────────────────────────

export type ColumnAlign = 'left' | 'center' | 'right';

export interface TableData {
  rows: string[][];        // [rowIndex][colIndex] = cell content
  hasHeader: boolean;
  colWidths?: number[];    // per-column width in px (default 140)
  colAligns?: ColumnAlign[]; // per-column text alignment
}

export function createEmptyTable(rows = 3, cols = 3): TableData {
  return {
    rows: Array.from({ length: rows }, () => Array(cols).fill('')),
    hasHeader: true,
    colWidths: Array(cols).fill(140),
    colAligns: Array(cols).fill('left'),
  };
}

export interface NoteBlock {
  id: string;
  type: BlockType;
  content: string;
  checked?: boolean;    // for todo blocks
  tableData?: TableData; // for table blocks
  /**
   * Callout blocks only. Optional, like `checked` and `tableData`, so no
   * existing note needs migrating — and the server stores blocks as opaque
   * JSON, so it needs no change either.
   */
  emoji?: string;
  tone?: CalloutTone;
}

export interface Note {
  id: string;
  title: string;
  blocks: NoteBlock[];
  createdAt: number;
  updatedAt: number;
  emoji?: string;
  pinned?: boolean;
}

export const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  paragraph: 'Text',
  heading1: 'Heading 1',
  heading2: 'Heading 2',
  heading3: 'Heading 3',
  bullet: 'Bullet list',
  numbered: 'Numbered list',
  todo: 'To-do',
  quote: 'Quote',
  divider: 'Divider',
  code: 'Code',
  table: 'Table',
  callout: 'Callout',
};

export const NOTE_EMOJIS = ['📝', '💡', '🗒️', '🔖', '⭐', '🎯', '🧠', '🌱', '🔥', '📌', '💭', '🚀'];

export const NOTES_STORAGE_KEY = 'kaizen-notes-v1';

export function createEmptyBlock(type: BlockType = 'paragraph'): NoteBlock {
  return {
    id: crypto.randomUUID(),
    type,
    content: '',
    checked: type === 'todo' ? false : undefined,
    tableData: type === 'table' ? createEmptyTable() : undefined,
    ...(type === 'callout' ? { emoji: '💡', tone: 'accent' as const } : {}),
  };
}

export function createNewNote(title = ''): Note {
  return {
    id: crypto.randomUUID(),
    title,
    blocks: [createEmptyBlock('paragraph')],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    emoji: NOTE_EMOJIS[Math.floor(Math.random() * NOTE_EMOJIS.length)],
    pinned: false,
  };
}

export function formatNoteDate(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;

  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * The first line of readable text in a note, for the sidebar and for search.
 *
 * Inline formatting markers are stripped, so the preview reads "a bold idea"
 * rather than "a **bold** idea", and searching for "bold idea" finds it. Code
 * blocks are left alone: a `*` there is content, not a mark.
 */
export function getNotePreview(note: Note): string {
  for (const block of note.blocks) {
    if (block.type === 'divider' || block.type === 'table') continue;
    const plain = block.type === 'code' ? block.content : stripInline(block.content);
    const text = plain.trim();
    if (text) return text.slice(0, 120);
  }
  return '';
}
