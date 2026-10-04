import { describe, expect, it } from 'vitest';
import { initialOf, inviteTokenFrom, memberLabel, workspaceReason } from '@/lib/workspaceMessage';

const TOKEN = 'abcDEF0123456789abcDEF0123456789abcDEF01234';

describe('workspaceMessage', () => {
  it('finds the invite code in a pasted link, a custom-protocol link, or on its own', () => {
    expect(TOKEN).toHaveLength(43);
    expect(inviteTokenFrom(`https://app.example/invite.html?t=${TOKEN}`)).toBe(TOKEN);
    expect(inviteTokenFrom(`  hitlist://invite?x=1&t=${TOKEN}&y=2 `)).toBe(TOKEN);
    expect(inviteTokenFrom(`https://app.example/invite.html?t=${TOKEN}#top`)).toBe(TOKEN);
    expect(inviteTokenFrom(TOKEN)).toBe(TOKEN);
  });

  it('refuses text that is not an invite', () => {
    expect(inviteTokenFrom('')).toBeNull();
    expect(inviteTokenFrom('https://app.example/invite.html?t=short')).toBeNull();
    expect(inviteTokenFrom(`${TOKEN}extra`)).toBeNull();
    expect(inviteTokenFrom('hello world')).toBeNull();
  });

  it('turns cloud codes into plain sentences, with a safe fallback', () => {
    expect(workspaceReason('wrong_account')).toMatch(/different email address/);
    expect(workspaceReason('invite_expired')).toMatch(/expired/);
    expect(workspaceReason('owner_cannot_leave')).toMatch(/owner cannot leave/);
    expect(workspaceReason('something-new')).toMatch(/did not work/);
    expect(workspaceReason(undefined)).toMatch(/did not work/);
  });

  it('labels people by name, else by the start of their email', () => {
    expect(memberLabel({ name: 'Alice A', email: 'a@x.com' })).toBe('Alice A');
    expect(memberLabel({ name: '  ', email: 'bob@x.com' })).toBe('bob');
    expect(memberLabel({})).toBe('Member');
    expect(initialOf('alice')).toBe('A');
    expect(initialOf('')).toBe('?');
  });
});
