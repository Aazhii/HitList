import { describe, expect, it } from 'vitest';
import { alertStatusLine, CLIQ_EMAIL_PATTERN, testResultMessage, type CliqStatus } from '@/lib/cliqMessage';

const status = (over: Partial<CliqStatus> = {}): CliqStatus => ({ enabled: true, email: 'me@zohocorp.com', lastResult: null, lastSentAt: null, ...over });

describe('cliqMessage', () => {
  it('accepts one plain email and nothing else', () => {
    expect(CLIQ_EMAIL_PATTERN.test('me@zohocorp.com')).toBe(true);
    for (const bad of ['', 'me', 'me@x', 'a@b.com, c@d.com', 'a b@c.com', 'a@b@c.com']) expect(CLIQ_EMAIL_PATTERN.test(bad)).toBe(false);
  });

  it('says what happened to a test message, in words', () => {
    expect(testResultMessage('sent').ok).toBe(true);
    for (const code of ['bad-email', 'bad-recipient', 'sign-in-needed', 'signed-out', 'not-configured', 'offline', 'error', 'whatever']) {
      const m = testResultMessage(code);
      expect(m.ok).toBe(false);
      expect(m.text.length).toBeGreaterThan(10);
    }
  });

  it('gives one status line for every state the alerts can be in', () => {
    expect(alertStatusLine(status({ enabled: false }))).toBe('Alerts are off.');
    expect(alertStatusLine(status())).toBe('Alerts are on.');
    expect(alertStatusLine(status({ lastResult: 'sent', lastSentAt: Date.UTC(2026, 9, 2, 6, 30) }))).toMatch(/^Last alert sent /);
    expect(alertStatusLine(status({ lastResult: 'ack-error' }))).toMatch(/receipt/);
    expect(alertStatusLine(status({ lastResult: 'sign-in-needed' }))).toMatch(/sign in again/);
    expect(alertStatusLine(status({ lastResult: 'bad-recipient' }))).toMatch(/work email/);
    expect(alertStatusLine(status({ lastResult: 'error' }))).toMatch(/try again/);
  });
});
