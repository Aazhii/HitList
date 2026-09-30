/** What the ⌘K palette can open. */
export type PaletteKind = 'task' | 'note' | 'database' | 'list';

export interface PaletteItem {
  kind: PaletteKind;
  id: string;
  title: string;
  /** Second, grey line: the list a task is in, and so on. */
  hint?: string;
  emoji?: string;
}

export const PALETTE_KIND_LABEL: Record<PaletteKind, string> = {
  task: 'Tasks', note: 'Notes', database: 'Databases', list: 'Lists',
};

const ORDER: PaletteKind[] = ['list', 'database', 'note', 'task'];
/** Per group, so one busy kind cannot push the others off the screen. */
export const PER_GROUP = 6;

/**
 * Items whose title contains every word typed, best first: a title that starts with the query,
 * then one with a word that does, then the rest. An empty query lists each group's first few.
 * Grouped in a fixed order (lists, databases, notes, tasks).
 */
export function searchPalette(items: PaletteItem[], query: string): Array<{ kind: PaletteKind; items: PaletteItem[] }> {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rank = (it: PaletteItem): number => {
    const t = it.title.toLowerCase();
    if (!words.every((w) => t.includes(w))) return -1;
    if (words.length && t.startsWith(words[0])) return 0;
    if (words.length && t.split(/\s+/).some((x) => x.startsWith(words[0]))) return 1;
    return 2;
  };
  return ORDER.map((kind) => ({
    kind,
    items: items
      .filter((i) => i.kind === kind)
      .map((i) => ({ i, r: rank(i) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r || a.i.title.localeCompare(b.i.title))
      .slice(0, PER_GROUP)
      .map((x) => x.i),
  })).filter((g) => g.items.length > 0);
}
