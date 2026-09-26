import { describe, expect, it } from 'vitest';
import { setActiveUserId } from '@/lib/storage';
import { notificationStorageKey, loadNotifications, saveNotifications } from '@/lib/inAppNotifications';
import { automationStorageKey } from '@/hooks/useAutomations';
import { notificationPermissionStorageKey } from '@/hooks/useNotifications';
import type { NotificationRecord } from '@/types/todo';

const notification: NotificationRecord = {
  id: 'n1', taskId: 't1', taskText: 'Private', quadrant: 'do', type: 'upcoming',
  triggeredAt: 1, dismissed: false, seenInToast: false,
};

describe('scoped offline caches', () => {
  it('does not show one user’s offline notifications to another', () => {
    setActiveUserId('user-a');
    saveNotifications([notification]);
    setActiveUserId('user-b');

    expect(loadNotifications()).toEqual([]);
    expect(notificationStorageKey('user-a')).not.toBe(notificationStorageKey('user-b'));
  });

  it('scopes automation and permission caches while preserving local mode', () => {
    expect(automationStorageKey('user-a')).not.toBe(automationStorageKey('user-b'));
    expect(notificationPermissionStorageKey('user-a')).not.toBe(notificationPermissionStorageKey('user-b'));
    expect(automationStorageKey(null)).toBe('kaizen-automations-v1');
    expect(notificationPermissionStorageKey(null)).toBe('kaizen_notif_permission');
  });
});
