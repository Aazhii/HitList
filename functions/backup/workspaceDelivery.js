'use strict';

/**
 * The push side of shared workspaces: one Ably channel per workspace, used only as a doorbell (the message carries the
 * new sequence number and nothing else), and subscribe-only tokens covering exactly the workspaces a person belongs to.
 * Tokens are signed here from ABLY_API_KEY (the same mechanism as cliqDelivery.js); the desktop never sees the key.
 */
const { createHash, createHmac } = require('node:crypto');

const channelFor = (workspaceId) => `hitlist:ws:${createHash('sha256').update(`hitlist-ws:${workspaceId}`).digest('hex')}`;
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const TOKEN_SECONDS = 3600;

function createWorkspaceDelivery({ config = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
	const match = /^([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+):([^:\s]+)$/.exec(config.ABLY_API_KEY || '');
	const sign = (capability) => {
		const issued = Math.floor(now() / 1000);
		const content = `${encode({ typ: 'JWT', alg: 'HS256', kid: match[1] })}.${encode({ iat: issued, exp: issued + TOKEN_SECONDS, 'x-ably-capability': JSON.stringify(capability) })}`;
		return `${content}.${createHmac('sha256', match[2]).update(content).digest('base64url')}`;
	};
	return {
		available: !!match,
		/** A token that may only subscribe, and only to these workspaces' channels. No workspaces: no token (nothing to hear). */
		issueToken: async (workspaceIds) => {
			if (!match) return null;
			const channels = Object.fromEntries(workspaceIds.map((id) => [id, channelFor(id)]));
			if (workspaceIds.length === 0) return { token: null, channels, expiresAt: null };
			const capability = Object.fromEntries(Object.values(channels).map((c) => [c, ['subscribe']]));
			return { token: sign(capability), channels, expiresAt: (Math.floor(now() / 1000) + TOKEN_SECONDS) * 1000 };
		},
		/** Rings the workspace's doorbell. A failure is fine: members catch up when they next connect. */
		publish: async (workspaceId, seq) => {
			if (!match) return false;
			const channel = channelFor(workspaceId);
			try {
				const response = await fetchImpl(`https://rest.ably.io/channels/${encodeURIComponent(channel)}/messages`, {
					method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
					headers: { Authorization: `Bearer ${sign({ [channel]: ['publish'] })}`, 'Content-Type': 'application/json' },
					body: JSON.stringify({ name: 'workspace-changed', data: { seq: Number.isSafeInteger(seq) ? seq : null } }),
				});
				return response.ok;
			} catch { return false; }
		},
	};
}

/** The invite email, through Catalyst Mail. Needs a verified sender address (WS_MAIL_FROM); without it nothing is sent. */
function createInviteMailer({ app, from }) {
	const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
	return async ({ to, workspaceName, inviterName, link }) => {
		if (!from || !app) return false;
		await app.email().sendMail({
			from_email: from,
			to_email: [to],
			subject: `${inviterName} invited you to "${workspaceName}" on HitList`,
			html_mode: true,
			content: `<p>${escape(inviterName)} invited you to the shared workspace <b>${escape(workspaceName)}</b> on HitList.</p>`
				+ `<p><a href="${escape(link)}">Join the workspace</a></p>`
				+ `<p>Open the link on the computer where HitList is installed, signed in with this email address (${escape(to)}).`
				+ ' The link works once and expires in 7 days.</p>',
		});
		return true;
	};
}

module.exports = { createWorkspaceDelivery, createInviteMailer, channelFor };
