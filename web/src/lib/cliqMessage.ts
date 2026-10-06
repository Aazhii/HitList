/** What the Cliq alerts screen says to the person. The shell reports short codes; these are the words. */
export interface CliqStatus {
  enabled: boolean;
  email: string;
  lastResult: string | null;
  lastSentAt: number | null;
  accountId?: string | null;
  workspaceId?: string | null;
}

export const CLIQ_EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

export function testResultMessage(result: string): { text: string; ok: boolean } {
  switch (result) {
    case 'sent': return { ok: true, text: 'Sent. Look for a message from the HitList bot in Cliq.' };
    case 'bad-email': return { ok: false, text: 'Enter your Cliq email first.' };
    case 'bad-recipient': return { ok: false, text: 'That email is not allowed. Use your work email.' };
    case 'sign-in-needed': return { ok: false, text: 'Sign in to HitList first (Account menu, Sign in to back up).' };
    case 'signed-out': return { ok: false, text: 'Sign in to HitList first (Account menu, Sign in to back up).' };
    case 'not-configured': return { ok: false, text: 'The Cliq connection is not set up on the server yet.' };
    case 'offline': return { ok: false, text: 'Could not reach the server. Try again when you are online.' };
    default: return { ok: false, text: 'The message could not be sent. Try again later.' };
  }
}

/** One line under the switch about how alerts are going. */
export function alertStatusLine(s: CliqStatus): string {
  if (!s.enabled) return 'Alerts are off.';
  switch (s.lastResult) {
    case 'sent': return s.lastSentAt ? `Last alert sent ${new Date(s.lastSentAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.` : 'Alerts are on.';
    case 'sign-in-needed': return 'Your sign-in expired. Sign out and sign in again.';
    case 'bad-recipient': return 'The server did not accept that email. Use your work email.';
    case 'error':
    case 'offline': return 'The last alert could not be sent. It will try again.';
    case 'ack-error': return 'The alert was sent, but its local receipt could not be saved.';
    default: return 'Alerts are on.';
  }
}
