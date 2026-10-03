'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { createWorkspaceDelivery, createInviteMailer, channelFor } = require('./workspaceDelivery');

const config = { ABLY_API_KEY: 'appId.keyId:secretvalue' };
const parts = (jwt) => jwt.split('.').map((p, i) => (i < 2 ? JSON.parse(Buffer.from(p, 'base64url').toString()) : p));
const wsA = 'a'.repeat(43);
const wsB = 'b'.repeat(43);

test('the token is signed with the key, subscribe-only, for exactly the given workspaces', async () => {
	const d = createWorkspaceDelivery({ config, now: () => 1_800_000_000_000 });
	const out = await d.issueToken([wsA, wsB]);
	const [header, body, sig] = parts(out.token);
	assert.equal(header.kid, 'appId.keyId');
	const [h, b] = out.token.split('.');
	assert.equal(sig, createHmac('sha256', 'secretvalue').update(`${h}.${b}`).digest('base64url'));
	assert.deepEqual(JSON.parse(body['x-ably-capability']), { [channelFor(wsA)]: ['subscribe'], [channelFor(wsB)]: ['subscribe'] });
	assert.equal(body.exp - body.iat, 3600);
	assert.deepEqual(out.channels, { [wsA]: channelFor(wsA), [wsB]: channelFor(wsB) });
	assert.equal(out.token.includes('secretvalue'), false);
	assert.deepEqual(await d.issueToken([]), { token: null, channels: {}, expiresAt: null });
});

test('without a key there is no push, and publish says so instead of throwing', async () => {
	const d = createWorkspaceDelivery({ config: {} });
	assert.equal(d.available, false);
	assert.equal(await d.issueToken([wsA]), null);
	assert.equal(await d.publish(wsA, 1), false);
});

test('the doorbell carries only the sequence number, on the workspace channel', async () => {
	let sent;
	const d = createWorkspaceDelivery({ config, fetchImpl: async (url, init) => { sent = { url, init }; return { ok: true }; } });
	assert.equal(await d.publish(wsA, 7), true);
	assert.equal(sent.url, `https://rest.ably.io/channels/${encodeURIComponent(channelFor(wsA))}/messages`);
	assert.deepEqual(JSON.parse(sent.init.body), { name: 'workspace-changed', data: { seq: 7 } });
	assert.deepEqual(JSON.parse(parts(sent.init.headers.Authorization.slice(7))[1]['x-ably-capability']), { [channelFor(wsA)]: ['publish'] });
	const failing = createWorkspaceDelivery({ config, fetchImpl: async () => { throw new Error('down'); } });
	assert.equal(await failing.publish(wsA, 1), false);
});

test('the invite mail escapes names and needs a sender', async () => {
	let mail;
	const app = { email: () => ({ sendMail: async (m) => { mail = m; } }) };
	assert.equal(await createInviteMailer({ app, from: '' })({ to: 'b@x.com', workspaceName: 'W', inviterName: 'A', link: 'https://l' }), false);
	assert.equal(await createInviteMailer({ app, from: 'noreply@x.com' })({ to: 'b@x.com', workspaceName: '<script>', inviterName: 'A & B', link: 'https://l?t=1' }), true);
	assert.deepEqual(mail.to_email, ['b@x.com']);
	assert.match(mail.content, /&lt;script&gt;/);
	assert.match(mail.content, /A &amp; B/);
});
