import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pendingBrowserNotifications, raiseBrowserNotifications } from '@/lib/browserNotify';
import type { ApiNotification } from '@/lib/api';

const note = (over: Partial<ApiNotification> = {}): ApiNotification => ({
  id: 'n1', title: 'Send the report', body: 'Due now · Nudge', kind: 'automation', sourceType: 'task', sourceId: 't1',
  readAt: 0, createdAt: 1, payload: { channels: ['inapp', 'webpush'] }, ...over,
});

describe('pendingBrowserNotifications', () => {
  it('wants unread ones that asked for the browser and were not raised yet', () => {
    const list = [
      note({ id: 'a' }),
      note({ id: 'b', payload: { channels: ['inapp'] } }),
      note({ id: 'c', readAt: 5 }),
      note({ id: 'd' }),
    ];
    expect(pendingBrowserNotifications(list, ['d']).map((n) => n.id)).toEqual(['a']);
  });
});

describe('raiseBrowserNotifications', () => {
  const raise = vi.fn();
  const win = window as unknown as { Notification?: unknown };
  const original = win.Notification;
  beforeEach(() => {
    localStorage.clear();
    raise.mockReset();
    class Fake { static permission = 'granted'; constructor(...args: unknown[]) { raise(...args); } }
    win.Notification = Fake;
  });
  afterEach(() => { win.Notification = original; });

  it('raises once per notification, however many polls see it', () => {
    raiseBrowserNotifications([note()]);
    raiseBrowserNotifications([note()]);
    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise).toHaveBeenCalledWith('Send the report', expect.objectContaining({ body: 'Due now · Nudge' }));
  });

  it('does nothing without permission', () => {
    (win.Notification as { permission: string }).permission = 'default';
    raiseBrowserNotifications([note()]);
    expect(raise).not.toHaveBeenCalled();
  });
});
