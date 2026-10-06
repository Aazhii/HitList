import { useState } from 'react';
import { Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { memberLabel } from '@/lib/workspaceMessage';
import { openWorkspace } from '@/lib/workspaceStore';
import { shareSource, sourceLocation, type SourceKind } from '@/lib/sharedSource';
import { flushSourceSaves } from '@/lib/sourceSaves';
import { topBarPill } from '@/components/shell/TopBar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function ShareSourceControl({ kind, id, title, flush }: { kind: SourceKind; id: string; title: string; flush?: () => Promise<void> }) {
  const ws = useWorkspaces();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const choices = ws.workspaces.filter((workspace) => workspace.state === 'active');
  const workspace = ws.current ?? choices.find((choice) => choice.workspaceId === selected);
  if (!ws.available || (!ws.current && choices.length === 0)) return null;

  const confirm = async () => {
    if (!workspace || busy) return;
    setBusy(true); setError('');
    try {
      await flush?.();
      await flushSourceSaves();
      const shared = await shareSource(workspace.workspaceId, kind, id);
      if (!await openWorkspace(workspace.workspaceId, sourceLocation(workspace.workspaceId, shared.kind, shared.id))) {
        throw new Error('Source shared, but the workspace could not be opened. Retry to open the same shared source.');
      }
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Source could not be shared';
      setError(message); toast.error(message);
    } finally { setBusy(false); }
  };

  return <>
    <button type="button" className={topBarPill} aria-label={ws.current ? 'Shared source members' : 'Share source'} title={ws.current ? 'Shared source members' : 'Share source'} onClick={() => { setSelected(choices[0]?.workspaceId ?? ''); setError(''); setOpen(true); }}>
      <Share2 className="size-4" strokeWidth={1.75} aria-hidden />
    </button>
    <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{ws.current ? 'Shared source' : `Share entire ${kind === 'note' ? 'page' : 'database'}?`}</DialogTitle>
          <DialogDescription>
            {ws.current ? `"${title}" is shared with all members of ${workspace?.name}.` : kind === 'note'
              ? `All content on "${title}" will be shared with every member of the selected workspace.`
              : `"${title}", all its records, columns and values will be shared with every member of the selected workspace.`}
            {!ws.current && ' The first share creates a snapshot. Your personal original stays separate and does not automatically sync. Repeat sharing opens the existing shared copy without replacing its edits. Make future shared edits in that copy.'}
          </DialogDescription>
        </DialogHeader>
        {!ws.current && <Select value={selected} onValueChange={setSelected} disabled={busy}>
          <SelectTrigger aria-label="Share in workspace"><SelectValue placeholder="Workspace" /></SelectTrigger>
          <SelectContent>{choices.map((choice) => <SelectItem key={choice.workspaceId} value={choice.workspaceId}>{choice.name}</SelectItem>)}</SelectContent>
        </Select>}
        <div className="text-[13px] text-a-muted">All members, not only the task recipient:</div>
        <ul aria-label="Source recipients" className="space-y-1 text-[14px] text-a-ink">
          {workspace?.members.map((member) => <li key={member.userId} className="[overflow-wrap:anywhere]">{memberLabel(member)} <span className="text-a-muted">{member.email}</span></li>)}
        </ul>
        {error && <p role="alert" className="text-[13px] text-a-red-ink">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>{ws.current ? 'Close' : 'Cancel'}</Button>
          {!ws.current && <Button disabled={!workspace || busy || !workspace.members.length} onClick={() => void confirm()}>{busy ? 'Sharing...' : 'Share and open'}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}