'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { createCliqDelivery, channelFor } = require('./cliqDelivery');

const link = { linkId: 'a'.repeat(32), email: 'alice@example.com', accountId: '123456', deviceId: 'desktop-1', generation: 1 };
const decode = (token) => {
	const [head, claims, signature] = token.split('.');
	assert.equal(signature, createHmac('sha256', 'secret').update(`${head}.${claims}`).digest('base64url'));
	return [JSON.parse(Buffer.from(head, 'base64url')), JSON.parse(Buffer.from(claims, 'base64url'))];
};

test('Ably JWTs only grant channel-specific subscribe or publish for one hour', async () => {
	let request;
	const delivery = createCliqDelivery({ config: { ABLY_API_KEY: 'app.key:secret' }, now: () => 1_800_000_000_000,
		fetchImpl: async (url, options) => { request = { url, options }; return { ok: true }; } });
	const { token, channel } = await delivery.issueToken(link);
	assert.deepEqual(await delivery.issueToken(link), { token, channel, accountId: link.accountId, deviceId: link.deviceId, generation: link.generation });
	assert.equal(channel, channelFor(link));
	assert.equal(channel.includes(link.linkId), false);
	const [header, claims] = decode(token);
	assert.deepEqual(header, { typ: 'JWT', alg: 'HS256', kid: 'app.key' });
	assert.equal(claims.exp - claims.iat, 3600);
	assert.deepEqual(JSON.parse(claims['x-ably-capability']), { [channel]: ['subscribe'] });
	assert.equal(await delivery.publish(link, { commandId: 'abc' }), true);
	assert.equal(request.url, `https://rest.ably.io/channels/${encodeURIComponent(channel)}/messages`);
	assert.equal(request.options.redirect, 'error');
	assert.deepEqual(JSON.parse(decode(request.options.headers.Authorization.slice(7))[1]['x-ably-capability']), { [channel]: ['publish'] });
	assert.deepEqual(JSON.parse(request.options.body), { id: 'abc', name: 'inbox-changed', data: {} });
});

test('missing or failing providers do not expose credentials or raw errors', async () => {
	const missing = createCliqDelivery({ config: {} });
	assert.equal(missing.issueToken, undefined);
	assert.equal(await missing.publish(link, { commandId: 'abc' }), false);
	const delivery = createCliqDelivery({ config: { ABLY_API_KEY: 'app.key:secret', CLIQ_BOT: 'hitlist', CLIQ_TOKEN: 'private' },
		fetchImpl: async () => { throw Error('private provider details'); } });
	assert.equal(await delivery.publish(link, { commandId: 'abc' }), false);
	assert.equal(await delivery.reply(link, 'abc', { status: 'failed' }), false);
});

test('task replies contain the ID and version needed for stale-safe commands', async () => {
	let text;
	const delivery = createCliqDelivery({ config: { CLIQ_BOT: 'hitlistbot', CLIQ_TOKEN: 'test-token' },
		fetchImpl: async (_url, options) => { text = JSON.parse(options.body).text; return { status: 200 }; } });
	assert.equal(await delivery.reply(link, 'command-1', { status: 'applied', tasks: [
		{ taskId: 'task-1', title: 'Prepare report', updatedAt: '2026-10-02T09:00:00Z' },
	] }), true);
	assert.match(text, /ID: task-1/);
	assert.match(text, /Version: 2026-10-02T09:00:00Z/);
	assert.doesNotMatch(text, /test-token/);
});