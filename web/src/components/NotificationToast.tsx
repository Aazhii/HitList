/**
 * NotificationToast.tsx
 * Fixed bottom-right stack of in-app notification toasts.
 * Auto-dismisses after 8s. Shows max 3 at a time.
 * Amber for upcoming, red/destructive for missed.
 */

import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Clock, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NotificationRecord } from '@/types/todo';

const AUTO_DISMISS_MS = 8000;
const MAX_VISIBLE = 3;

// ── Single toast item ────────────────────────────────────────────────────────

interface ToastItemProps {
  record: NotificationRecord;
  onDismiss: (id: string) => void;
  index: number; // 0 = newest (bottom), higher = older (stacked above)
}

function ToastItem({ record, onDismiss, index }: ToastItemProps) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isMissed = record.type === 'missed';

  // Entrance animation
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 20);
    return () => clearTimeout(t);
  }, []);

  // Auto-dismiss
  useEffect(() => {
    timerRef.current = setTimeout(() => {
      handleDismiss();
    }, AUTO_DISMISS_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function handleDismiss() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setExiting(true);
    setTimeout(() => onDismiss(record.id), 300);
  }

  // Stack offset: newer toasts are at the bottom, older ones stack up
  const stackOffset = index * 8;

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        transform: `translateY(${-stackOffset}px) scale(${1 - index * 0.02})`,
        zIndex: MAX_VISIBLE - index,
        opacity: index >= MAX_VISIBLE ? 0 : undefined,
      }}
      className={cn(
        'relative w-80 rounded-2xl border shadow-lg transition-all duration-300 ease-out',
        // Entry/exit animation
        visible && !exiting
          ? 'translate-y-0 opacity-100'
          : exiting
          ? 'translate-y-2 opacity-0'
          : 'translate-y-4 opacity-0',
        // Color scheme
        isMissed
          ? 'bg-card border-destructive/30 shadow-destructive/10'
          : 'bg-card border-amber-500/30 shadow-amber-500/10'
      )}
    >
      {/* Progress bar */}
      <div
        className={cn(
          'absolute top-0 left-0 h-0.5 rounded-t-2xl animate-shrink-width',
          isMissed ? 'bg-destructive/60' : 'bg-amber-500/60'
        )}
        style={{ animationDuration: `${AUTO_DISMISS_MS}ms` }}
      />

      <div className="flex items-start gap-3 p-4">
        {/* Icon */}
        <div
          className={cn(
            'mt-0.5 flex size-8 flex-shrink-0 items-center justify-center rounded-xl',
            isMissed ? 'bg-destructive/15' : 'bg-amber-500/15'
          )}
        >
          {isMissed ? (
            <AlertCircle className="size-4 text-destructive" />
          ) : (
            <Clock className="size-4 text-amber-600 dark:text-amber-400" />
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'text-[11px] font-bold uppercase tracking-wider mb-0.5',
              isMissed ? 'text-destructive' : 'text-amber-600 dark:text-amber-400'
            )}
          >
            {isMissed ? 'Missed task' : 'Due soon'}
          </p>
          <p className="text-xs font-medium text-foreground leading-snug line-clamp-2">
            {record.taskText}
          </p>
          {!isMissed && record.minutesBefore !== undefined && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Due in approximately {record.minutesBefore} min
            </p>
          )}
          {isMissed && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              This task is past its due time
            </p>
          )}
        </div>

        {/* Dismiss */}
        <button
          onClick={handleDismiss}
          className="flex size-6 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150"
          aria-label="Dismiss"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Stack container ──────────────────────────────────────────────────────────

interface NotificationToastProps {
  /** Fresh records not yet shown in toast (seenInToast=false, dismissed=false) */
  freshRecords: NotificationRecord[];
  onDismiss: (id: string) => void;
  onMarkSeen: (ids: string[]) => void;
}

export function NotificationToast({
  freshRecords,
  onDismiss,
  onMarkSeen,
}: NotificationToastProps) {
  // Local queue: records currently being displayed
  const [queue, setQueue] = useState<NotificationRecord[]>([]);
  const seenRef = useRef<Set<string>>(new Set());

  // When fresh records arrive, add unseen ones to the queue
  useEffect(() => {
    const newOnes = freshRecords.filter((r) => !seenRef.current.has(r.id));
    if (newOnes.length === 0) return;

    const ids = newOnes.map((r) => r.id);
    ids.forEach((id) => seenRef.current.add(id));
    onMarkSeen(ids);

    setQueue((prev) => {
      // Newest at front (index 0 = bottom of stack visually)
      const combined = [...newOnes, ...prev];
      return combined.slice(0, MAX_VISIBLE + 2); // keep a small buffer
    });
  }, [freshRecords, onMarkSeen]);

  function handleDismiss(id: string) {
    onDismiss(id);
    setQueue((prev) => prev.filter((r) => r.id !== id));
  }

  const visible = queue.slice(0, MAX_VISIBLE);

  if (visible.length === 0) return null;

  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex flex-col-reverse gap-2 pointer-events-none"
      aria-label="Notification toasts"
    >
      {visible.map((record, index) => (
        <div key={record.id} className="pointer-events-auto">
          <ToastItem
            record={record}
            onDismiss={handleDismiss}
            index={index}
          />
        </div>
      ))}
    </div>
  );
}
