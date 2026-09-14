/**
 * Delivering a queued notification.
 *
 * Three channels, behind one interface. The design point is that a channel
 * failing must not take the sweep down: email being misconfigured should not
 * stop the in-app bell from working, and one user's bad address should not
 * block everyone else's reminders. So `deliver()` reports per-channel outcomes
 * rather than throwing, and the caller decides what a partial success means.
 *
 * What each channel actually needs, established by probing the live project —
 * see docs/catalyst/12-scheduling-and-delivery.md:
 *
 *   email   a REGISTERED sender address. An unregistered one fails with
 *           404 INVALID_ID "No such from_email with the given id exists",
 *           which reads like a bad route rather than a config problem.
 *   webpush nothing. Recipients are Catalyst app users addressed by email, so
 *           there is no subscription table to keep. Note a 200 means Catalyst
 *           accepted the request, not that a notification rendered.
 *   inapp   a row in KaizenNotifications, which the bell reads.
 */
import type { CatalystApp } from './types.ts';
import { INBOX_TABLE } from '../catalyst/schema.ts';
import type { QueueRow } from './queue.ts';

export const CHANNELS = ['email', 'webpush', 'inapp'] as const;
export type Channel = typeof CHANNELS[number];

export function isChannel(value: string): value is Channel {
  return (CHANNELS as readonly string[]).includes(value);
}

/**
 * Channels switched off for this deployment.
 *
 * A kill switch matters here because two of the three depend on console
 * configuration we cannot make from code. If email has no registered sender,
 * every reminder would otherwise burn its retry budget on a failure that will
 * never resolve by itself.
 */
export function disabledChannels(): Set<Channel> {
  const raw = (process.env['NOTIFY_DISABLED_CHANNELS'] ?? '').trim();
  if (!raw) return new Set();
  return new Set(
    raw.split(',').map((c) => c.trim().toLowerCase()).filter(isChannel),
  );
}

/** The from address for reminder email. Must be registered in Catalyst. */
export function senderAddress(): string {
  return (process.env['NOTIFY_FROM_EMAIL'] ?? '').trim();
}

export interface DeliveryOutcome {
  channel: Channel;
  ok: boolean;
  skipped?: string;
  error?: string;
}

export interface DeliveryResult {
  outcomes: DeliveryOutcome[];
  /** True when at least one channel actually delivered. */
  anyDelivered: boolean;
  /** True when a channel failed in a way worth retrying. */
  anyRetryable: boolean;
}

// ── Channels ──────────────────────────────────────────────────────────────────

async function deliverEmail(app: CatalystApp, row: QueueRow): Promise<DeliveryOutcome> {
  const from = senderAddress();
  if (!from) {
    // Not an error worth retrying — it is missing configuration, and retrying
    // would spend the row's whole attempt budget on it.
    return { channel: 'email', ok: false, skipped: 'NOTIFY_FROM_EMAIL is not set' };
  }

  // The recipient is the Catalyst user id in OwnerId, which for app users is
  // not itself an address; the caller supplies the address in the payload.
  const to = String(row.payload?.['email'] ?? '').trim();
  if (!to) {
    return { channel: 'email', ok: false, skipped: 'no recipient address on the entry' };
  }

  await app.email().sendMail({
    from_email: from,
    to_email: to,
    subject: row.title,
    content: row.body,
    html_mode: false,
    display_name: 'Kaizen',
  });
  return { channel: 'email', ok: true };
}

async function deliverWebPush(app: CatalystApp, row: QueueRow): Promise<DeliveryOutcome> {
  // Catalyst routes web push to app users by email, so no token store is
  // needed — but it does mean we need the address rather than the user id.
  const recipient = String(row.payload?.['email'] ?? '').trim();
  if (!recipient) {
    return { channel: 'webpush', ok: false, skipped: 'no recipient address on the entry' };
  }

  await app.pushNotification().web().sendNotification(
    `${row.title} — ${row.body}`,
    [recipient],
  );
  return { channel: 'webpush', ok: true };
}

async function deliverInApp(app: CatalystApp, row: QueueRow): Promise<DeliveryOutcome> {
  await app.datastore().table(INBOX_TABLE).insertRow({
    NotificationId: crypto.randomUUID(),
    OwnerId: row.ownerId,
    Title: row.title.slice(0, 255),
    Body: row.body,
    Kind: row.kind,
    SourceType: row.sourceType,
    SourceId: row.sourceId,
    Payload: row.payload ? JSON.stringify(row.payload) : '',
    ReadAt: '0',
    CreatedAt: String(Date.now()),
  });
  return { channel: 'inapp', ok: true };
}

const DELIVERERS: Record<Channel, (app: CatalystApp, row: QueueRow) => Promise<DeliveryOutcome>> = {
  email: deliverEmail,
  webpush: deliverWebPush,
  inapp: deliverInApp,
};

// ── Dispatch ──────────────────────────────────────────────────────────────────

/**
 * Delivers one queue entry across the channels it asked for.
 *
 * Never throws. A channel that fails is recorded and the others still run —
 * one broken channel should degrade the notification, not lose it.
 */
export async function deliver(app: CatalystApp, row: QueueRow): Promise<DeliveryResult> {
  const disabled = disabledChannels();
  const outcomes: DeliveryOutcome[] = [];

  for (const name of row.channels) {
    if (!isChannel(name)) {
      outcomes.push({ channel: name as Channel, ok: false, skipped: 'unknown channel' });
      continue;
    }
    if (disabled.has(name)) {
      outcomes.push({ channel: name, ok: false, skipped: 'disabled for this deployment' });
      continue;
    }

    try {
      outcomes.push(await DELIVERERS[name](app, row));
    } catch (e) {
      outcomes.push({ channel: name, ok: false, error: describe(e) });
    }
  }

  return {
    outcomes,
    anyDelivered: outcomes.some((o) => o.ok),
    // A skip is configuration, not a transient fault: retrying will not fix it.
    anyRetryable: outcomes.some((o) => !o.ok && o.error !== undefined),
  };
}

/** Renders a thrown value usefully; the SDK throws plain objects. */
function describe(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    const parts = [o['name'], o['code'], o['statusCode'], o['message']]
      .filter((v) => v !== undefined && v !== null)
      .map(String);
    if (parts.length) return parts.join(' | ');
    try { return JSON.stringify(e); } catch { /* fall through */ }
  }
  return String(e);
}

/** One-line summary of a delivery, for logs and the run audit trail. */
export function summarise(result: DeliveryResult): string {
  return result.outcomes
    .map((o) => {
      if (o.ok) return `${o.channel}:ok`;
      if (o.skipped) return `${o.channel}:skipped(${o.skipped})`;
      return `${o.channel}:failed(${o.error})`;
    })
    .join(' ');
}
