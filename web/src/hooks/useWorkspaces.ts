import { useEffect, useSyncExternalStore } from 'react';
import { getWorkspaceSnapshot, startWorkspaceStore, subscribeWorkspaces, currentWorkspace, type WorkspaceSnapshot } from '@/lib/workspaceStore';

/** Shared workspaces on this computer, live. `current` is the open shared workspace, or null when the person's own is open. */
export function useWorkspaces(): WorkspaceSnapshot & { current: ReturnType<typeof currentWorkspace> } {
  const snapshot = useSyncExternalStore(subscribeWorkspaces, getWorkspaceSnapshot, getWorkspaceSnapshot);
  useEffect(() => { startWorkspaceStore(); }, []);
  return { ...snapshot, current: currentWorkspace(snapshot) };
}
