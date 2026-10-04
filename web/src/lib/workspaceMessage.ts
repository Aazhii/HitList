/** What the shared-workspace screens say. The shell and the cloud report short codes; these are the words. */
const REASONS: Record<string, string> = {
  invalid_email: 'Enter a valid email address.',
  email_not_allowed: 'That email address is not allowed in this workspace.',
  already_member: 'That is already your own address.',
  owner_only: 'Only the owner can do that.',
  not_a_member: 'You are not a member of this workspace.',
  invalid_invite: 'That invite link is not valid. Ask for a new one.',
  invite_expired: 'That invite has expired. Ask for a new one.',
  invite_used: 'That invite was already used. Ask for a new one.',
  wrong_account: 'This invite was sent to a different email address. Sign in to HitList with the address it was sent to.',
  owner_cannot_leave: 'The owner cannot leave. Remove the other members first, or keep the workspace.',
  workspaces_unavailable: 'Shared workspaces are not switched on for this account yet.',
  push_unavailable: 'Live updates are not set up yet; changes will still arrive when the app next connects.',
  offline: 'Could not reach the server. Try again when you are online.',
  'cloud-error': 'The server did not accept that. Try again in a moment.',
  'unknown-workspace': 'That workspace is not on this computer yet.',
};

export function workspaceReason(reason: string | undefined): string {
  return (reason && REASONS[reason]) || 'That did not work. Try again in a moment.';
}

/** The invite code from a pasted link (`…invite.html?t=CODE`, `hitlist://invite?t=CODE`) or the bare code. */
export function inviteTokenFrom(text: string): string | null {
  const value = text.trim();
  const fromLink = /[?&]t=([A-Za-z0-9_-]{43})(?:[&#]|$)/.exec(value);
  if (fromLink) return fromLink[1];
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

/** "Alice A" -> "A", "bob@x.com" -> "B": what the round avatar shows. */
export function initialOf(nameOrEmail: string): string {
  const first = nameOrEmail.trim().charAt(0);
  return first ? first.toUpperCase() : '?';
}

/** A member's label: their name, else the part of their email before the @. */
export function memberLabel(m: { name?: string | null; email?: string | null }): string {
  return (m.name && m.name.trim()) || (m.email ? m.email.split('@')[0] : 'Member');
}
