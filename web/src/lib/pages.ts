/**
 * "Pages": the three things you can open from the sidebar — a task list, a note, a database —
 * seen the same way, so favorites, recents and the library can list them together.
 */
import type { PageKind } from '@/lib/api';

export interface PageRef { kind: PageKind; id: string }

/** A page with what the sidebar and library need to draw it. */
export interface PageInfo extends PageRef {
  name: string;
  emoji?: string;
  /** A tailwind class for a list's colour dot. */
  dotClass?: string;
  /** ms epoch, when the source knows it. */
  editedAt?: number;
  /** ms epoch, from the recents list. */
  visitedAt?: number;
}

export const PAGE_KIND_LABEL: Record<PageKind, string> = { list: 'Tasks', note: 'Notes', database: 'Databases' };

export const pageKey = (p: PageRef) => `${p.kind}:${p.id}`;
export const samePage = (a: PageRef, b: PageRef) => a.kind === b.kind && a.id === b.id;

/** How many recents the sidebar lists before "View all". */
export const SIDEBAR_RECENTS = 5;

/** Marks that still point at a page, in the order given, with names attached. Gone pages are skipped. */
export function resolvePages(marks: Array<PageRef & { visitedAt?: number }>, directory: PageInfo[]): PageInfo[] {
  const byKey = new Map(directory.map((p) => [pageKey(p), p]));
  return marks.flatMap((m) => {
    const page = byKey.get(pageKey(m));
    return page ? [{ ...page, visitedAt: m.visitedAt ?? page.visitedAt }] : [];
  });
}

export type LibraryTab = 'recents' | 'favorites' | 'notes' | 'lists' | 'databases' | 'all';

/** The pages a library tab shows. Recents keep visit order; the rest go by name. */
export function libraryPages(
  tab: LibraryTab, directory: PageInfo[], favorites: PageRef[], recents: Array<PageRef & { visitedAt?: number }>,
): PageInfo[] {
  const byName = (a: PageInfo, b: PageInfo) => a.name.localeCompare(b.name);
  switch (tab) {
    case 'recents': return resolvePages(recents, directory);
    case 'favorites': return resolvePages(favorites, directory);
    case 'notes': return directory.filter((p) => p.kind === 'note').sort(byName);
    case 'lists': return directory.filter((p) => p.kind === 'list').sort(byName);
    case 'databases': return directory.filter((p) => p.kind === 'database').sort(byName);
    default: return [...directory].sort(byName);
  }
}

/** "Just now", "5m ago", "3h ago", "Yesterday", "4d ago", then a date; '' when unknown. */
export function agoLabel(ts: number | undefined, now = Date.now()): string {
  if (!ts) return '';
  const mins = Math.floor((now - ts) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
