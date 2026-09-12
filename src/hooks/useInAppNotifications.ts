/**
 * useInAppNotifications.ts
 * Polls for upcoming/missed tasks every 60s and manages in-app notification records.
 * Seeds demo records on first load if localStorage is empty.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Todo, NotificationRecord } from '@/types/todo';
import {
  loadNotifications,
  saveNotifications,
  detectAndUpdate,
  dismissRecord as libDismissRecord,
  dismissAll as libDismissAll,
  markSeenInToast,
  createSeedNotifications,
} from '@/lib/inAppNotifications';

const POLL_INTERVAL_MS = 60_000; // 60 seconds
const SEED_KEY = 'kaizen_inapp_seeded';

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
}

export function useInAppNotifications(todos: Todo[]): UseInAppNotificationsReturn {
  const [notifications, setNotifications] = useState<NotificationRecord[]>(() => {
    return loadNotifications();
  });

  // Ref to avoid stale closure in interval — updated in effect, not during render
  const todosRef = useRef(todos);
  useEffect(() => {
    todosRef.current = todos;
  });

  // Seed demo records on first load
  useEffect(() => {
    const alreadySeeded = localStorage.getItem(SEED_KEY);
    if (alreadySeeded) return;

    const existing = loadNotifications();
    if (existing.length > 0) {
      localStorage.setItem(SEED_KEY, '1');
      return;
    }

    // Create seed records from seed tasks and schedule a microtask to avoid
    // calling setState synchronously inside the effect body
    const seedRecords = createSeedNotifications(todosRef.current);
    localStorage.setItem(SEED_KEY, '1');
    if (seedRecords.length > 0) {
      saveNotifications(seedRecords);
      // Use queueMicrotask to defer the setState call out of the effect body
      queueMicrotask(() => setNotifications(seedRecords));
    }
  }, []); // intentionally run once on mount

  // Detection function — runs on mount and every 60s
  const runDetection = useCallback(() => {
    const current = loadNotifications();
    const { allRecords, newRecords } = detectAndUpdate(todosRef.current, current);
    if (newRecords.length > 0 || allRecords.length !== current.length) {
      saveNotifications(allRecords);
      setNotifications(allRecords);
    }
  }, []);

  // Run detection on mount and whenever todos change
  useEffect(() => {
    runDetection();
  }, [todos, runDetection]);

  // Poll every 60s
  useEffect(() => {
    const id = setInterval(runDetection, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [runDetection]);

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => {
      const updated = libDismissRecord(prev, id);
      saveNotifications(updated);
      return updated;
    });
  }, []);

  const dismissAll = useCallback(() => {
    setNotifications((prev) => {
      const updated = libDismissAll(prev);
      saveNotifications(updated);
      return updated;
    });
  }, []);

  const markToastSeen = useCallback((ids: string[]) => {
    setNotifications((prev) => {
      const updated = markSeenInToast(prev, ids);
      saveNotifications(updated);
      return updated;
    });
  }, []);

  const activeNotifications = notifications.filter((r) => !r.dismissed);
  const freshToastRecords = notifications.filter((r) => !r.dismissed && !r.seenInToast);
  const unreadCount = activeNotifications.length;

  return {
    notifications,
    activeNotifications,
    freshToastRecords,
    unreadCount,
    dismiss,
    dismissAll,
    markToastSeen,
  };
}
