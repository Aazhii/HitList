/**
 * The workspace row at the top of the sidebar: which workspace is open (the person's own, or a shared one), and a menu to
 * switch, share, or join. Without shared workspaces (a browser, signed out) it is just the app name.
 */
import { useEffect, useState } from 'react';
import { ChevronsUpDown, Check, Leaf, Plus, Users, UserPlus, RefreshCw } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { openWorkspace, refreshWorkspaces, workspaceBridge, type WorkspaceSyncStatus } from '@/lib/workspaceStore';
import { initialOf } from '@/lib/workspaceMessage';
import { ShareWorkspaceDialog } from '@/components/shell/ShareWorkspaceDialog';
import { JoinWorkspaceDialog } from '@/components/shell/JoinWorkspaceDialog';

export function WorkspaceSwitcher() {
  const ws = useWorkspaces();
  const [shareOpen, setShareOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<WorkspaceSyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    let disposed = false;
    let received = false;
    const bridge = workspaceBridge();
    const stop = bridge?.onStatus?.((status) => { received = true; if (!disposed) setSyncStatus(status); });
    void bridge?.status?.().then((status) => { if (!disposed && !received) setSyncStatus(status); }).catch(() => {});
    return () => { disposed = true; stop?.(); };
  }, []);

  const syncNow = async () => {
    setSyncing(true);
    try {
      const result = await workspaceBridge()?.refresh?.();
      if (result?.ok) {
        await refreshWorkspaces();
        window.dispatchEvent(new CustomEvent('hitlist:workspace-data-changed'));
      } else {
        setSyncStatus({ running: true, pushOn: false, lastError: 'offline' });
      }
    } catch {
      setSyncStatus({ running: true, pushOn: false, lastError: 'offline' });
    } finally { setSyncing(false); }
  };
  const syncLabel = syncStatus?.lastError === 'notification-delayed' ? 'Saved; delivery retrying'
    : syncStatus?.lastError === 'push-unavailable' ? 'Live sync reconnecting'
    : syncStatus?.lastError ? 'Sync needs attention'
    : syncStatus?.pushOn ? 'Live sync connected' : 'Live sync connecting';

  const label = ws.current ? ws.current.name : 'HitList';
  const mark = (
    <span className="flex size-[22px] flex-shrink-0 items-center justify-center rounded-[4px] bg-a-accent text-[11px] font-semibold text-white" aria-hidden>
      {ws.current ? initialOf(ws.current.name) : <Leaf className="size-[13px] text-white" strokeWidth={1.75} />}
    </span>
  );

  if (!ws.available) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        {mark}
        <span className="truncate text-[14px] font-semibold text-a-ink">HitList</span>
      </div>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Workspace: ${ws.current ? ws.current.name : 'Personal'}`}
            className="-ml-1 flex min-w-0 max-w-full items-center gap-2 rounded-[4px] px-1 py-0.5 text-left transition-colors duration-[120ms] hover:bg-a-row-hover"
          >
            {mark}
            <span className="truncate text-[14px] font-semibold text-a-ink">{label}</span>
            <ChevronsUpDown className="size-[13px] flex-shrink-0 text-a-faint" strokeWidth={1.75} aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[248px]">
          <DropdownMenuLabel className="text-[11px] font-medium text-a-faint">Workspaces</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => { void openWorkspace(null); }} className="gap-2.5 px-2.5 py-2 text-[14px]">
            <Leaf className="size-[15px] flex-shrink-0 text-a-muted" strokeWidth={1.75} aria-hidden />
            <span className="flex-1">Personal</span>
            {!ws.current && <Check className="size-[15px] text-a-accent" strokeWidth={1.75} aria-label="Open" />}
          </DropdownMenuItem>
          {ws.workspaces.map((w) => (
            <DropdownMenuItem key={w.workspaceId} onSelect={() => { void openWorkspace(w.workspaceId); }} className="gap-2.5 px-2.5 py-2 text-[14px]">
              <span className="flex size-[15px] flex-shrink-0 items-center justify-center rounded-[3px] bg-a-accent text-[11px] font-semibold text-white" aria-hidden>{initialOf(w.name)}</span>
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              {w.state === 'removed' && <span className="text-[11px] text-a-faint">read-only</span>}
              {ws.active === w.workspaceId && <Check className="size-[15px] text-a-accent" strokeWidth={1.75} aria-label="Open" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {ws.workspaces.length > 0 && (
            <>
              <DropdownMenuLabel className="text-[11px] font-medium text-a-faint"><span role="status">{syncLabel}</span></DropdownMenuLabel>
              <DropdownMenuItem disabled={syncing} onSelect={() => { void syncNow(); }} className="gap-2.5 px-2.5 py-2 text-[14px] text-a-muted">
                <RefreshCw className="size-[15px] flex-shrink-0" strokeWidth={1.75} aria-hidden />
                {syncing ? 'Syncing…' : 'Sync now'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {ws.current && ws.current.state === 'active' && (
            <DropdownMenuItem onSelect={() => { setCreating(false); setShareOpen(true); }} className="gap-2.5 px-2.5 py-2 text-[14px] text-a-muted">
              <Users className="size-[15px] flex-shrink-0" strokeWidth={1.75} aria-hidden />
              Members and invites
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => { setCreating(true); setShareOpen(true); }} className="gap-2.5 px-2.5 py-2 text-[14px] text-a-muted">
            <Plus className="size-[15px] flex-shrink-0" strokeWidth={1.75} aria-hidden />
            New shared workspace
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setJoinOpen(true)} className="gap-2.5 px-2.5 py-2 text-[14px] text-a-muted">
            <UserPlus className="size-[15px] flex-shrink-0" strokeWidth={1.75} aria-hidden />
            Join with an invite
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ShareWorkspaceDialog open={shareOpen} onOpenChange={setShareOpen} workspace={creating ? null : ws.current} />
      <JoinWorkspaceDialog open={joinOpen} onOpenChange={setJoinOpen} />
    </>
  );
}
