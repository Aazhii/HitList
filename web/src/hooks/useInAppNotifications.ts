/**
 * The bell's data.
 *
 * Reads notifications the server actually delivered, and falls back to local
 * detection when the server is unreachable.
 *
 * What this replaces, and why: the hook used to recompute "upcoming" and
 * "missed" from the task list on every poll and keep the result in
 * localStorage. That meant the bell showed notifications for deliveries that
 * had never happened — it was a second, independent guess at what the reminder
 * system would have done, running in a tab that had to be open anyway. With
 * reminders queued and delivered server-side, the bell can show what was
 * actually sent.
 *
 * The local path is kept rather than deleted, because the app works offline
 * throughout and a bell that empties itself when the network drops would read
 * as data loss. It is a fallback, not a parallel system: the moment the server
 * answers, its records win.
 */

import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import type { Todo, NotificationRecord } from '@/types/todo';
import { notificationApi, isNetworkError } from '@/lib/api';
import { toRecords } from '@/lib/notificationMapping';
import {
  loadNotifications,
  saveNotifications,
  detectAndUpdate,
  dismissRecord as libDismissRecord,
  dismissAll as libDismissAll,
  markSeenInToast,
} from '@/lib/inAppNotifications';

/**
 * How often the bell refreshes.
 *
 * The sweep runs every five minutes, so polling faster than that mostly asks a
 * question whose answer cannot have changed. 60s is kept because a delivery can
 * also land between sweeps (an automation fired from a task write), and the
 * request is one small indexed read.
 */
const POLL_INTERVAL_MS = 60_000;

export interface UseInAppNotificationsReturn {
  notifications: NotificationRecord[];
  /** Undismissed notifications */
  activeNotifications: NotificationRecord[];
  /** New records not yet shown in toast */
  freshToastRecords: NotificationRecord[];
  unreadCount: number;
  dismiss: (id: string) => void;
  dismissAll: () => void;
  markToastSeen: (ids: string[]) => void;
  /** False while the bell is showing locally-detected records instead. */
  online: boolean;
}

export function useInAppNotifications(
  todos: Todo[],
  userId: string | null = null,
): UseInAppNotificationsReturn {
  const [notifications, setNotifications] = useState<NotificationRecord[]>(() => loadNotifications(userId));
  const [notificationsUserId, setNotificationsUserId] = useState(userId);
  const [online, setOnline] = useState(false);

  // Refs rather than dependencies: the poll must see current values without
  // being torn down and rebuilt every time a task changes.
  const todosRef = useRef(todos);
  useEffect(() => { todosRef.current = todos; });
  const userRef = useRef(userId);
  // Keep asynchronous responses from the previous session from landing during
  // the commit-to-paint gap after an account changes.
  useLayoutEffect(() => {
    userRef.current = userId;
    setOnline(false);
    setNotifications(loadNotifications(userId));
    setNotificationsUserId(userId);
    toastedRef.current.clear();
  }, [userId]);

  /**
   * Ids already shown as a toast in this tab.
   *
   * Deliberately not persisted. A toast is a property of this session — after
   * a reload, a still-unread notification is worth surfacing again, and the
   * server has no business tracking whether a particular tab animated it.
   */
  const toastedRef = useRef<Set<string>>(new Set());

  /** Local detection, for when the server cannot be reached. */
  const runLocalDetection = useCallback(() => {
    const current = loadNotifications(userId);
    const { allRecords, newRecords } = detectAndUpdate(todosRef.current, current);
    if (newRecords.length > 0 || allRecords.length !== current.length) {
      saveNotifications(allRecords, userId);
      setNotifications(allRecords);
    } else {
      setNotifications(current);
    }
  }, [userId]);

  const refresh = useCallback(async () => {
    const requestUserId = userId;
    try {
      const entries = await notificationApi.list();
      if (requestUserId !== userRef.current) return;
      setNotifications(toRecords(entries, todosRef.current, toastedRef.current));
      setOnline(true);
    } catch (e) {
      if (requestUserId !== userRef.current) return;
      // A network failure means work offline. Anything else — a 401, a gateway
      // HTML page — means the same for the bell's purposes, but is worth a line
      // in the console rather than silence.
      if (!isNetworkError(e)) console.warn('[kaizen] notifications unavailable:', e);
      setOnline(false);
      runLocalDetection();
    }
  }, [runLocalDetection, userId]);

  // Refresh on mount and whenever the task list changes — a completed task can
  // withdraw a reminder, and the bell should reflect that without a poll's wait.
  useEffect(() => { void refresh(); }, [todos, refresh]);

  useEffect(() => {
    const id = setInterval(() => { void refresh(); }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  /**
   * Applies a change locally, then tells the server.
   *
   * Optimistic because dismissing a notification must feel instant, and the
   * cost of being wrong is one stale row that the next poll corrects.
   */
  const applyOptimistically = useCallback(
    (update: (prev: NotificationRecord[]) => NotificationRecord[], sync: () => Promise<unknown>) => {
      setNotifications((prev) => {
        const updated = update(prev);
        if (!online) saveNotifications(updated, userId);
        return updated;
      });
      if (online) {
        void sync().catch((e) => {
          console.warn('[kaizen] could not sync notification state:', e);
          void refresh();
        });
      }
    },
    [online, refresh, userId],
  );

  const dismiss = useCallback((id: string) => {
    applyOptimistically(
      (prev) => libDismissRecord(prev, id),
      () => notificationApi.markRead(id),
    );
  }, [applyOptimistically]);

  const dismissAll = useCallback(() => {
    applyOptimistically(libDismissAll, () => notificationApi.markAllRead());
  }, [applyOptimistically]);

  const markToastSeen = useCallback((ids: string[]) => {
    for (const id of ids) toastedRef.current.add(id);
    setNotifications((prev) => {
      const updated = markSeenInToast(prev, ids);
      // Seen-in-toast is local state in both modes; the server has no column
      // for it, and persisting it offline is what the local path expects.
      if (!online) saveNotifications(updated, userId);
      return updated;
    });
  }, [online, userId]);

  // Effects load the newly scoped cache after a user changes. Until then, do
  // not render the previous user's records for even one frame.
  const scopedNotifications = notificationsUserId === userId ? notifications : [];
  const activeNotifications = scopedNotifications.filter((r) => !r.dismissed);
  const freshToastRecords = scopedNotifications.filter((r) => !r.dismissed && !r.seenInToast);
  const unreadCount = activeNotifications.length;

  return {
    notifications,
    activeNotifications,
    freshToastRecords,
    unreadCount,
    dismiss,
    dismissAll,
    markToastSeen,
    online,
  };
}
