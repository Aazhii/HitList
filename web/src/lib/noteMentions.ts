/**
 * The "@" menu in the notes editor: when it opens, and what task title a block
 * becomes.
 *
 * Kept pure and separate from the editor so the rules — which are easy to get
 * subtly wrong (an email address must not open a menu) — are tested directly.
 */
import type { BlockType } from '@/types/notes';
import { stripInline } from '@/lib/inlineMarkdown';

/** Block types where "@" can open the menu. Code keeps a literal "@"; tables and dividers have no caret. */
const MENTION_TYPES: ReadonlySet<BlockType> = new Set<BlockType>([
  'paragraph', 'heading1', 'heading2', 'heading3',
  'bullet', 'numbered', 'todo', 'quote', 'callout',
]);

export function canMention(type: BlockType): boolean {
  return MENTION_TYPES.has(type);
}

export interface MentionTrigger {
  /** Index of the "@" in the block's content. */
  at: number;
  /** What has been typed after it, up to the caret. */
  query: string;
}

/**
 * The active "@" trigger at the caret, or null.
 *
 * The "@" must start the block or follow whitespace — so "a@b.com" never
 * opens the menu — and nothing between it and the caret may be whitespace or
 * another "@".
 */
export function detectMentionTrigger(value: string, caret: number): MentionTrigger | null {
  if (caret < 1 || caret > value.length) return null;
  const before = value.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (/[\s@]/.test(query)) return null;
  return { at, query };
}

/** The content with the trigger "@query" removed, and where the caret goes. */
export function removeMentionTrigger(value: string, trigger: MentionTrigger): { content: string; caret: number } {
  const end = trigger.at + 1 + trigger.query.length;
  // Drop one space the trigger left behind, so "Buy milk @do" becomes "Buy milk".
  let start = trigger.at;
  if (start > 0 && value[start - 1] === ' ' && (end >= value.length || /\s/.test(value[end]))) start -= 1;
  return { content: value.slice(0, start) + value.slice(end), caret: start };
}

/** Longest title the tasks API accepts. */
export const MAX_TASK_TITLE = 255;

/**
 * The task title for a block's content: formatting delimiters removed,
 * whitespace collapsed, cut to what the API accepts. '' means there is
 * nothing to make a task from.
 */
export function taskTitleFromBlock(content: string): string {
  const plain = stripInline(content).replace(/\s+/g, ' ').trim();
  if (plain.length <= MAX_TASK_TITLE) return plain;
  return `${plain.slice(0, MAX_TASK_TITLE - 1).trimEnd()}…`;
}
