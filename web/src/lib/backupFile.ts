/** Helpers for the workspace backup file (P6.4): its name, and what an import did, in words. */
import type { BackupImportResult } from '@/lib/api';

export function backupFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `hitlist-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/** The tables people recognise, for a sentence: tasks, lists, notes, databases. */
const NAMES: ReadonlyArray<[string, string, string]> = [
  ['KaizenTasks', 'task', 'tasks'],
  ['KaizenLists', 'list', 'lists'],
  ['KaizenNotes', 'note', 'notes'],
  ['KaizenDatabases', 'database', 'databases'],
];

export function importSummary(result: BackupImportResult): string {
  const parts = NAMES
    .map(([table, one, many]) => [result.imported[table] ?? 0, one, many] as const)
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  const skipped = NAMES.reduce((sum, [table]) => sum + (result.skipped[table] ?? 0), 0);
  const added = parts.length ? `Added ${parts.join(', ')}.` : 'Nothing new to add.';
  return skipped > 0 ? `${added} ${skipped} already here, left as they are.` : added;
}

export function parseBackupText(text: string): unknown {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || (parsed as { schema?: unknown }).schema !== 'hitlist.backup.v1') {
    throw new Error('That file is not a HitList backup.');
  }
  return parsed;
}
