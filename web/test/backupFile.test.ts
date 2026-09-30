import { describe, expect, it } from 'vitest';
import { backupFileName, importSummary, parseBackupText } from '@/lib/backupFile';

describe('backupFile', () => {
  it('names the file by date', () => {
    expect(backupFileName(new Date('2026-10-01T09:00:00'))).toBe('hitlist-backup-2026-10-01.json');
  });

  it('says what an import added and left alone', () => {
    const r = (imported: Record<string, number>, skipped: Record<string, number>) => ({ ok: true, imported, skipped });
    expect(importSummary(r({ KaizenTasks: 3, KaizenNotes: 1, KaizenFavorites: 9 }, {}))).toBe('Added 3 tasks, 1 note.');
    expect(importSummary(r({ KaizenTasks: 0 }, { KaizenTasks: 2 }))).toBe('Nothing new to add. 2 already here, left as they are.');
  });

  it('refuses files that are not backups', () => {
    expect(() => parseBackupText('nope')).toThrow('not valid JSON');
    expect(() => parseBackupText('{"schema":"other"}')).toThrow('not a HitList backup');
    expect(parseBackupText('{"schema":"hitlist.backup.v1","tables":{}}')).toEqual({ schema: 'hitlist.backup.v1', tables: {} });
  });
});
