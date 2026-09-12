/**
 * useSyncStatus — reactive hook that subscribes to NotesSyncService status.
 * Returns the current SyncStatus and re-renders whenever it changes.
 */
import { useState, useEffect } from 'react';
import { notesSyncService } from '@/services/notesSyncService';
import type { SyncStatus } from '@/services/notesSyncService';

export type { SyncStatus };

export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(() => notesSyncService.getStatus());

  useEffect(() => {
    // subscribe returns an unsubscribe fn; also fires immediately with current status
    const unsub = notesSyncService.subscribe(setStatus);
    return unsub;
  }, []);

  return status;
}
