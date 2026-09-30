/** Row selection for the task table (P6.3). Pure helpers over a set of task ids. */

export function toggleId(selection: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selection);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

/** What is selected and still on screen: a row that was filtered away or deleted drops out of the selection. */
export function visibleSelection(selection: ReadonlySet<string>, visibleIds: readonly string[]): string[] {
  return visibleIds.filter((id) => selection.has(id));
}

export type SelectAllState = 'none' | 'some' | 'all';

export function selectAllState(selectedCount: number, visibleCount: number): SelectAllState {
  if (selectedCount === 0 || visibleCount === 0) return 'none';
  return selectedCount >= visibleCount ? 'all' : 'some';
}

export function taskCountLabel(n: number): string {
  return `${n} ${n === 1 ? 'task' : 'tasks'}`;
}
