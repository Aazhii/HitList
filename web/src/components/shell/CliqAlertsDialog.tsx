/**
 * Settings for Cliq alerts (desktop only): a switch, the person's Cliq email, a test message, and one line on how it is going.
 * HitList sends one Cliq message when tasks become overdue, and only while it is open.
 */
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { alertStatusLine, CLIQ_EMAIL_PATTERN, testResultMessage } from '@/lib/cliqMessage';
import { useCliqAlerts } from '@/hooks/useCliqAlerts';
import { cn } from '@/lib/utils';

export function CliqAlertsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const cliq = useCliqAlerts();
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
      <DialogContent className="sm:max-w-[440px]">
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
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="cliq-enabled" className="text-[14px] text-a-ink">Send me alerts in Cliq</Label>
              <Switch
                id="cliq-enabled"
                checked={enabled}
                disabled={busy || (!enabled && !emailOk)}
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
                disabled={busy || !emailOk}
                className="h-[34px] rounded-[4px] border border-a-line-strong bg-a-surface px-4 text-[13px] font-semibold text-a-ink transition-colors duration-[120ms] hover:bg-a-bg disabled:cursor-not-allowed disabled:opacity-50"
              >
                Send test message
              </button>
              {note && <span className={cn('text-[13px]', note.ok ? 'text-a-muted' : 'text-a-attention')} role="status">{note.text}</span>}
            </div>

            {cliq.status && <p className="text-[12px] text-a-faint">{alertStatusLine(cliq.status)} Switching alerts on does not announce tasks that are already overdue.</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
