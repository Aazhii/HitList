/**
 * The "@" card (showcase 570–584): "Add this line to a quadrant" — the four quadrants as a 2×2
 * grid, a List select, Cancel and Add task. One panel, not a cascade: the quadrant defaults to
 * Schedule and the list to the one open in Tasks, so ↵ adds straight away.
 *
 * The editor keeps focus in its textarea throughout and forwards navigation keys here through
 * the imperative handle: arrows move the quadrant, ↵ / Tab adds, Esc closes.
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { QUADRANTS, type KaizenList, type Quadrant } from '@/types/todo';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface MentionMenuHandle {
  /** Handles a navigation key. Returns true when the key was used. */
  handleKey: (key: string) => boolean;
}

interface MentionMenuProps {
  position: { top: number; left: number };
  lists: KaizenList[];
  /** Selected first: usually the list open in Tasks. */
  preferredListId?: string;
  /** What was typed after the "@": a quadrant or list name it starts is picked for you. */
  query: string;
  /** A task is being created; the card is inert. */
  pending: boolean;
  /** Shown in place of the form, e.g. when the block is empty. */
  message?: string | null;
  /** What is being added to a quadrant (a note block, a column); kept for callers, the card's title is fixed. */
  contextLabel: string;
  onSelect: (listId: string, quadrant: Quadrant) => void;
  onClose: () => void;
}

const CARD_W = 340;
const DEFAULT_QUADRANT: Quadrant = 'schedule';

export const MentionMenu = forwardRef<MentionMenuHandle, MentionMenuProps>(function MentionMenu(
  { position, lists, preferredListId, query, pending, message, onSelect, onClose },
  ref,
) {
  const [quadrant, setQuadrant] = useState<Quadrant>(DEFAULT_QUADRANT);
  const [listId, setListId] = useState<string | undefined>(preferredListId ?? lists[0]?.id);

  const orderedLists = useMemo(() => {
    const pref = lists.find((l) => l.id === preferredListId);
    return pref ? [pref, ...lists.filter((l) => l.id !== pref.id)] : lists;
  }, [lists, preferredListId]);
  const activeListId = orderedLists.some((l) => l.id === listId) ? listId : orderedLists[0]?.id;

  // "@do", "@side": what is typed after the "@" picks the first quadrant or list it starts.
  const q = query.trim().toLowerCase();
  useEffect(() => {
    if (!q) return;
    const quad = QUADRANTS.find((x) => x.label.toLowerCase().startsWith(q) || x.id.startsWith(q));
    if (quad) { setQuadrant(quad.id); return; }
    const list = orderedLists.find((l) => l.name.toLowerCase().includes(q));
    if (list) setListId(list.id);
  }, [q, orderedLists]);

  const add = () => {
    if (pending || !activeListId) return;
    onSelect(activeListId, quadrant);
  };

  useImperativeHandle(ref, () => ({
    handleKey(key) {
      if (key === 'Escape') { onClose(); return true; }
      if (message) return false;
      if (pending) return ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab'].includes(key);
      // The grid reads left to right, then down: do, schedule / delegate, eliminate.
      const i = QUADRANTS.findIndex((x) => x.id === quadrant);
      const go = (n: number) => { setQuadrant(QUADRANTS[(n + QUADRANTS.length) % QUADRANTS.length].id); return true; };
      switch (key) {
        case 'ArrowRight': return go(i + 1);
        case 'ArrowLeft': return go(i - 1);
        case 'ArrowDown': return go(i + 2);
        case 'ArrowUp': return go(i - 2);
        case 'Enter':
        case 'Tab': add(); return true;
        default: return false;
      }
    },
  }), [quadrant, message, pending, activeListId, onClose]);

  const left = Math.max(8, Math.min(position.left, window.innerWidth - CARD_W - 8));
  const estHeight = message ? 96 : 272;
  const top = position.top + estHeight > window.innerHeight - 8 ? Math.max(8, position.top - estHeight - 30) : position.top;

  return (
    <div
      data-mention-menu
      role="dialog"
      aria-label="Add to quadrant"
      className="fixed z-50 flex flex-col gap-3 rounded-[8px] border border-a-line bg-a-surface p-3 text-[13px] text-a-ink shadow-[var(--a-shadow-lg)] animate-fade-in"
      style={{ top, left, width: CARD_W }}
      // Keep the caret in the block while the card is used.
      onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('[data-slot="select-trigger"]')) e.preventDefault(); }}
    >
      <p className="font-semibold">Add this line to a quadrant</p>

      {message ? (
        <p className="text-a-muted">{message}</p>
      ) : (
        <>
          <div role="radiogroup" aria-label="Quadrant" className="grid grid-cols-2 gap-2">
            {QUADRANTS.map((quad) => {
              const on = quad.id === quadrant;
              return (
                <button
                  key={quad.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={pending}
                  onClick={() => setQuadrant(quad.id)}
                  className={cn(
                    'rounded-[6px] px-2.5 py-2 text-left transition-shadow duration-[120ms]',
                    quad.tintClass, quad.inkClass,
                    on ? 'border-[1.5px] border-current' : 'border border-transparent',
                  )}
                >
                  <div className="text-[13px] font-semibold">{quad.label}</div>
                  <div className="text-[11px]">{quad.subtitle}</div>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-1">
            <span id="mention-list-label">List</span>
            <Select value={activeListId} onValueChange={setListId} disabled={pending || orderedLists.length === 0}>
              <SelectTrigger size="sm" aria-labelledby="mention-list-label" className="h-7 w-full text-[11px]">
                <SelectValue placeholder="No list" />
              </SelectTrigger>
              {/* Portalled outside the card: tagged so a click in it is not "outside" the menu. */}
              <SelectContent data-mention-menu>
                {orderedLists.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-7 rounded-[3px] px-3 text-[11px] font-semibold text-a-muted transition-colors duration-[120ms] hover:bg-a-line-soft"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={add}
              disabled={pending || !activeListId}
              className="flex h-7 items-center gap-1.5 rounded-[3px] bg-a-accent px-3 text-[11px] font-semibold text-white transition-colors duration-[120ms] hover:bg-a-accent-600 disabled:opacity-50"
            >
              {pending && <Loader2 className="size-3 animate-spin" aria-hidden />}
              Add task
            </button>
          </div>
        </>
      )}
    </div>
  );
});
