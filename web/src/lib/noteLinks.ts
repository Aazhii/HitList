/**
 * Links between notes. A link is an ordinary markdown link whose address is `hitlist://note/<id>` (or
 * `hitlist://file/<id>` for a Notepad file): `[Roadmap](hitlist://note/abc)`. It is stored in the block's text like any
 * other link, so there is nothing to migrate, and an older HitList shows it as readable markdown. The title is the
 * text at the time of linking; what is shown is looked up live by id, so a rename updates every link.
 *
 * "Linked from" is worked out from the notes themselves: it is every other note holding a link to this one.
 */
import { findInlineLinks } from '@/lib/inlineMarkdown';
import type { Note, NoteBlock } from '@/types/notes';

export type LinkKind = 'note' | 'file';
export interface NoteLink { kind: LinkKind; id: string }

/** The link address for a note or a file. */
export function noteLinkHref(kind: LinkKind, id: string): string {
  return `hitlist://${kind}/${id}`;
}

/** What a `hitlist://` address points at, or null when it is not one of ours. */
export function parseNoteLink(href: string): NoteLink | null {
  let url: URL;
  try { url = new URL(href); } catch { return null; }
  if (url.protocol !== 'hitlist:') return null;
  const kind = url.hostname.toLowerCase();
  const id = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if ((kind !== 'note' && kind !== 'file') || !id || id.includes('/')) return null;
  return { kind, id };
}

/** The markdown for a link: the title is made safe to sit inside the brackets. */
export function noteLinkMarkdown(kind: LinkKind, id: string, title: string): string {
  const text = title.replace(/[[\]\n\r]/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';
  return `[${text}](${noteLinkHref(kind, id)})`;
}

export interface LinkTrigger {
  /** Where the `[[` starts. */
  at: number;
  /** What was typed after it. */
  query: string;
}

/** Whether the caret is just after a `[[` (and what has been typed since), the way "@" opens its menu. */
export function detectLinkTrigger(value: string, caret: number): LinkTrigger | null {
  if (caret < 2 || caret > value.length) return null;
  const before = value.slice(0, caret);
  const at = before.lastIndexOf('[[');
  if (at === -1) return null;
  const query = before.slice(at + 2);
  if (/[\]\n]/.test(query) || query.length > 80) return null;
  return { at, query };
}

/** The text with `[[query` replaced by the finished link, and where the caret goes. */
export function insertNoteLink(value: string, caret: number, trigger: LinkTrigger, kind: LinkKind, id: string, title: string): { content: string; caret: number } {
  const markdown = noteLinkMarkdown(kind, id, title);
  return { content: value.slice(0, trigger.at) + markdown + value.slice(caret), caret: trigger.at + markdown.length };
}

/** Every link to a note or file held in the blocks (page blocks are the parent/child relation, not links). */
export function linksIn(blocks: readonly NoteBlock[]): NoteLink[] {
  const found: NoteLink[] = [];
  const add = (link: NoteLink | null) => { if (link && !found.some((l) => l.kind === link.kind && l.id === link.id)) found.push(link); };
  for (const block of blocks) {
    if (block.type === 'codefile' && block.fileId) add({ kind: 'file', id: block.fileId });
    if (block.type === 'code' || block.type === 'divider' || block.type === 'database' || block.type === 'page' || block.type === 'codefile') continue;
    for (const link of findInlineLinks(block.content)) add(parseNoteLink(link.href));
  }
  return found;
}

/** The notes (other than the target) that hold a link to `targetId`, in the order given. */
export function backlinks<T extends Pick<Note, 'id' | 'blocks'>>(notes: readonly T[], targetId: string, kind: LinkKind = 'note'): T[] {
  return notes.filter((n) => n.id !== targetId && linksIn(n.blocks).some((l) => l.kind === kind && l.id === targetId));
}
