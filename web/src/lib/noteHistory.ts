/**
 * Undo / redo for a note's blocks, on this device and for this run of the app only (like Notion, it starts empty
 * after a reload). A step is the whole block list before a change; applying one goes through the same save and
 * sync path as any edit, so it is just another edit as far as storage and other devices are concerned.
 */
import type { NoteBlock } from '@/types/notes';

export const HISTORY_LIMIT = 100;
/** Keystrokes in one block closer together than this are one undo step. */
export const TYPING_GAP_MS = 1000;

/** The id of the one block whose text changed, when that is the only change (typing); otherwise null. */
export function typedBlockId(before: readonly NoteBlock[], after: readonly NoteBlock[]): string | null {
  if (before.length !== after.length) return null;
  let changed: string | null = null;
  for (let i = 0; i < before.length; i += 1) {
    if (before[i] === after[i]) continue;
    if (before[i].id !== after[i].id || changed !== null) return null;
    const keys = new Set([...Object.keys(before[i]), ...Object.keys(after[i])]);
    for (const key of keys) {
      if (key === 'content') continue;
      if ((before[i] as unknown as Record<string, unknown>)[key] !== (after[i] as unknown as Record<string, unknown>)[key]) return null;
    }
    changed = before[i].id;
  }
  return changed;
}

export class NoteHistory {
  private past = new Map<string, NoteBlock[][]>();
  private future = new Map<string, NoteBlock[][]>();
  private typing = new Map<string, { blockId: string; at: number }>();

  /** A change from `before` to `after` was made by the person editing. */
  record(noteId: string, before: NoteBlock[], after: NoteBlock[], now = Date.now()): void {
    if (before === after) return;
    const typed = typedBlockId(before, after);
    const last = this.typing.get(noteId);
    // Still typing in the same block: the step already recorded covers it.
    if (typed && last && last.blockId === typed && now - last.at < TYPING_GAP_MS) {
      this.typing.set(noteId, { blockId: typed, at: now });
      this.future.delete(noteId);
      return;
    }
    const stack = this.past.get(noteId) ?? [];
    stack.push(before);
    if (stack.length > HISTORY_LIMIT) stack.shift();
    this.past.set(noteId, stack);
    this.future.delete(noteId);
    if (typed) this.typing.set(noteId, { blockId: typed, at: now });
    else this.typing.delete(noteId);
  }

  canUndo(noteId: string): boolean { return (this.past.get(noteId)?.length ?? 0) > 0; }
  canRedo(noteId: string): boolean { return (this.future.get(noteId)?.length ?? 0) > 0; }

  /** The blocks to go back to, given the current ones (kept for redo); null when there is nothing to undo. */
  undo(noteId: string, current: NoteBlock[]): NoteBlock[] | null {
    const stack = this.past.get(noteId);
    const previous = stack?.pop();
    if (!previous) return null;
    this.future.set(noteId, [...(this.future.get(noteId) ?? []), current]);
    this.typing.delete(noteId);
    return previous;
  }

  redo(noteId: string, current: NoteBlock[]): NoteBlock[] | null {
    const stack = this.future.get(noteId);
    const next = stack?.pop();
    if (!next) return null;
    this.past.set(noteId, [...(this.past.get(noteId) ?? []), current]);
    this.typing.delete(noteId);
    return next;
  }

  /** A note was replaced from outside (another device, a reload from the server) or deleted: its steps no longer apply. */
  forget(noteId: string): void {
    this.past.delete(noteId);
    this.future.delete(noteId);
    this.typing.delete(noteId);
  }

  forgetExcept(keep: ReadonlySet<string>): void {
    for (const id of [...this.past.keys(), ...this.future.keys()]) if (!keep.has(id)) this.forget(id);
  }

  clear(): void {
    this.past.clear();
    this.future.clear();
    this.typing.clear();
  }
}
