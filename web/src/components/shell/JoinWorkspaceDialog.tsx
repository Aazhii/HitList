/** Join a shared workspace: paste the invite link (or its code). The invite must have been sent to the email this account uses. */
import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { inviteTokenFrom, workspaceReason } from '@/lib/workspaceMessage';
import { openWorkspace, refreshWorkspaces, workspaceBridge } from '@/lib/workspaceStore';
import { cn } from '@/lib/utils';

const primary = 'h-[34px] rounded-[4px] bg-a-accent px-4 text-[13px] font-semibold text-white transition-colors duration-[120ms] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
const secondary = 'h-[34px] rounded-[4px] border border-a-line-strong bg-a-surface px-4 text-[13px] font-semibold text-a-ink transition-colors duration-[120ms] hover:bg-a-bg disabled:cursor-not-allowed disabled:opacity-50';

export function JoinWorkspaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const token = inviteTokenFrom(text);

  const join = async () => {
    const bridge = workspaceBridge();
    if (!token || !bridge?.accept) return;
    setBusy(true);
    setNote(null);
    try {
      const out = await bridge.accept({ token });
      if (out.ok === false) { setNote(workspaceReason(out.reason)); return; }
      await refreshWorkspaces();
      setText('');
      onOpenChange(false);
      await openWorkspace(out.workspace.workspaceId);
    } catch {
      setNote(workspaceReason('offline'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Join a shared workspace</DialogTitle>
          <DialogDescription>Paste the invite link you were sent. Use the same email address the invite went to.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="join-link" className="text-[13px] text-a-muted">Invite link</Label>
            <Input id="join-link" value={text} placeholder="https://…/invite.html?t=…" onChange={(e) => { setText(e.target.value); setNote(null); }} />
          </div>
          {note && <p role="status" className={cn('text-[13px] text-a-attention')}>{note}</p>}
          <div className="flex items-center gap-3">
            <button type="button" className={primary} disabled={!token || busy} onClick={() => { void join(); }}>Join workspace</button>
            <button type="button" className={secondary} onClick={() => onOpenChange(false)}>Cancel</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
