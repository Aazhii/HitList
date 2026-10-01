/** Update screen (desktop only): shows the newer version if there is one, downloads it, and says how to install it. */
import { useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { installHint, sizeLabel, updateHeadline } from '@/lib/updateMessage';
import { useAppUpdate } from '@/hooks/useAppUpdate';
import { cn } from '@/lib/utils';

const primary = 'h-[34px] rounded-[4px] bg-a-accent px-4 text-[13px] font-semibold text-white transition-colors duration-[120ms] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
const secondary = 'h-[34px] rounded-[4px] border border-a-line-strong bg-a-surface px-4 text-[13px] font-semibold text-a-ink transition-colors duration-[120ms] hover:bg-a-bg disabled:cursor-not-allowed disabled:opacity-50';

export function UpdateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const update = useAppUpdate();
  const { check } = update;

  useEffect(() => { if (open && update.available) void check(); }, [open, update.available, check]);

  const s = update.status;
  const busy = s?.phase === 'checking' || s?.phase === 'downloading';
  const platform = typeof navigator === 'undefined' ? '' : navigator.platform;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Updates</DialogTitle>
          <DialogDescription>{s ? `You have version ${s.current}.` : 'Look for a newer HitList.'}</DialogDescription>
        </DialogHeader>

        {!update.available || !s ? (
          <p className="text-[13px] text-a-muted">Updates are part of the HitList desktop app.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <p className={cn('text-[14px]', s.phase === 'error' ? 'text-a-attention' : 'text-a-ink')} role="status">{updateHeadline(s)}</p>

            {s.latest && (s.phase === 'available' || s.phase === 'downloading' || s.phase === 'downloaded') && (
              <div className="flex flex-col gap-2">
                <p className="text-[12px] text-a-faint">{s.latest.name} · {sizeLabel(s.latest.size)}</p>
                {s.latest.notes && <p className="max-h-[120px] overflow-auto whitespace-pre-wrap text-[13px] text-a-muted">{s.latest.notes}</p>}
              </div>
            )}
            {s.phase === 'downloaded' && <p className="text-[13px] text-a-muted">{installHint(platform)}</p>}

            <div className="flex items-center gap-3">
              {(s.phase === 'available' || s.phase === 'downloading' || s.phase === 'downloaded') && (
                <button type="button" className={primary} disabled={busy} onClick={() => { void update.download(); }}>
                  {s.phase === 'downloaded' ? 'Open again' : s.phase === 'downloading' ? 'Downloading…' : 'Download and open'}
                </button>
              )}
              <button type="button" className={secondary} disabled={busy} onClick={() => { void update.check(); }}>Check again</button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
