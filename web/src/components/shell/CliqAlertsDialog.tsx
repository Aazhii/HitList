/**
 * Desktop Cliq alerts and command linking settings.
 * HitList sends one Cliq message when tasks become overdue, and only while it is open.
 */
import { useEffect, useState } from 'react';
import { Copy, Download, Link2Off } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { alertStatusLine, CLIQ_EMAIL_PATTERN, testResultMessage } from '@/lib/cliqMessage';
import { useCliqAlerts } from '@/hooks/useCliqAlerts';
import { useCliqConnection } from '@/hooks/useCliqConnection';
import { cn } from '@/lib/utils';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import type { SharedWorkspace } from '@/lib/workspaceStore';

export function CliqAlertsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const workspaces = useWorkspaces();
  const [selected, setSelected] = useState<string | null | undefined>(undefined);
  const workspaceId = selected === undefined ? workspaces.active : selected;
  return <CliqAlertsContent key={`${workspaces.me?.userId}:${workspaceId}`} open={open} onOpenChange={onOpenChange}
    workspaceId={workspaceId} accountId={workspaces.me?.userId} workspaces={workspaces.workspaces}
    onWorkspaceChange={setSelected} />;
}

function CliqAlertsContent({ open, onOpenChange, workspaceId, accountId, workspaces, onWorkspaceChange }: {
  open: boolean; onOpenChange: (open: boolean) => void; workspaceId: string | null; accountId?: string;
  workspaces: SharedWorkspace[]; onWorkspaceChange: (id: string | null) => void;
}) {
  const cliq = useCliqAlerts(workspaceId, accountId);
  const connection = useCliqConnection(open);
  const [copyFailed, setCopyFailed] = useState(false);
  const [expired, setExpired] = useState(false);
  const expiresAt = connection.state?.expiresAt;

  useEffect(() => {
    if (!open || !expiresAt) return;
    const remaining = expiresAt - Date.now();
    setExpired(remaining <= 0);
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setExpired(true), remaining);
    return () => window.clearTimeout(timer);
  }, [open, expiresAt]);
  // The field shows what the person has typed; until they type, the saved email (which arrives a moment after opening).
  const [draft, setDraft] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { void cliq.refresh(); setNote(null); setDraft(null); } }, [open]);
  const email = draft ?? cliq.status?.email ?? '';

  const enabled = cliq.status?.enabled ?? false;
  const emailOk = CLIQ_EMAIL_PATTERN.test(email.trim());

  const saveEmail = async (nextEnabled: boolean) => {
    setBusy(true);
    const out = await cliq.save({ enabled: nextEnabled, email: email.trim() });
    setBusy(false);
    setNote(out.ok ? null : { ok: false, text: out.reason === 'bad-email' ? 'Enter a valid email address.' : 'Could not save that. Try again.' });
    return out.ok;
  };

  const sendTest = async () => {
    setBusy(true);
    // The test goes to the saved email, so save what is typed first.
    if (!(await saveEmail(enabled))) { setBusy(false); return; }
    setNote(testResultMessage(await cliq.test()));
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cliq alerts</DialogTitle>
          <DialogDescription>
            Get a message from the HitList bot in Zoho Cliq when tasks become overdue. HitList only checks while it is open.
          </DialogDescription>
        </DialogHeader>

        {!cliq.available ? (
          <p className="text-[13px] text-a-muted">Cliq alerts are part of the HitList desktop app.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cliq-workspace">Workspace</Label>
              <select id="cliq-workspace" value={workspaceId ?? ''} disabled={busy}
                onChange={(event) => onWorkspaceChange(event.target.value || null)}
                className="h-[34px] w-full rounded-[4px] border border-a-line-strong bg-a-surface px-2 text-[13px] text-a-ink">
                <option value="">Personal workspace</option>
                {workspaces.filter((workspace) => workspace.state === 'active').map((workspace) =>
                  <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.name}</option>)}
              </select>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="cliq-enabled" className="text-[14px] text-a-ink">Send me alerts in Cliq</Label>
              <Switch
                id="cliq-enabled"
                checked={enabled}
                disabled={busy || !cliq.status || (!enabled && !emailOk)}
                onCheckedChange={(on) => { void saveEmail(on); }}
                aria-label="Send me alerts in Cliq"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cliq-email" className="text-[13px] text-a-muted">Your Cliq email</Label>
              <Input
                id="cliq-email"
                type="email"
                value={email}
                placeholder="you@yourcompany.com"
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => { if (emailOk && cliq.status && email.trim() !== cliq.status.email) void saveEmail(enabled); }}
              />
              <p className="text-[12px] text-a-faint">The email you use in Cliq. Open Cliq once and say hi to the HitList bot, so its messages have a chat to arrive in.</p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => { void sendTest(); }}
                disabled={busy || !cliq.status || !emailOk}
                className="h-[34px] rounded-[4px] border border-a-line-strong bg-a-surface px-4 text-[13px] font-semibold text-a-ink transition-colors duration-[120ms] hover:bg-a-bg disabled:cursor-not-allowed disabled:opacity-50"
              >
                Send test message
              </button>
              {note && <span className={cn('text-[13px]', note.ok ? 'text-a-muted' : 'text-a-attention')} role="status">{note.text}</span>}
            </div>

            {cliq.status && <p className="text-[12px] text-a-faint">{alertStatusLine(cliq.status)}</p>}
            {cliq.failed && <p role="alert" className="text-[12px] text-a-attention">Could not load alert settings. Reopen settings to retry.</p>}
          </div>
        )}
        <section className="border-t border-a-line pt-4 space-y-3" aria-label="Cliq commands">
          <h3 className="text-[14px] font-semibold text-a-ink">Cliq commands</h3>
          {!connection.available ? (
            <p className="text-[13px] text-a-muted">Cliq commands are unavailable in this version of the desktop app.</p>
          ) : !connection.state ? (
            <p className="text-[13px] text-a-muted" role="status">{connection.failed ? 'Could not load Cliq commands. Reopen settings to retry.' : 'Loading Cliq commands...'}</p>
          ) : !connection.state.available ? (
            <p className="text-[13px] text-a-muted" role="status">{connection.state.error === 'workspace-unavailable' ? 'The local workspace is unavailable.' : 'Sign in to the desktop app to connect Cliq commands.'}</p>
          ) : (
            <div className="space-y-3">
              {connection.state.linked ? (
                <>
                  <p className="text-[13px] text-a-muted">Linked to {connection.state.email}</p>
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="cliq-intake" className="text-[14px] text-a-ink">Receive tasks from Cliq</Label>
                    <Switch id="cliq-intake" aria-label="Receive tasks from Cliq" checked={connection.state.enabled} disabled={connection.busy} onCheckedChange={(value) => { void connection.run('setCliqIntake', value); }} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" disabled={connection.busy} onClick={() => { void connection.run('fetchCliqCommands'); }} className="inline-flex h-[34px] items-center gap-2 rounded-[4px] border border-a-line-strong bg-a-surface px-3 text-[13px] font-semibold text-a-ink hover:bg-a-bg disabled:opacity-50"><Download size={15} aria-hidden="true" />Fetch now</button>
                    <button type="button" disabled={connection.busy} onClick={() => { void connection.run('unlinkCliq'); }} className="inline-flex h-[34px] items-center gap-2 rounded-[4px] border border-a-line-strong bg-a-surface px-3 text-[13px] font-semibold text-a-ink hover:bg-a-bg disabled:opacity-50"><Link2Off size={15} aria-hidden="true" />Unlink</button>
                  </div>
                  <p className="text-[12px] text-a-faint" role="status">{connection.state.connected ? 'Connected' : 'Not connected'} · {connection.state.lastResult}</p>
                </>
              ) : (
                <>
                  <button type="button" disabled={connection.busy} onClick={() => { void connection.run('startCliqLink'); }} className="h-[34px] rounded-[4px] border border-a-line-strong bg-a-surface px-3 text-[13px] font-semibold text-a-ink hover:bg-a-bg disabled:opacity-50">Create pairing link</button>
                  {connection.state.code && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <code className="min-w-0 select-all break-all text-[13px] text-a-ink">link {connection.state.code}</code>
                        <button type="button" title="Copy link command" aria-label="Copy link command" disabled={connection.busy} onClick={() => { if (!navigator.clipboard?.writeText) { setCopyFailed(true); return; } void navigator.clipboard.writeText(`link ${connection.state!.code}`).then(() => setCopyFailed(false), () => setCopyFailed(true)); }} className="shrink-0 rounded-[4px] border border-a-line-strong p-2 text-a-ink hover:bg-a-bg disabled:opacity-50"><Copy size={15} aria-hidden="true" /></button>
                      </div>
                      {connection.state.expiresAt && <p className="text-[12px] text-a-faint">{expired ? 'Pairing link expired.' : `Expires ${new Date(connection.state.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}</p>}
                      <button type="button" disabled={connection.busy || expired} onClick={() => { void connection.run('confirmCliqLink'); }} className="h-[34px] rounded-[4px] border border-a-line-strong bg-a-surface px-3 text-[13px] font-semibold text-a-ink hover:bg-a-bg disabled:opacity-50">Confirm link</button>
                      {copyFailed && <p className="text-[13px] text-a-attention" role="status">Could not copy. Select the command instead.</p>}
                    </div>
                  )}
                </>
              )}
              {connection.state.error && !connection.failed && <p className="text-[13px] text-a-attention" role="alert">{{ 'auth-required': 'Sign in again to use Cliq commands.', 'account-not-allowed': 'Your HitList sign-in email must be the same allowed work email you use in Cliq.', 'access-denied': 'Cliq command access was denied. Check the account link and server permissions.', 'link-conflict': 'This Cliq account is already linked elsewhere.', unavailable: 'Cliq commands are unavailable right now.', 'workspace-unavailable': 'The local workspace is unavailable.' }[connection.state.error]}</p>}
              {connection.failed && <p className="text-[13px] text-a-attention" role="alert">Could not update Cliq commands. Try again.</p>}
            </div>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
