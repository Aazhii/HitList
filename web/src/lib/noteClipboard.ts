/**
 * Copying, cutting and pasting blocks. A copy carries two things: the blocks themselves under our own type (so a
 * paste inside HitList keeps types, ticks and nesting exactly), and plain text with the nesting shown by
 * indentation (so a paste into any other app is readable).
 */
import type { BlockType, NoteBlock, TableData } from '@/types/notes';
import { createEmptyBlock } from '@/types/notes';
import { levelOf, MAX_INDENT, normalizeIndents, selectionRoots, subtreeEnd, subtreeIds } from '@/lib/noteBlocks';

export const BLOCKS_MIME = 'application/x-hitlist-blocks';

const TEXT_MARK: Partial<Record<BlockType, (b: NoteBlock) => string>> = {
  todo: (b) => (b.checked ? '[x] ' : '[ ] '),
  bullet: () => '- ',
  numbered: () => '1. ',
  toggle: () => '> ',
  quote: () => '| ',
  heading1: () => '# ',
  heading2: () => '## ',
  heading3: () => '### ',
};

function tableText(data: TableData | undefined): string {
  return (data?.rows ?? []).map((row) => row.join('\t')).join('\n');
}

/** The blocks a selection copies: each chosen block with its children, in note order. */
export function chosenBlocks(blocks: readonly NoteBlock[], chosen: ReadonlySet<string>): NoteBlock[] {
  const ids = new Set(selectionRoots(blocks, chosen).flatMap((root) => subtreeIds(blocks, root)));
  return blocks.filter((b) => ids.has(b.id));
}

export function blocksToText(blocks: readonly NoteBlock[]): string {
  const base = blocks.length ? Math.min(...blocks.map(levelOf)) : 0;
  return blocks.map((b) => {
    const pad = '  '.repeat(levelOf(b) - base);
    if (b.type === 'divider') return `${pad}---`;
    if (b.type === 'table') return tableText(b.tableData);
    if (b.type === 'database') return `${pad}[database]`;
    if (b.type === 'codefile') return `${pad}[notepad file]`;
    return `${pad}${TEXT_MARK[b.type]?.(b) ?? ''}${b.content}`;
  }).join('\n');
}

/** What goes on the clipboard for a selection. A task stays with its own line, so a copy carries no task link. */
export function toClipboard(blocks: readonly NoteBlock[], chosen: ReadonlySet<string>): { text: string; json: string } | null {
  const copied = chosenBlocks(blocks, chosen);
  if (copied.length === 0) return null;
  const clean = copied.map((b) => { const { taskId: _task, ...rest } = b; return rest as NoteBlock; });
  return { text: blocksToText(copied), json: JSON.stringify(clean) };
}

const TYPES: ReadonlySet<string> = new Set([
  'paragraph', 'heading1', 'heading2', 'heading3', 'bullet', 'numbered', 'todo', 'quote', 'divider',
  'code', 'table', 'callout', 'database', 'toggle', 'codefile',
]);

/**
 * Blocks from our clipboard format, with new ids, or null when it is not valid. Anything unexpected is dropped
 * rather than trusted: a paste can come from another computer's clipboard.
 */
export function fromClipboard(json: string, newId: () => string = () => crypto.randomUUID()): NoteBlock[] | null {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return null; }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 2000) return null;
  const out: NoteBlock[] = [];
  for (const item of parsed as unknown[]) {
    if (typeof item !== 'object' || item === null) return null;
    const raw = item as Record<string, unknown>;
    if (typeof raw.type !== 'string' || !TYPES.has(raw.type) || typeof raw.content !== 'string') return null;
    const block: NoteBlock = { ...createEmptyBlock(raw.type as BlockType), id: newId(), content: raw.content };
    if (raw.type === 'todo') block.checked = raw.checked === true;
    if (typeof raw.indent === 'number' && raw.indent > 0) block.indent = Math.min(MAX_INDENT, Math.floor(raw.indent));
    if (raw.collapsed === true && raw.type === 'toggle') block.collapsed = true;
    if (raw.type === 'table' && raw.tableData && typeof raw.tableData === 'object') block.tableData = raw.tableData as TableData;
    if (raw.type === 'callout') {
      if (typeof raw.emoji === 'string') block.emoji = raw.emoji;
      if (raw.tone === 'accent' || raw.tone === 'sage') block.tone = raw.tone;
    }
    if (raw.type === 'code') {
      if (typeof raw.language === 'string' && raw.language.length <= 40) block.language = raw.language;
      if (raw.codeIndent === '2' || raw.codeIndent === '4' || raw.codeIndent === 'tab') block.codeIndent = raw.codeIndent;
      if (raw.codeWrap === true) block.codeWrap = true;
    }
    if (raw.type === 'codefile' && typeof raw.fileId === 'string') block.fileId = raw.fileId;
    if (raw.type === 'database' && typeof raw.databaseId === 'string') {
      block.databaseId = raw.databaseId;
      if (raw.dbLayout === 'table' || raw.dbLayout === 'board') block.dbLayout = raw.dbLayout;
    }
    out.push(block);
  }
  // Level the pasted group so its shallowest line is at the top.
  const shallowest = Math.min(...out.map(levelOf));
  return out.map((b) => {
    const level = levelOf(b) - shallowest;
    if (level > 0) return { ...b, indent: level };
    const { indent: _drop, ...rest } = b;
    return rest as NoteBlock;
  });
}

/**
 * Puts pasted blocks after block `afterId` and everything under it, at that block's level. When that block is an
 * empty text line it is replaced instead, as pasting into an empty line does anywhere else.
 */
export function pasteBlocksAfter(blocks: NoteBlock[], afterId: string, pasted: NoteBlock[]): { blocks: NoteBlock[]; ids: string[] } {
  const i = blocks.findIndex((b) => b.id === afterId);
  if (i === -1 || pasted.length === 0) return { blocks, ids: [] };
  const here = blocks[i];
  const level = levelOf(here);
  const shifted = pasted.map((b) => (level > 0 ? { ...b, indent: Math.min(MAX_INDENT, levelOf(b) + level) } : b));
  const replace = here.content === '' && here.type === 'paragraph' && subtreeEnd(blocks, i) === i + 1;
  const at = replace ? i : subtreeEnd(blocks, i);
  const next = [...blocks.slice(0, at), ...shifted, ...blocks.slice(replace ? i + 1 : at)];
  return { blocks: normalizeIndents(next), ids: pasted.map((b) => b.id) };
}
