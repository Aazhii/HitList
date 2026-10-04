import { describe, expect, it } from 'vitest';
import { onPreLogout, prepareForSignOut, trackPendingSave } from '@/lib/preLogout';

describe('pre-logout saves', () => {
  it('waits for a pending task save before flushing notes', async () => {
    const events: string[] = [];
    let release!: () => void;
    const save = trackPendingSave(() => new Promise<void>(resolve => { release = () => { events.push('task-saved'); resolve(); }; }));
    const unsubscribe = onPreLogout(async () => { events.push('notes-flushed'); });
    try {
      const logout = prepareForSignOut().then(() => events.push('backup-can-start'));
      expect(events).toEqual([]);
      release();
      await save;
      await logout;
      expect(events).toEqual(['task-saved', 'notes-flushed', 'backup-can-start']);
    } finally { unsubscribe(); }
  });

  it('does not allow logout backup to start when a flush fails', async () => {
    const unsubscribe = onPreLogout(async () => { throw new Error('unsaved notes'); });
    try { await expect(prepareForSignOut()).rejects.toThrow('unsaved notes'); }
    finally { unsubscribe(); }
  });
});