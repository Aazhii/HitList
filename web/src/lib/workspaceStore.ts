/**
 * Shared workspaces as the app sees them (desktop only): which ones this computer holds, which one is open, and who is in
 * them. The desktop shell does the syncing; this only reads the local server and tells the shell what to open.
 *
 * Kept outside React so the sidebar switcher, the share dialog and the "@" menu all see the same answer, and so a change from
 * another member refreshes all of them at once.
 */
import { flushSourceSaves } from '@/lib/sourceSaves';
import { toast } from 'sonner';

export interface WorkspaceMember { userId: string; email: string; name: string; role: 'owner' | 'member' }
export interface SharedWorkspace {
  workspaceId: string;
  name: string;
  role: 'owner' | 'member';
  /** 'removed': this person left or was removed. The copy stays on this computer, read-only. */
  state: 'active' | 'removed';
  cursor: number;
  members: WorkspaceMember[];
}
export interface WorkspaceSnapshot {
  /** False in a browser, signed out, or in a build without shared workspaces. */
  available: boolean;
  me: { userId: string; email: string | null } | null;
  /** The open shared workspace, or null for the person's own. */
  active: string | null;
  workspaces: SharedWorkspace[];
  loaded: boolean;
}

export type BridgeResult<T = object> = ({ ok: true } & T) | { ok: false; reason: string };
export interface WorkspaceSyncStatus { running: boolean; pushOn: boolean; lastError: string | null }
export interface WorkspaceBridge {
  status?: () => Promise<WorkspaceSyncStatus>;
  onStatus?: (listener: (status: WorkspaceSyncStatus) => void) => () => void;
  active?: () => Promise<{ workspaceId: string | null }>;
  select?: (o: { workspaceId: string | null }) => Promise<{ ok: boolean; reason?: string }>;
  refresh?: () => Promise<{ ok: boolean; reason?: string }>;
  create?: (o: { name: string; listIds: string[] }) => Promise<BridgeResult<{ workspace: SharedWorkspace }>>;
  invite?: (o: { workspaceId: string; email: string }) => Promise<BridgeResult<{ link: string; token: string; emailed: boolean; email: string }>>;
  accept?: (o: { token: string }) => Promise<BridgeResult<{ workspace: SharedWorkspace }>>;
  removeMember?: (o: { workspaceId: string; userId: string }) => Promise<BridgeResult>;
  leave?: (o: { workspaceId: string }) => Promise<BridgeResult>;
  onChanged?: (listener: (info: { workspaceId: string }) => void) => () => void;
  onAssigned?: (listener: (info: { workspaceId: string; taskId: string; title: string; by: string }) => void) => () => void;
}
interface Desktop { getAccount?: () => Promise<{ email: string | null; userId?: string | null } | null>; workspaces?: WorkspaceBridge }

const EMPTY: WorkspaceSnapshot = { available: false, me: null, active: null, workspaces: [], loaded: false };
let snapshot: WorkspaceSnapshot = EMPTY;
const listeners = new Set<() => void>();
let started = false;

const desktop = (): Desktop | undefined => (typeof window === 'undefined' ? undefined : (window as unknown as { hitlistDesktop?: Desktop }).hitlistDesktop);
export const workspaceBridge = (): WorkspaceBridge | undefined => desktop()?.workspaces;

function publish(next: WorkspaceSnapshot) {
  snapshot = next;
  listeners.forEach((l) => l());
}

/** Reads what the local server and shell know right now. Failures leave the last answer in place. */
export async function refreshWorkspaces(): Promise<void> {
  const d = desktop();
  const bridge = d?.workspaces;
  if (!d || !bridge?.select || !bridge.active) { if (snapshot.loaded) publish(EMPTY); return; }
  try {
    const [account, active, res] = await Promise.all([d.getAccount?.() ?? null, bridge.active(), fetch('/api/sync/workspaces')]);
    if (!account?.userId || !res.ok) { publish({ ...EMPTY, loaded: true }); return; }
    const workspaces = (await res.json()) as SharedWorkspace[];
    // An open workspace that no longer exists here falls back to the person's own.
    const open = active.workspaceId && workspaces.some((w) => w.workspaceId === active.workspaceId) ? active.workspaceId : null;
    publish({ available: true, me: { userId: account.userId, email: account.email }, active: open, workspaces, loaded: true });
  } catch {
    if (!snapshot.loaded) publish({ ...EMPTY, loaded: true });
  }
}

/** Starts listening to the shell once: members' changes refresh the list and tell the open screens to reload their data. */
export function startWorkspaceStore(): void {
  if (started) return;
  started = true;
  void refreshWorkspaces();
  workspaceBridge()?.onChanged?.(() => {
    void refreshWorkspaces();
    window.dispatchEvent(new CustomEvent('hitlist:workspace-data-changed'));
  });
}

export const getWorkspaceSnapshot = (): WorkspaceSnapshot => snapshot;
export function subscribeWorkspaces(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Opens a shared workspace (or the person's own with null). The page reloads so everything shows the right data. */
export const pageControls = { reload: () => window.location.reload() };
let opening = false;

export async function openWorkspace(workspaceId: string | null, sourceHash?: string): Promise<boolean> {
  if (opening) return false;
  opening = true;
  const root = document.getElementById('root');
  const wasInert = root?.inert ?? false;
  if (root) root.inert = true;
  try {
    await flushSourceSaves();
    const out = await workspaceBridge()?.select?.({ workspaceId });
    if (!out?.ok) { toast.error('The workspace could not be opened'); return false; }
    if (sourceHash) window.history.replaceState(null, '', sourceHash);
    else if (new URLSearchParams(window.location.hash.slice(1)).has('source')) window.history.replaceState(null, '', window.location.pathname + window.location.search);
    pageControls.reload();
    return true;
  } catch (failure) {
    toast.error(failure instanceof Error ? failure.message : 'Save pending edits before switching workspace');
    return false;
  } finally { opening = false; if (root) root.inert = wasInert; }
}

export function currentWorkspace(s: WorkspaceSnapshot = snapshot): SharedWorkspace | null {
  return s.active ? s.workspaces.find((w) => w.workspaceId === s.active) ?? null : null;
}

/** For tests. */
export function resetWorkspaceStore(): void {
  started = false;
  snapshot = EMPTY;
  listeners.clear();
}
