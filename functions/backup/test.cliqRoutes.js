'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createCliqRoutes } = require('./cliqRoutes');

const caller = { userId: '123456', email: 'alice@example.com' };
const enabled = { CLIQ_INBOUND_ENABLED: 'true', CLIQ_LINKS_TABLE: 'CliqLinks', CLIQ_RECORDS_TABLE: 'CliqRecords', CLIQ_ALLOWED_DOMAINS: 'example.com' };
async function request(router, path, body = {}, method = 'POST') {
	const req = Readable.from([Buffer.from(JSON.stringify(body))]); req.method = method; req.url = path;
	const response = { writeHead(status) { this.status = status; }, end(data) { this.body = JSON.parse(data); } };
	const handled = await router(req, response, caller, path.split('?')[0]);
	return { handled, status: response.status, body: response.body };
}

test('router ignores unrelated paths and fails closed without configuration', async () => {
	const router = createCliqRoutes({ config: {}, createStorage: () => { throw Error('should not run'); } });
	assert.deepEqual(await request(router, '/backup'), { handled: false, status: undefined, body: undefined });
	assert.deepEqual(await request(router, '/cliq/link/start'), { handled: true, status: 503, body: { error: 'cliq_inbound_unavailable' } });
});

test('GET link status is device-bound and does not expose the sender key', async () => {
	const router = createCliqRoutes({ config: enabled, createStorage: () => ({
		linkByAccount: async () => ({ accountId: caller.userId, deviceId: 'desktop-1', generation: 42, email: caller.email,
			timeZone: 'Asia/Kolkata', linkId: 'a'.repeat(32), senderKey: '123456:987654' }),
	}) });
	const found = await request(router, '/cliq/link?deviceId=desktop-1', {}, 'GET');
	assert.equal(found.status, 200);
	assert.deepEqual(found.body, { accountId: caller.userId, deviceId: 'desktop-1', generation: 42, email: caller.email,
		timeZone: 'Asia/Kolkata', linkId: 'a'.repeat(32) });
	assert.deepEqual(await request(router, '/cliq/link?deviceId=other', {}, 'GET'), { handled: true, status: 200, body: null });
	assert.deepEqual(await request(router, '/cliq/token', { deviceId: 'desktop-1', generation: 42 }), { handled: true, status: 503, body: { error: 'token_unavailable' } });
});

test('enabled router forwards verified caller to service and never returns adapter errors', async () => {
	let account;
	const router = createCliqRoutes({ config: enabled, createStorage: () => ({
		linkByAccount: async (id) => { account = id; return null; },
		insertUnique: async () => true,
	}) });
	const started = await request(router, '/cliq/link/start', { deviceId: 'desktop-1', timeZone: 'Asia/Kolkata', userId: 'attacker' });
	assert.equal(started.status, 200);
	assert.match(started.body.code, /^[a-f0-9]{32}$/);
	assert.equal(account, caller.userId);
	const broken = createCliqRoutes({ config: enabled, createStorage: () => { throw Error('SDK token=secret'); } });
	assert.deepEqual(await request(broken, '/cliq/link/start'), { handled: true, status: 503, body: { error: 'cliq_inbound_unavailable' } });
});