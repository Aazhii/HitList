/**
 * Create a shared workspace (choosing which of your lists to copy in; the originals stay yours), or, for a shared workspace
 * that is open, see its members, invite someone by email, remove a member, or leave.
 */
import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { initialOf, memberLabel, workspaceReason } from '@/lib/workspaceMessage';
import { openWorkspace, refreshWorkspaces, workspaceBridge, type SharedWorkspace } from '@/lib/workspaceStore';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { cn } from '@/lib/utils';

const primary = 'h-[34px] rounded-[4px] bg-a-accent px-4 text-[13px] font-semibold text-white transition-colors duration-[120ms] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
const secondary = 'h-[34px] rounded-[4px] border border-a-line-strong bg-a-surface px-4 text-[13px] font-semibold text-a-ink transition-colors duration-[120ms] hover:bg-a-bg disabled:cursor-not-allowed disabled:opacity-50';

interface Props { open: boolean; onOpenChange: (open: boolean) => void; workspace: SharedWorkspace | null }
interface PersonalList { id: string; name: string }

export function ShareWorkspaceDialog({ open, onOpenChange, workspace }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        {workspace ? <Manage workspace={workspace} onClose={() => onOpenChange(false)} /> : <Create onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function Create({ onClose }: { onClose: () => void }) {
  const ws = useWorkspaces();
  const [name, setName] = useState('');
  const [lists, setLists] = useState<PersonalList[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const canCopyLists = !ws.current; // while a shared workspace is open, the lists on screen are its own

  useEffect(() => {
    if (!canCopyLists) return;
    let live = true;
    void fetch('/api/lists').then((r) => (r.ok ? r.json() : [])).then((rows: PersonalList[]) => { if (live) setLists(rows); }).catch(() => {});
    return () => { live = false; };
  }, [canCopyLists]);

  const create = async () => {
    const bridge = workspaceBridge();
    if (!bridge?.create || !name.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      const out = await bridge.create({ name: name.trim(), listIds: [...chosen] });
      if (out.ok === false) { setNote(workspaceReason(out.reason)); return; }
      await refreshWorkspaces();
      onClose();
      await openWorkspace(out.workspace.workspaceId);
    } catch {
      setNote(workspaceReason('offline'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>New shared workspace</DialogTitle>
        <DialogDescription>Invite people, work on the same lists and tasks, and give each other tasks. Your notes and databases stay yours.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ws-name" className="text-[13px] text-a-muted">Name</Label>
          <Input id="ws-name" value={name} placeholder="Team tasks" onChange={(e) => setName(e.target.value)} />
        </div>
        {canCopyLists && lists.length > 0 && (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-[13px] text-a-muted">Copy these lists in (the originals stay yours)</legend>
            {lists.map((l) => (
              <label key={l.id} className="flex items-center gap-2 text-[14px] text-a-ink">
                <input
                  type="checkbox"
                  checked={chosen.has(l.id)}
                  onChange={(e) => setChosen((cur) => { const next = new Set(cur); if (e.target.checked) next.add(l.id); else next.delete(l.id); return next; })}
                />
                {l.name}
              </label>
            ))}
          </fieldset>
        )}
        {note && <p role="status" className="text-[13px] text-a-attention">{note}</p>}
        <div className="flex items-center gap-3">
          <button type="button" className={primary} disabled={!name.trim() || busy} onClick={() => { void create(); }}>Create workspace</button>
          <button type="button" className={secondary} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </>
  );
}

function Manage({ workspace, onClose }: { workspace: SharedWorkspace; onClose: () => void }) {
  const ws = useWorkspaces();
  const mine = ws.me?.userId;
  const owner = workspace.role === 'owner';
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ link: string; emailed: boolean; email: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const send = async () => {
    const bridge = workspaceBridge();
    if (!bridge?.invite || !email.trim()) return;
    setBusy(true); setNote(null); setInvite(null); setCopied(false);
    try {
      const out = await bridge.invite({ workspaceId: workspace.workspaceId, email: email.trim() });
      if (out.ok === false) { setNote(workspaceReason(out.reason)); return; }
      setInvite({ link: out.link, emailed: out.emailed, email: out.email });
      setEmail('');
    } catch { setNote(workspaceReason('offline')); } finally { setBusy(false); }
  };

  const act = async (run: () => Promise<{ ok: boolean; reason?: string }> | undefined, then?: () => void) => {
    setBusy(true); setNote(null);
    try {
      const out = await run();
      if (!out?.ok) { setNote(workspaceReason(out?.reason)); return; }
      await refreshWorkspaces();
      then?.();
    } catch { setNote(workspaceReason('offline')); } finally { setBusy(false); }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{workspace.name}</DialogTitle>
        <DialogDescription>{owner ? 'You own this workspace.' : 'You are a member of this workspace.'}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col gap-1.5" aria-label="Members">
          {workspace.members.map((m) => (
            <li key={m.userId} className="flex items-center gap-2.5 text-[14px] text-a-ink">
              <span className="flex size-[22px] flex-shrink-0 items-center justify-center rounded-full bg-a-line text-[11px] font-semibold text-a-ink" aria-hidden>{initialOf(memberLabel(m))}</span>
              <span className="min-w-0 flex-1 truncate">
                {memberLabel(m)}{m.userId === mine ? ' (you)' : ''}
                <span className="ml-2 text-[12px] text-a-faint">{m.email}</span>
              </span>
              <span className="text-[12px] text-a-faint">{m.role === 'owner' ? 'Owner' : 'Member'}</span>
              {owner && m.userId !== mine && (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Remove ${memberLabel(m)}`}
                  className="text-[12px] font-semibold text-a-muted hover:text-a-ink disabled:opacity-50"
                  onClick={() => { void act(() => workspaceBridge()?.removeMember?.({ workspaceId: workspace.workspaceId, userId: m.userId })); }}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>

        {owner && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ws-invite" className="text-[13px] text-a-muted">Invite by email</Label>
            <div className="flex items-center gap-2">
              <Input id="ws-invite" type="email" value={email} placeholder="name@company.com" onChange={(e) => setEmail(e.target.value)} />
              <button type="button" className={primary} disabled={!email.trim() || busy} onClick={() => { void send(); }}>Send invite</button>
            </div>
            <p className="text-[12px] text-a-faint">They get an email with a link that works once, for 7 days, and only for that address.</p>
          </div>
        )}

        {invite && (
          <div className="flex flex-col gap-1.5 rounded-[4px] border border-a-line bg-a-bg p-3" role="status">
            <p className="text-[13px] text-a-ink">
              {invite.emailed ? `Invite emailed to ${invite.email}.` : `The email could not be sent to ${invite.email}. Send them this link yourself.`}
            </p>
            <div className="flex items-center gap-2">
              <input readOnly aria-label="Invite link" value={invite.link} className="h-[30px] min-w-0 flex-1 rounded-[3px] border border-a-line-strong bg-a-surface px-2 text-[12px] text-a-ink" onFocus={(e) => e.currentTarget.select()} />
              <button
                type="button"
                className={cn(secondary, 'flex h-[30px] items-center gap-1.5 px-3')}
                onClick={() => { void navigator.clipboard?.writeText(invite.link).then(() => setCopied(true)).catch(() => {}); }}
              >
                <Copy className="size-[13px]" strokeWidth={1.75} aria-hidden />
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </div>
        )}

        {note && <p role="status" className="text-[13px] text-a-attention">{note}</p>}
        <div className="flex items-center gap-3">
          <button type="button" className={secondary} onClick={onClose}>Close</button>
          {!owner && (
            <button
              type="button"
              className={secondary}
              disabled={busy}
              onClick={() => { void act(() => workspaceBridge()?.leave?.({ workspaceId: workspace.workspaceId }), () => { onClose(); void openWorkspace(null); }); }}
            >
              Leave workspace
            </button>
          )}
        </div>
      </div>
    </>
  );
}
