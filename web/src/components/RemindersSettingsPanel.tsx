/**
 * RemindersSettingsPanel.tsx
 * Inline reminders control surface — permission status, enable button,
 * and global default reminder timing. Rendered as a collapsible section
 * inside the main workspace header area.
 */

import React from 'react';
import {
  Bell,
  BellOff,
  BellRing,
  ShieldAlert,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { REMINDER_OPTIONS, DEFAULT_REMINDER_MINUTES, isNotificationSupported } from '@/lib/notifications';
import type { ReminderMinutes } from '@/lib/notifications';

// ── Types ────────────────────────────────────────────────────────────────────

interface RemindersSettingsPanelProps {
  permission: NotificationPermission;
  defaultMinutes: ReminderMinutes;
  onRequestPermission: () => Promise<NotificationPermission>;
  onDefaultMinutesChange: (minutes: ReminderMinutes) => void;
  /** Count of tasks with reminders enabled */
  activeReminderCount: number;
  /** Count of tasks that are overdue */
  overdueCount: number;
  /** Count of tasks due within 15 min */
  dueSoonCount: number;
}

// ── Permission badge ─────────────────────────────────────────────────────────

function PermissionBadge({ permission }: { permission: NotificationPermission }) {
  const supported = isNotificationSupported();

  if (!supported) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        <AlertTriangle className="size-2.5" />
        Not supported
      </span>
    );
  }

  if (permission === 'granted') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
        <Check className="size-2.5" />
        Enabled
      </span>
    );
  }

  if (permission === 'denied') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-semibold text-destructive">
        <ShieldAlert className="size-2.5" />
        Blocked
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
      <BellOff className="size-2.5" />
      Not enabled
    </span>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function RemindersSettingsPanel({
  permission,
  defaultMinutes,
  onRequestPermission,
  onDefaultMinutesChange,
  activeReminderCount,
  overdueCount,
  dueSoonCount,
}: RemindersSettingsPanelProps) {
  const [expanded, setExpanded] = React.useState(false);
  const [requesting, setRequesting] = React.useState(false);
  const supported = isNotificationSupported();

  const handleRequestPermission = async () => {
    if (requesting) return;
    setRequesting(true);
    await onRequestPermission();
    setRequesting(false);
    if (permission === 'default') setExpanded(true);
  };

  const alertCount = overdueCount + dueSoonCount;

  return (
    <div
      className={cn(
        'rounded-xl border transition-all duration-200',
        alertCount > 0 && permission === 'granted'
          ? 'border-amber-500/30 bg-amber-500/[0.04]'
          : 'border-border bg-card'
      )}
    >
      {/* ── Collapsed header row ── */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        aria-expanded={expanded}
        aria-label="Toggle reminders settings"
      >
        {/* Icon */}
        <div
          className={cn(
            'flex size-7 flex-shrink-0 items-center justify-center rounded-lg transition-colors duration-150',
            permission === 'granted'
              ? alertCount > 0
                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
              : 'bg-muted text-muted-foreground'
          )}
        >
          {permission === 'granted' ? (
            alertCount > 0 ? (
              <BellRing className="size-3.5 animate-pulse" />
            ) : (
              <Bell className="size-3.5" />
            )
          ) : (
            <BellOff className="size-3.5" />
          )}
        </div>

        {/* Label + status */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-foreground">Reminders</span>
            <PermissionBadge permission={permission} />
            {permission === 'granted' && activeReminderCount > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {activeReminderCount} task{activeReminderCount !== 1 ? 's' : ''} scheduled
              </span>
            )}
          </div>
          {/* Alert summary */}
          {permission === 'granted' && (overdueCount > 0 || dueSoonCount > 0) && (
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {overdueCount > 0 && (
                <span className="text-[10px] font-medium text-destructive">
                  {overdueCount} overdue
                </span>
              )}
              {dueSoonCount > 0 && (
                <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                  {dueSoonCount} due soon
                </span>
              )}
            </div>
          )}
          {permission === 'denied' && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Enable in browser settings to receive task reminders
            </p>
          )}
          {!supported && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Your browser doesn't support notifications
            </p>
          )}
        </div>

        {/* Expand chevron */}
        <div className="flex-shrink-0 text-muted-foreground">
          {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </div>
      </button>

      {/* ── Expanded body ── */}
      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-4 animate-fade-in">

          {/* Permission section */}
          {supported && permission !== 'granted' && (
            <div
              className={cn(
                'rounded-xl p-3.5 space-y-2.5',
                permission === 'denied'
                  ? 'bg-destructive/8 border border-destructive/20'
                  : 'bg-primary/5 border border-primary/15'
              )}
            >
              <div className="flex items-start gap-2.5">
                {permission === 'denied' ? (
                  <ShieldAlert className="size-4 text-destructive flex-shrink-0 mt-0.5" />
                ) : (
                  <Bell className="size-4 text-primary flex-shrink-0 mt-0.5" />
                )}
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-foreground">
                    {permission === 'denied'
                      ? 'Notifications blocked'
                      : 'Enable browser notifications'}
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {permission === 'denied'
                      ? 'You\'ve blocked notifications for this site. To enable reminders, open your browser\'s site settings and allow notifications, then reload the page.'
                      : 'Get timely reminders for your urgent tasks. Notifications appear even when the tab is in the background.'}
                  </p>
                </div>
              </div>
              {permission !== 'denied' && (
                <Button
                  size="sm"
                  onClick={handleRequestPermission}
                  disabled={requesting}
                  className="h-8 px-4 text-xs rounded-lg w-full"
                >
                  <Bell className="size-3.5 mr-1.5" />
                  {requesting ? 'Requesting…' : 'Allow notifications'}
                </Button>
              )}
            </div>
          )}

          {/* Granted state — settings */}
          {permission === 'granted' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-foreground">Default reminder time</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Applied to new tasks with reminders enabled
                  </p>
                </div>
                <Select
                  value={String(defaultMinutes)}
                  onValueChange={(v) => onDefaultMinutesChange(Number(v) as ReminderMinutes)}
                >
                  <SelectTrigger className="h-8 w-36 text-xs rounded-lg flex-shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REMINDER_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={String(opt.value)} className="text-xs">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Status summary cards */}
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-muted/50 px-3 py-2 text-center">
                  <p className="text-base font-bold text-foreground">{activeReminderCount}</p>
                  <p className="text-[10px] text-muted-foreground">Scheduled</p>
                </div>
                <div
                  className={cn(
                    'rounded-lg px-3 py-2 text-center',
                    dueSoonCount > 0 ? 'bg-amber-500/10' : 'bg-muted/50'
                  )}
                >
                  <p
                    className={cn(
                      'text-base font-bold',
                      dueSoonCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'
                    )}
                  >
                    {dueSoonCount}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Due soon</p>
                </div>
                <div
                  className={cn(
                    'rounded-lg px-3 py-2 text-center',
                    overdueCount > 0 ? 'bg-destructive/10' : 'bg-muted/50'
                  )}
                >
                  <p
                    className={cn(
                      'text-base font-bold',
                      overdueCount > 0 ? 'text-destructive' : 'text-foreground'
                    )}
                  >
                    {overdueCount}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Overdue</p>
                </div>
              </div>

              <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                Reminders are scheduled per-task. Enable them on individual tasks via the task detail panel or the reminder toggle on each card.
              </p>
            </div>
          )}

          {/* Unsupported */}
          {!supported && (
            <div className="rounded-xl bg-muted/50 border border-border p-3.5 flex items-start gap-2.5">
              <AlertTriangle className="size-4 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-foreground">Browser not supported</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                  Your browser doesn't support the Web Notifications API. Try Chrome, Firefox, Edge, or Safari 16.4+.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
