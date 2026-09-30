/**
 * Keyboard cursors for the task table and board (P5.4). Each holds a cursor, moves it with
 * j/k/h/l or the arrows, and acts on the task under it. They listen on the document, but only
 * while nothing is being typed into and no menu or dialog is open.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { actionFor, clampIndex, isTypingTarget, shiftQuadrant, toggledStatus, type KeyAction } from '@/lib/taskKeyboard';
import type { Quadrant, TodoStatus } from '@/types/todo';

export interface TaskKeyHandlers {
  /** Enter (or o, in the table): edit the cell under the cursor. */
  onEdit?: (taskId: string, col: number) => void;
  onOpen: (taskId: string) => void;
  onStatus: (taskId: string, status: TodoStatus) => void;
  onQuadrant?: (taskId: string, quadrant: Quadrant) => void;
}

interface Lookup { statusOf: (id: string) => TodoStatus | undefined; quadrantOf: (id: string) => Quadrant | undefined }

function dispatchTaskAction(
  action: KeyAction, id: string | undefined, col: number, handlers: TaskKeyHandlers, lookup: Lookup,
): boolean {
  if (!id) return false;
  switch (action) {
    case 'edit':
      if (handlers.onEdit) handlers.onEdit(id, col); else handlers.onOpen(id);
      return true;
    case 'open': handlers.onOpen(id); return true;
    case 'toggle': {
      const status = lookup.statusOf(id);
      if (status) handlers.onStatus(id, toggledStatus(status));
      return true;
    }
    case 'quadrant-prev':
    case 'quadrant-next': {
      const current = lookup.quadrantOf(id);
      const next = current && shiftQuadrant(current, action === 'quadrant-next' ? 1 : -1);
      if (next) handlers.onQuadrant?.(id, next);
      return true;
    }
    default: return false;
  }
}

function useDocumentKeys(enabled: boolean, onAction: (action: KeyAction) => boolean) {
  const ref = useRef(onAction);
  useEffect(() => { ref.current = onAction; });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(document.activeElement) || isTypingTarget(e.target as Element | null)) return;
      const action = actionFor(e);
      // Enter on a focused button or link is that control's own; it is not "edit the cell".
      if (action === 'edit' && document.activeElement?.closest('button,a,[role="checkbox"]')) return;
      if (action && ref.current(action)) e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/** Rows top to bottom, `colCount` cells across (0 is the title). */
export function useTableKeyboard(
  rowIds: readonly string[], colCount: number, lookup: Lookup, handlers: TaskKeyHandlers, enabled = true,
) {
  const [cursor, setCursor] = useState<{ row: number; col: number } | null>(null);
  const activeId = cursor ? rowIds[clampIndex(cursor.row, rowIds.length)] : undefined;
  const cursorCol = cursor ? clampIndex(cursor.col, colCount) : 0;

  const onAction = useCallback((action: KeyAction): boolean => {
    if (rowIds.length === 0) return false;
    const at = cursor ?? { row: -1, col: 0 };
    switch (action) {
      case 'down': setCursor({ row: clampIndex(at.row + 1, rowIds.length), col: at.col }); return true;
      case 'up': setCursor({ row: clampIndex(at.row - 1, rowIds.length), col: at.col }); return true;
      case 'right': if (!cursor) return false; setCursor({ row: at.row, col: clampIndex(at.col + 1, colCount) }); return true;
      case 'left': if (!cursor) return false; setCursor({ row: at.row, col: clampIndex(at.col - 1, colCount) }); return true;
      case 'escape': if (!cursor) return false; setCursor(null); return true;
      default: return dispatchTaskAction(action, activeId, cursorCol, handlers, lookup);
    }
  }, [cursor, rowIds, colCount, activeId, cursorCol, handlers, lookup]);

  useDocumentKeys(enabled, onAction);
  return { activeId, activeCol: cursorCol, setCursor };
}

/** Columns left to right, each a list of task ids top to bottom. */
export function useBoardKeyboard(
  columns: ReadonlyArray<readonly string[]>, lookup: Lookup, handlers: TaskKeyHandlers, enabled = true,
) {
  const [cursor, setCursor] = useState<{ col: number; row: number } | null>(null);
  const col = cursor ? clampIndex(cursor.col, columns.length) : 0;
  const activeId = cursor ? columns[col]?.[clampIndex(cursor.row, columns[col]?.length ?? 0)] : undefined;

  /** The nearest column in `dir` that has a card, keeping the row where it can. */
  const sideways = (dir: 1 | -1, from: { col: number; row: number }) => {
    for (let c = from.col + dir; c >= 0 && c < columns.length; c += dir) {
      if (columns[c].length > 0) return { col: c, row: clampIndex(from.row, columns[c].length) };
    }
    return from;
  };

  const onAction = useCallback((action: KeyAction): boolean => {
    if (columns.every((c) => c.length === 0)) return false;
    if (!cursor) {
      if (action === 'down' || action === 'up' || action === 'left' || action === 'right') {
        const first = columns.findIndex((c) => c.length > 0);
        setCursor({ col: first, row: 0 });
        return true;
      }
      return false;
    }
    const here = { col, row: clampIndex(cursor.row, columns[col]?.length ?? 0) };
    switch (action) {
      case 'down': setCursor({ col: here.col, row: clampIndex(here.row + 1, columns[here.col].length) }); return true;
      case 'up': setCursor({ col: here.col, row: clampIndex(here.row - 1, columns[here.col].length) }); return true;
      case 'right': setCursor(sideways(1, here)); return true;
      case 'left': setCursor(sideways(-1, here)); return true;
      case 'escape': setCursor(null); return true;
      default: return dispatchTaskAction(action, activeId, 0, handlers, lookup);
    }
  }, [cursor, columns, col, activeId, handlers, lookup]);

  useDocumentKeys(enabled, onAction);
  return { activeId };
}
