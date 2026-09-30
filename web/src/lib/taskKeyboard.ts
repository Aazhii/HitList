/**
 * The keyboard layer of the task table and board (P5.4): which key means what, and how a cursor moves.
 * Pure, so it can be tested without a DOM. Scoped to those two views — the notes editor has its own
 * key handling and is never touched.
 */
import type { Quadrant, TodoStatus } from '@/types/todo';

export type KeyAction =
  | 'down' | 'up' | 'left' | 'right'
  | 'edit' | 'open' | 'toggle' | 'select' | 'quadrant-prev' | 'quadrant-next' | 'escape';

/**
 * j/k and the arrows move, h/l and the arrows move sideways, Enter edits the cell (or opens the card),
 * o opens, x toggles done, Space selects the row (table), [ and ] move the task one quadrant. Anything with a modifier is left to the browser.
 */
export function actionFor(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): KeyAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  switch (e.key) {
    case 'j': case 'ArrowDown': return 'down';
    case 'k': case 'ArrowUp': return 'up';
    case 'h': case 'ArrowLeft': return 'left';
    case 'l': case 'ArrowRight': return 'right';
    case 'Enter': return 'edit';
    case 'o': return 'open';
    case 'x': return 'toggle';
    case ' ': return 'select';
    case '[': return 'quadrant-prev';
    case ']': return 'quadrant-next';
    case 'Escape': return 'escape';
    default: return null;
  }
}

/** Typing somewhere, or a menu or dialog is up: the keys belong to it. */
export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  // A checkbox takes no text, so keys still belong to the table after one is clicked.
  if (tag === 'INPUT') { const t = (el as HTMLInputElement).type; return t !== 'checkbox' && t !== 'radio'; }
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el instanceof HTMLElement && (el.isContentEditable || !!el.closest('[role="menu"],[role="listbox"],[role="dialog"]'));
}

/** A cursor that stays inside 0..length-1 (and is 0 for an empty list). */
export function clampIndex(index: number, length: number): number {
  return length <= 0 ? 0 : Math.max(0, Math.min(length - 1, index));
}

const QUADRANT_ORDER: Quadrant[] = ['do', 'schedule', 'delegate', 'eliminate'];

/** The next quadrant in Do first → Schedule → Delegate → Eliminate order, or null at either end. */
export function shiftQuadrant(q: Quadrant, delta: 1 | -1): Quadrant | null {
  const next = QUADRANT_ORDER.indexOf(q) + delta;
  return next < 0 || next >= QUADRANT_ORDER.length ? null : QUADRANT_ORDER[next];
}

export function toggledStatus(status: TodoStatus): TodoStatus {
  return status === 'done' ? 'todo' : 'done';
}
