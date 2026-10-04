/**
 * The "@" card (showcase 570–584): "Add this line to a quadrant" — the four quadrants as a 2×2
 * grid, a List select, Cancel and Add task. One panel, not a cascade: the quadrant defaults to
 * Schedule and the list to the one open in Tasks, so ↵ adds straight away.
 *
 * The editor keeps focus in its textarea throughout and forwards navigation keys here through
 * the imperative handle: arrows move the quadrant, ↵ / Tab adds, Esc closes.
 *
 * In an open shared workspace the card also lists its members ("Assign to"): typing a name after the "@" picks that person,
 * and the task is created for them. Without members (a personal workspace) the card is unchanged.
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { QUADRANTS, type KaizenList, type Quadrant, type TaskAssignee } from '@/types/todo';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { listSourceLists } from '@/lib/sharedSource';
import { apiListToKaizenList } from '@/hooks/useAppSync';
import { initialOf, memberLabel } from '@/lib/workspaceMessage';
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
  onSelect: (listId: string, quadrant: Quadrant, assignee?: TaskAssignee) => void;
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
  const workspaces = useWorkspaces();
  const [workspaceId, setWorkspaceId] = useState('personal');
  const choices = workspaces.workspaces.filter((workspace) => workspace.state === 'active');
  const selectedWorkspace = workspaces.current ?? choices.find((workspace) => workspace.workspaceId === workspaceId);
  const targetId = !workspaces.current && selectedWorkspace ? selectedWorkspace.workspaceId : null;
  const [remote, setRemote] = useState<{ workspaceId: string; lists: KaizenList[]; error?: string } | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    if (!targetId) return;
    let live = true;
    void listSourceLists(targetId).then(
      (loaded) => { if (live) setRemote({ workspaceId: targetId, lists: loaded.map(apiListToKaizenList) }); },
      (failure) => { if (live) setRemote({ workspaceId: targetId, lists: [], error: failure instanceof Error ? failure.message : 'Workspace lists unavailable' }); },
    );
    return () => { live = false; };
  }, [targetId, loadAttempt]);
  const loadingLists = !!targetId && remote?.workspaceId !== targetId;
  const listError = targetId && remote?.workspaceId === targetId ? remote.error : undefined;
  const menuLists = targetId ? (remote?.workspaceId === targetId ? remote.lists : []) : lists;
  const people = useMemo(
    () => (selectedWorkspace?.state === 'active' ? selectedWorkspace.members : []),
    [selectedWorkspace],
  );
  const [personId, setPersonId] = useState<string | null>(null);
  const person = people.find((m) => m.userId === personId) ?? null;

  const orderedLists = useMemo(() => {
    const pref = menuLists.find((l) => l.id === preferredListId);
    return pref ? [pref, ...menuLists.filter((l) => l.id !== pref.id)] : menuLists;
  }, [menuLists, preferredListId]);
  const activeListId = orderedLists.some((l) => l.id === listId) ? listId : orderedLists[0]?.id;

  // "@do", "@side": what is typed after the "@" picks the first quadrant or list it starts.
  const q = query.trim().toLowerCase();
  useEffect(() => {
    if (!q) return;
    const quad = QUADRANTS.find((x) => x.label.toLowerCase().startsWith(q) || x.id.startsWith(q));
    if (quad) { setQuadrant(quad.id); return; }
    const who = people.find((m) => memberLabel(m).toLowerCase().startsWith(q) || m.email.toLowerCase().startsWith(q));
    if (who) { setPersonId(who.userId); return; }
    const list = orderedLists.find((l) => l.name.toLowerCase().includes(q));
    if (list) setListId(list.id);
  }, [q, orderedLists, people]);

  const add = () => {
    if (pending || loadingLists || listError || !activeListId || (targetId && !person)) return;
    if (person) onSelect(activeListId, quadrant, { userId: person.userId, name: memberLabel(person), ...(targetId ? { workspaceId: targetId } : {}) });
    else onSelect(activeListId, quadrant);
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
  }), [quadrant, message, pending, activeListId, onClose, person, loadingLists, listError, targetId, onSelect]);

  const left = Math.max(8, Math.min(position.left, window.innerWidth - CARD_W - 8));
  const estHeight = message ? 96 : 336 + (people.length > 0 ? 128 : 0);
  const top = position.top + estHeight > window.innerHeight - 8 ? Math.max(8, position.top - estHeight - 30) : position.top;

  return (
    <div
      data-mention-menu
      role="dialog"
      aria-label="Add to quadrant"
      className="fixed z-50 flex flex-col gap-3 rounded-[8px] border border-a-line bg-a-surface p-3 text-[13px] text-a-ink shadow-[var(--a-shadow-lg)] animate-fade-in"
      style={{ top, left, width: Math.min(CARD_W, window.innerWidth - 16), maxHeight: window.innerHeight - top - 8, overflowY: 'auto' }}
      // Keep the caret in the block while the card is used.
      onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('[data-slot="select-trigger"]')) e.preventDefault(); }}
    >
      <p className="font-semibold">Add this line to a quadrant</p>

      {message ? (
        <p className="text-a-muted">{message}</p>
      ) : (
        <>
          {!workspaces.current && workspaces.available && choices.length > 0 && <div className="flex flex-col gap-1">
            <span id="mention-workspace-label">Workspace</span>
            <Select value={workspaceId} disabled={pending} onValueChange={(next) => { setWorkspaceId(next); setPersonId(null); setListId(undefined); setRemote(null); }}>
              <SelectTrigger size="sm" aria-labelledby="mention-workspace-label" className="h-7 w-full text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent data-mention-menu>
                <SelectItem value="personal">Personal</SelectItem>
                {choices.map((workspace) => <SelectItem key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>}
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

          {people.length > 0 && (
            <div className="flex flex-col gap-1">
              {person && <p role="status" className="text-[12px] leading-relaxed text-a-muted [overflow-wrap:anywhere]">
                {targetId ? 'The entire source will be shared' : 'The source is already shared'} with all members of {selectedWorkspace?.name}: {people.map(memberLabel).join(', ')}. Assigning to {memberLabel(person)} does not make it private to them.
              </p>}
              <span id="mention-person-label">Assign to</span>
              <div role="radiogroup" aria-labelledby="mention-person-label" className="flex flex-wrap gap-1.5">
                {!targetId && <button
                  type="button"
                  role="radio"
                  aria-checked={!person}
                  disabled={pending}
                  onClick={() => setPersonId(null)}
                  className={cn('h-7 rounded-[4px] border px-2.5 text-[11px] font-semibold', !person ? 'border-a-accent text-a-accent-700' : 'border-a-line text-a-muted hover:text-a-ink')}
                >
                  No one
                </button>}
                {people.map((m) => {
                  const on = person?.userId === m.userId;
                  return (
                    <button
                      key={m.userId}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={pending}
                      onClick={() => setPersonId(m.userId)}
                      title={m.email}
                      className={cn('flex min-h-7 max-w-full items-center gap-1.5 rounded-[4px] border px-2 py-1 text-[11px] font-semibold', on ? 'border-a-accent text-a-accent-700' : 'border-a-line text-a-muted hover:text-a-ink')}
                    >
                      <span className="flex size-[16px] shrink-0 items-center justify-center rounded-full bg-a-line text-[11px] text-a-ink" aria-hidden>{initialOf(memberLabel(m))}</span>
                      <span className="min-w-0 text-left [overflow-wrap:anywhere]">{memberLabel(m)}{m.userId === workspaces.me?.userId ? ' (you)' : ''}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

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
            {loadingLists && <p role="status" className="text-[12px] text-a-muted">Loading workspace lists...</p>}
            {listError && <div role="alert" className="text-[12px] text-a-red-ink">{listError} <button type="button" onClick={() => { setRemote(null); setLoadAttempt((attempt) => attempt + 1); }}>Retry</button></div>}
            {!loadingLists && !listError && orderedLists.length === 0 && <p role="status" className="text-[12px] text-a-muted">No lists in this workspace. Create a list there first.</p>}
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
              disabled={pending || loadingLists || !!listError || !activeListId || (!!targetId && !person)}
              className="flex min-h-7 min-w-0 items-center gap-1.5 rounded-[3px] bg-a-accent px-3 py-1 text-[11px] font-semibold text-white transition-colors duration-[120ms] hover:bg-a-accent-600 disabled:opacity-50 [overflow-wrap:anywhere]"
            >
              {pending && <Loader2 className="size-3 animate-spin" aria-hidden />}
              {person ? `Add task for ${memberLabel(person)}` : 'Add task'}
            </button>
          </div>
        </>
      )}
    </div>
  );
});
