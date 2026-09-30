/**
 * The browser channel of an automation. The server cannot show a browser notification, so it stores
 * the delivery with `webpush` among its channels, and whichever tab is open raises it — once per
 * notification (the ids already raised are remembered), and only when permission was granted.
 */
import type { ApiNotification } from '@/lib/api';

const KEY = 'hitlist-browser-notified-v1';
const KEEP = 200;

function raised(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

/** The unread entries that want the browser and have not been raised yet. */
export function pendingBrowserNotifications(entries: ApiNotification[], already: readonly string[]): ApiNotification[] {
  const done = new Set(already);
  return entries.filter((e) => {
    if (e.readAt > 0 || done.has(e.id)) return false;
    const channels = e.payload?.['channels'];
    return Array.isArray(channels) && channels.includes('webpush');
  });
}

export function raiseBrowserNotifications(entries: ApiNotification[]): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const already = raised();
  const due = pendingBrowserNotifications(entries, already);
  if (due.length === 0) return;
  for (const entry of due) {
    try { new Notification(entry.title, { body: entry.body, tag: entry.id }); } catch { /* not raised: try again next poll */ continue; }
    already.push(entry.id);
  }
  try { localStorage.setItem(KEY, JSON.stringify(already.slice(-KEEP))); } catch { /* raised again next time at worst */ }
}
