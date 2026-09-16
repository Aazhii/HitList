/**
 * Saved views, from the server — or from localStorage when it cannot be reached.
 *
 * A view saved while offline is kept on this device under a per-user key. It
 * is not uploaded later: saying so is better than a sync that silently drops
 * or duplicates views. Views are cheap to recreate once back online.
 */
import { useCallback, useEffect, useState } from 'react';
import { viewApi, type ApiSavedView, type SavedViewInput } from '@/lib/api';
import { getActiveUserId } from '@/lib/storage';
import { normaliseFilters } from '@/lib/taskFilters';

const BASE_KEY = 'hitlist-views-v1';

function storageKey(): string {
  const userId = getActiveUserId();
  return userId ? `${BASE_KEY}-${userId}` : BASE_KEY;
}

const clean = (v: ApiSavedView): ApiSavedView => ({
  ...v,
  filters: normaliseFilters(v.filters),
  // A view stored before column choices existed has none; the table reads this.
  display: v.display ?? { hidden: [], order: [], widths: {} },
});
const byOrder = (a: ApiSavedView, b: ApiSavedView) => a.viewOrder - b.viewOrder || a.createdAt - b.createdAt;

function loadLocal(): ApiSavedView[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey()) ?? '[]') as unknown;
    return Array.isArray(parsed) ? (parsed as ApiSavedView[]).map(clean).sort(byOrder) : [];
  } catch {
    return [];
  }
}

function saveLocal(views: ApiSavedView[]): void {
  try { localStorage.setItem(storageKey(), JSON.stringify(views)); } catch { /* quota — ignore */ }
}

function errorMessage(e: unknown, fallback: string): string {
  const o = e as { message?: unknown; fields?: Record<string, string> } | null;
  const field = o?.fields ? Object.values(o.fields)[0] : undefined;
  if (field) return field;
  return typeof o?.message === 'string' && o.message ? o.message : fallback;
}

export interface UseSavedViews {
  views: ApiSavedView[];
  /** False while working from localStorage. */
  online: boolean;
  loading: boolean;
  createView: (input: SavedViewInput) => Promise<ApiSavedView | null>;
  updateView: (id: string, input: SavedViewInput) => Promise<ApiSavedView | null>;
  deleteView: (id: string) => Promise<boolean>;
}

export function useSavedViews(onError: (message: string) => void): UseSavedViews {
  const [views, setViews] = useState<ApiSavedView[]>(() => loadLocal());
  const [online, setOnline] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    viewApi.list()
      .then((fetched) => {
        if (cancelled) return;
        setViews(fetched.map(clean).sort(byOrder));
        setOnline(true);
      })
      .catch(() => {
        if (cancelled) return;
        setOnline(false);
        setViews(loadLocal());
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const writeLocal = useCallback((next: ApiSavedView[]) => {
    const sorted = [...next].sort(byOrder);
    setViews(sorted);
    saveLocal(sorted);
  }, []);

  const createView = useCallback(async (input: SavedViewInput) => {
    if (!online) {
      const now = Date.now();
      const view: ApiSavedView = {
        ...input,
        id: `local-${crypto.randomUUID()}`,
        filters: normaliseFilters(input.filters),
        // A view kept on the device has no column choices until one is saved.
        display: input.display ?? { hidden: [], order: [], widths: {} },
        viewOrder: views.reduce((m, v) => Math.max(m, v.viewOrder), -1) + 1,
        createdAt: now,
        updatedAt: now,
      };
      writeLocal([...views, view]);
      return view;
    }
    try {
      const created = clean(await viewApi.create(input));
      setViews((prev) => [...prev, created].sort(byOrder));
      return created;
    } catch (e) {
      onError(errorMessage(e, "Couldn't save the view"));
      return null;
    }
  }, [online, views, writeLocal, onError]);

  const updateView = useCallback(async (id: string, input: SavedViewInput) => {
    const existing = views.find((v) => v.id === id);
    if (!existing) return null;
    if (!online) {
      const view: ApiSavedView = {
        ...existing, ...input,
        filters: normaliseFilters(input.filters),
        viewOrder: input.viewOrder ?? existing.viewOrder,
        updatedAt: Date.now(),
      };
      writeLocal(views.map((v) => (v.id === id ? view : v)));
      return view;
    }
    try {
      const saved = clean(await viewApi.update(id, input));
      setViews((prev) => prev.map((v) => (v.id === id ? saved : v)).sort(byOrder));
      return saved;
    } catch (e) {
      onError(errorMessage(e, "Couldn't update the view"));
      return null;
    }
  }, [online, views, writeLocal, onError]);

  const deleteView = useCallback(async (id: string) => {
    if (!online) {
      writeLocal(views.filter((v) => v.id !== id));
      return true;
    }
    try {
      await viewApi.delete(id);
      setViews((prev) => prev.filter((v) => v.id !== id));
      return true;
    } catch (e) {
      onError(errorMessage(e, "Couldn't delete the view"));
      return false;
    }
  }, [online, views, writeLocal, onError]);

  return { views, online, loading, createView, updateView, deleteView };
}
