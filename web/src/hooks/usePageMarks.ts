/**
 * Favorites and recents. The server is the record; the last answer is also kept in local storage,
 * so the sidebar still shows them offline and a failed write is not lost from view.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { pageMarksApi, type ApiPageMark, type PageKind } from '@/lib/api';
import { samePage, type PageRef } from '@/lib/pages';
import { getActiveUserId } from '@/lib/storage';

const CACHE_KEY = 'hitlist-page-marks-v1';
const MAX_RECENTS = 20;
const cacheKey = () => { const u = getActiveUserId(); return u ? `${CACHE_KEY}-${u}` : CACHE_KEY; };

/** A recent also knows when it was opened. */
export type Recent = PageRef & { visitedAt?: number };
interface Marks { favorites: PageRef[]; recents: Recent[] }

function readCache(): Marks {
  try {
    const raw = JSON.parse(localStorage.getItem(cacheKey()) ?? 'null');
    if (raw && Array.isArray(raw.favorites) && Array.isArray(raw.recents)) return raw as Marks;
  } catch { /* unreadable: start empty */ }
  return { favorites: [], recents: [] };
}

const ref = (m: ApiPageMark): PageRef => ({ kind: m.kind, id: m.id });
const recent = (m: ApiPageMark): Recent => ({ kind: m.kind, id: m.id, visitedAt: m.visitedAt });

export function usePageMarks(online: boolean) {
  const [marks, setMarks] = useState<Marks>(readCache);
  const marksRef = useRef(marks);
  marksRef.current = marks;

  const apply = useCallback((next: Marks) => {
    setMarks(next);
    try { localStorage.setItem(cacheKey(), JSON.stringify(next)); } catch { /* not cached */ }
  }, []);

  // What the server holds wins whenever it can be reached.
  useEffect(() => {
    if (!online) return;
    let live = true;
    Promise.all([pageMarksApi.favorites(), pageMarksApi.recents()])
      .then(([f, r]) => { if (live) apply({ favorites: f.map(ref), recents: r.map(recent) }); })
      .catch(() => { /* keep the cached copy */ });
    return () => { live = false; };
  }, [online, apply]);

  const isFavorite = useCallback((p: PageRef) => marks.favorites.some((f) => samePage(f, p)), [marks.favorites]);

  const toggleFavorite = useCallback((p: PageRef) => {
    const cur = marksRef.current;
    const was = cur.favorites.some((f) => samePage(f, p));
    apply({ ...cur, favorites: was ? cur.favorites.filter((f) => !samePage(f, p)) : [...cur.favorites, p] });
    void (was ? pageMarksApi.removeFavorite(p.kind, p.id) : pageMarksApi.addFavorite(p.kind, p.id)).catch(() => {});
  }, [apply]);

  /** Opening a page puts it first. Called for whatever page is on screen, so it is idempotent. */
  const visit = useCallback((p: PageRef) => {
    const cur = marksRef.current;
    if (cur.recents[0] && samePage(cur.recents[0], p)) return;
    apply({ ...cur, recents: [{ ...p, visitedAt: Date.now() }, ...cur.recents.filter((r) => !samePage(r, p))].slice(0, MAX_RECENTS) });
    void pageMarksApi.visit(p.kind as PageKind, p.id).catch(() => {});
  }, [apply]);

  const removeRecent = useCallback((p: PageRef) => {
    const cur = marksRef.current;
    apply({ ...cur, recents: cur.recents.filter((r) => !samePage(r, p)) });
    void pageMarksApi.removeRecent(p.kind, p.id).catch(() => {});
  }, [apply]);

  return { favorites: marks.favorites, recents: marks.recents, isFavorite, toggleFavorite, visit, removeRecent };
}
