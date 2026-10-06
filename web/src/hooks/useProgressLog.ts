/**
 * The progress log: short lines about what moved, kept for the Monday update.
 * A line the person typed is never lost: it shows at once, and when the server cannot take it yet it
 * waits in local storage and is sent again on the next load or the next save.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { progressApi, type ApiProgressEntry, type ProgressEntryInput } from '@/lib/api';
import { getActiveUserId } from '@/lib/storage';

const PENDING_KEY = 'hitlist-progress-pending-v1';
const pendingKey = () => { const u = getActiveUserId(); return u ? `${PENDING_KEY}-${u}` : PENDING_KEY; };

export interface PendingEntry extends ProgressEntryInput { clientId: string; at: number }

function readPending(): PendingEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(pendingKey()) ?? '[]');
    return Array.isArray(raw) ? raw.filter((e) => e && typeof e.clientId === 'string' && typeof e.text === 'string') : [];
  } catch { return []; }
}
function writePending(list: PendingEntry[]) {
  try { localStorage.setItem(pendingKey(), JSON.stringify(list)); } catch { /* not stored */ }
}

const asEntry = (p: PendingEntry): ApiProgressEntry => ({
  id: p.clientId, text: p.text, state: p.state ?? 'moved', at: p.at, section: p.section ?? '',
  taskId: p.taskId ?? '', noteId: '', recordId: '', createdAt: p.at, updatedAt: p.at,
});

export function newEntryId(): string {
  return `log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface UseProgressLog {
  /** Saved lines plus the ones still waiting to be saved, oldest first. */
  entries: ApiProgressEntry[];
  /** How many lines are waiting for the server. */
  waiting: number;
  loading: boolean;
  addEntry: (input: Omit<ProgressEntryInput, 'clientId'>) => Promise<void>;
  updateEntry: (id: string, input: Partial<ProgressEntryInput>) => Promise<boolean>;
  deleteEntry: (id: string) => Promise<boolean>;
  reload: () => Promise<void>;
}

/** Entries from `from` to `to` (ms). Open ended when `to` is left out. */
export function useProgressLog(from: number, to?: number): UseProgressLog {
  const [saved, setSaved] = useState<ApiProgressEntry[]>([]);
  const [pending, setPending] = useState<PendingEntry[]>(readPending);
  const [loading, setLoading] = useState(true);
  const pendingRef = useRef(pending);
  /** Lines saved during this visit, so a slower earlier list answer cannot wipe them from view. */
  const justSaved = useRef(new Set<string>());
  useEffect(() => { pendingRef.current = pending; });

  const setPendingBoth = useCallback((next: PendingEntry[]) => {
    pendingRef.current = next;
    setPending(next);
    writePending(next);
  }, []);

  const flush = useCallback(async () => {
    for (const entry of [...pendingRef.current]) {
      try {
        const created = await progressApi.create(entry);
        setPendingBoth(pendingRef.current.filter((p) => p.clientId !== entry.clientId));
        justSaved.current.add(created.id);
        setSaved((cur) => (cur.some((e) => e.id === created.id) ? cur : [...cur, created]));
      } catch (e) {
        // Only a line the server calls invalid can never succeed. Anything else (offline, signed out) keeps it.
        const status = (e as { status?: number } | null)?.status;
        if (status === 400 || status === 413 || status === 422) setPendingBoth(pendingRef.current.filter((p) => p.clientId !== entry.clientId));
        else break;
      }
    }
  }, [setPendingBoth]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      await flush();
      const listed = await progressApi.list(from, to);
      setSaved((cur) => [...listed, ...cur.filter((e) => justSaved.current.has(e.id) && !listed.some((l) => l.id === e.id))]);
    } catch { /* offline: show what is held */ }
    setLoading(false);
  }, [flush, from, to]);

  // Loading on mount and when the range changes is the point of the effect.
  useEffect(() => { void reload(); }, [reload]);

  const addEntry = useCallback(async (input: Omit<ProgressEntryInput, 'clientId'>) => {
    const entry: PendingEntry = { ...input, clientId: newEntryId(), at: input.at ?? Date.now() };
    setPendingBoth([...pendingRef.current, entry]);
    await flush();
  }, [flush, setPendingBoth]);

  const updateEntry = useCallback(async (id: string, input: Partial<ProgressEntryInput>) => {
    // A line that has not been saved yet is edited where it waits.
    if (pendingRef.current.some((p) => p.clientId === id)) {
      setPendingBoth(pendingRef.current.map((p) => (p.clientId === id ? { ...p, ...input, clientId: id } as PendingEntry : p)));
      return true;
    }
    try {
      const updated = await progressApi.update(id, input);
      setSaved((cur) => cur.map((e) => (e.id === id ? updated : e)));
      return true;
    } catch { return false; }
  }, [setPendingBoth]);

  const deleteEntry = useCallback(async (id: string) => {
    if (pendingRef.current.some((p) => p.clientId === id)) {
      setPendingBoth(pendingRef.current.filter((p) => p.clientId !== id));
      return true;
    }
    try {
      await progressApi.remove(id);
      setSaved((cur) => cur.filter((e) => e.id !== id));
      return true;
    } catch { return false; }
  }, [setPendingBoth]);

  const inRange = (at: number) => at >= from && (to === undefined || at <= to);
  const waitingInRange = pending.filter((p) => inRange(p.at)).map(asEntry);
  const entries = [...saved, ...waitingInRange.filter((w) => !saved.some((s) => s.id === w.id))].sort((a, b) => a.at - b.at);
  return { entries, waiting: pending.length, loading, addEntry, updateEntry, deleteEntry, reload };
}
