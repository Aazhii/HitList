/**
 * Update screen (desktop only): the newer version, a download with visible progress, the checks, and the restart.
 * Where HitList cannot replace itself, the last step opens the installer instead and says what to do with it.
 */
import { useEffect } from 'react';
import { Check, Circle, Loader2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { installHint, percentOf, progressLabel, sizeLabel, swapBlockMessage, updateHeadline, updateSteps } from '@/lib/updateMessage';
import type { StepState, UpdateStatus } from '@/lib/updateMessage';
import { useAppUpdate } from '@/hooks/useAppUpdate';
import { cn } from '@/lib/utils';

const primary = 'h-[34px] rounded-[4px] bg-a-accent px-4 text-[13px] font-semibold text-white transition-colors duration-[120ms] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
const secondary = 'h-[34px] rounded-[4px] border border-a-line-strong bg-a-surface px-4 text-[13px] font-semibold text-a-ink transition-colors duration-[120ms] hover:bg-a-bg disabled:cursor-not-allowed disabled:opacity-50';

function StepIcon({ state }: { state: StepState }) {
  const cls = 'size-[15px] flex-shrink-0';
  if (state === 'done') return <Check className={cn(cls, 'text-a-accent')} strokeWidth={1.75} aria-hidden />;
  if (state === 'active') return <Loader2 className={cn(cls, 'animate-spin text-a-accent')} strokeWidth={1.75} aria-hidden />;
  if (state === 'failed') return <X className={cn(cls, 'text-a-attention')} strokeWidth={1.75} aria-hidden />;
  return <Circle className={cn(cls, 'text-a-faint')} strokeWidth={1.75} aria-hidden />;
}

function Steps({ s }: { s: UpdateStatus }) {
  const steps = updateSteps(s);
  const rows: [string, StepState][] = [
    ['Download', steps.download],
    ['Check the download', steps.verify],
    [s.mode === 'swap' ? 'Install and restart' : 'Open the installer', steps.install],
  ];
  return (
    <ol className="flex flex-col gap-1.5" aria-label="Update steps">
      {rows.map(([label, state]) => (
        <li key={label} className={cn('flex items-center gap-2.5 text-[13px]', state === 'todo' ? 'text-a-faint' : state === 'failed' ? 'text-a-attention' : 'text-a-ink')}
          aria-current={state === 'active' ? 'step' : undefined}>
          <StepIcon state={state} />
          <span>{label}</span>
          <span className="sr-only">{state === 'done' ? 'done' : state === 'active' ? 'in progress' : state === 'failed' ? 'failed' : 'waiting'}</span>
        </li>
      ))}
    </ol>
  );
}

function Bar({ s }: { s: UpdateStatus }) {
  const pct = percentOf(s.progress);
  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="progressbar"
        aria-label="Download progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
        className="h-[6px] w-full overflow-hidden rounded-[3px] bg-a-line"
      >
        <div className="h-full rounded-[3px] bg-a-accent transition-[width] duration-[120ms]" style={{ width: `${pct ?? 100}%` }} />
      </div>
      <p className="text-[12px] text-a-faint">{progressLabel(s.progress)}</p>
    </div>
  );
}

export function UpdateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const update = useAppUpdate();
  const { check } = update;

  useEffect(() => { if (open && update.available) void check(); }, [open, update.available, check]);

  const s = update.status;
  const platform = typeof navigator === 'undefined' ? '' : navigator.platform;
  const working = s?.phase === 'checking' || s?.phase === 'downloading' || s?.phase === 'verifying' || s?.phase === 'installing';
  const showSteps = !!s && ['downloading', 'verifying', 'ready', 'installing'].includes(s.phase) || (s?.phase === 'error' && !!s.latest);
  // A download or install in progress keeps going if the window is closed, but closing mid-install would hide the restart.
  const guardedChange = (next: boolean) => { if (!next && s?.phase === 'installing') return; onOpenChange(next); };

  return (
    <Dialog open={open} onOpenChange={guardedChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Updates</DialogTitle>
          <DialogDescription>{s ? `You have version ${s.current}.` : 'Look for a newer HitList.'}</DialogDescription>
        </DialogHeader>

        {!update.visible ? (
          <p className="text-[13px] text-a-muted">Updates are part of the HitList desktop app.</p>
        ) : !update.available ? (
          <p className="text-[13px] text-a-muted">This desktop build does not include in-app updates yet. Install the latest Windows setup from GitHub Releases.</p>
        ) : !s ? (
          <p className="text-[13px] text-a-muted">Look for a newer HitList.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <p className={cn('text-[14px]', s.phase === 'error' || (s.phase === 'ready' && s.error) ? 'text-a-attention' : 'text-a-ink')} role="status">{updateHeadline(s)}</p>

            {s.latest && ['available', 'downloading', 'verifying', 'ready', 'error'].includes(s.phase) && (
              <div className="flex flex-col gap-2">
                <p className="text-[12px] text-a-faint">{s.latest.name} · {sizeLabel(s.latest.size)}</p>
                {s.phase === 'available' && s.latest.notes && (
                  <p className="max-h-[120px] overflow-auto whitespace-pre-wrap text-[13px] text-a-muted">{s.latest.notes}</p>
                )}
              </div>
            )}

            {showSteps && <Steps s={s} />}
            {(s.phase === 'downloading' || s.phase === 'verifying') && <Bar s={s} />}

            {s.phase === 'ready' && s.mode === 'open' && (
              <div className="flex flex-col gap-1.5">
                <p className="text-[13px] text-a-muted">{swapBlockMessage(s.swapBlock)}</p>
                <p className="text-[13px] text-a-muted">{installHint(platform)}</p>
              </div>
            )}
            {(s.phase === 'ready' || s.phase === 'installing') && s.mode === 'swap' && (
              <p className="text-[13px] text-a-muted">Your tasks are kept. HitList closes for a moment and opens again on the new version.</p>
            )}

            <div className="flex items-center gap-3">
              {s.phase === 'available' && <button type="button" className={primary} onClick={() => { void update.download(); }}>Download</button>}
              {s.phase === 'downloading' && <button type="button" className={secondary} onClick={() => { void update.cancel(); }}>Cancel</button>}
              {s.phase === 'ready' && (
                <>
                  <button type="button" className={primary} onClick={() => { void update.install(); }}>
                    {s.mode === 'swap' ? 'Restart and update' : 'Open installer'}
                  </button>
                  <button type="button" className={secondary} onClick={() => onOpenChange(false)}>Later</button>
                </>
              )}
              {s.phase === 'error' && s.latest && <button type="button" className={primary} onClick={() => { void update.download(); }}>Try again</button>}
              {!working && s.phase !== 'ready' && s.phase !== 'downloading' && (
                <button type="button" className={secondary} onClick={() => { void update.check(); }}>Check again</button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
