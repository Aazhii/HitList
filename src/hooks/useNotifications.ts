/**
 * useNotifications.ts
 * React hook that manages browser notification permission state and
 * re-schedules all task reminders whenever the tasks array changes.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  isNotificationSupported,
  getPermission,
  requestNotificationPermission,
  scheduleAllReminders,
  cancelAllReminders,
} from '@/lib/notifications';
import type { Todo } from '@/types/todo';

const PERM_STORAGE_KEY = 'kaizen_notif_permission';

export interface UseNotificationsReturn {
  supported: boolean;
  permission: NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
  scheduleAll: (todos: Todo[]) => void;
  cancelAll: () => void;
}

export function useNotifications(todos: Todo[]): UseNotificationsReturn {
  const supported = isNotificationSupported();

  const [permission, setPermission] = useState<NotificationPermission>(() => {
    // Hydrate from live API first, fall back to cached value
    if (isNotificationSupported()) return Notification.permission;
    const cached = localStorage.getItem(PERM_STORAGE_KEY);
    return (cached as NotificationPermission | null) ?? 'default';
  });

  // Persist the current permission to localStorage on mount
  useEffect(() => {
    if (!supported) return;
    localStorage.setItem(PERM_STORAGE_KEY, Notification.permission);
  }, [supported]);

  // Reconcile timers whenever tasks or permission change. scheduleAllReminders
  // now leaves unchanged reminders alone, so this is cheap to run often.
  useEffect(() => {
    if (!supported) return;
    scheduleAllReminders(todos);
  }, [todos, permission, supported]);

  // Cancel everything on unmount ONLY.
  //
  // This cleanup used to live on the effect above, where it ran before every
  // re-run — so each change to the todos array tore down every timer and
  // rebuilt it, and a reminder falling due inside that window could be
  // cancelled moments before firing. An empty dependency list means it runs
  // when the component really goes away, and not otherwise.
  useEffect(() => cancelAllReminders, []);

  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    const result = await requestNotificationPermission();
    setPermission(result);
    localStorage.setItem(PERM_STORAGE_KEY, result);
    // Immediately schedule reminders if granted
    if (result === 'granted') {
      scheduleAllReminders(todos);
    }
    return result;
  }, [todos]);

  const scheduleAll = useCallback((taskList: Todo[]) => {
    scheduleAllReminders(taskList);
  }, []);

  const cancelAll = useCallback(() => {
    cancelAllReminders();
  }, []);

  return { supported, permission, requestPermission, scheduleAll, cancelAll };
}
