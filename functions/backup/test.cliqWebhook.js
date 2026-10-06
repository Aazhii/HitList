'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { handleCliqWebhook } = require('./cliqWebhook');

const config = { CLIQ_INBOUND_ENABLED: 'true', CLIQ_LINKS_TABLE: 'CliqLinks', CLIQ_RECORDS_TABLE: 'CliqRecords',
	CLIQ_ALLOWED_DOMAINS: 'example.com', CLIQ_ORG_ID: '123456', CLIQ_WEBHOOK_SECRET: 's'.repeat(32),
	CLIQ_BOT: 'hitlist', CLIQ_TOKEN: 'private', ABLY_API_KEY: 'app.key:secret' };
const payload = { eventId: 'one', sender: { id: '987654', orgId: '123456', email: 'alice@example.com' }, text: 'help' };
async function request(body, headers = { 'x-hitlist-cliq-secret': config.CLIQ_WEBHOOK_SECRET }, options = {}) {
	const req = Readable.from([Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
	req.method = options.method || 'POST'; req.headers = headers;
	const res = { writeHead(status) { this.status = status; }, end(value) { this.body = JSON.parse(value); } };
	await handleCliqWebhook(req, res, { config: options.config || config, createStorage: options.createStorage || (() => { throw Error('storage must not run'); }), fetchImpl: async () => ({ ok: false }) });
	return { status: res.status, body: res.body };
}

test('webhook rejects missing configuration, wrong secret, foreign org and body routing', async () => {
	assert.equal((await request(payload, {}, { config: {} })).status, 503);
	assert.equal((await request(payload, {}, { config: { ...config, ABLY_API_KEY: 'invalid' } })).status, 503);
	assert.equal((await request(payload, {})).status, 401);
	assert.equal((await request(payload, { 'x-hitlist-cliq-secret': 'wrong' })).status, 401);
	assert.equal((await request(payload, undefined, { method: 'GET' })).status, 405);
	assert.deepEqual(await request({ ...payload, sender: { ...payload.sender, orgId: 'elsewhere' } }), { status: 403, body: { error: 'untrusted_sender' } });
	assert.equal((await request({ ...payload, accountId: 'victim' })).status, 403);
	assert.equal((await request('x'.repeat(10001))).status, 413);
});

test('authenticated help returns instructions without invoking storage', async () => {
	const response = await request(payload, undefined, { createStorage: () => ({}) });
	assert.equal(response.status, 200);
	assert.equal(response.body.status, 'help');
	assert.match(response.body.text, /add "Title"/);
});

test('transport authentication gates link claims and queued commands', async () => {
	const records = new Map();
	const link = { linkId: 'a'.repeat(32), accountId: '123456', deviceId: 'desktop', generation: 42, senderKey: '123456:987654', email: 'alice@example.com' };
	const store = {
		async get(key) { return records.get(key) || null; },
		async insertUnique(key, value) { if (records.has(key)) return false; records.set(key, value); return true; },
		async linkBySender() { return link; },
	};
	const options = { createStorage: () => store };
	const queued = await request({ ...payload, text: 'list' }, undefined, options);
	assert.equal(queued.status, 202);
	assert.equal(queued.body.status, 'queued');
	assert.equal(queued.body.pushPending, true);
	assert.match(queued.body.commandId, /^[a-f0-9]{64}$/);
	const status = await request({ ...payload, eventId: 'status', text: `status ${queued.body.commandId}` }, undefined, options);
	assert.deepEqual(status, { status: 200, body: { status: 'queued', commandId: queued.body.commandId, result: null } });
	assert.equal((await request({ ...payload, text: 'list' }, {}, options)).status, 401);
});

test('explicit bot request labels deduplicate retries and reject changed commands', async () => {
	const records = new Map();
	const link = { linkId: 'b'.repeat(32), accountId: '123456', deviceId: 'desktop', generation: 42,
		senderKey: '123456:987654', email: 'alice@example.com' };
	const store = {
		async get(key) { return records.get(key) || null; },
		async insertUnique(key, value) { if (records.has(key)) return false; records.set(key, value); return true; },
		async linkBySender() { return link; },
	};
	const options = { createStorage: () => store };
	const event = { ...payload, eventId: 'request:report-001', text: 'add "Prepare report"' };
	const first = await request(event, undefined, options);
	const retry = await request(event, undefined, options);
	assert.equal(first.status, 202);
	assert.equal(retry.body.commandId, first.body.commandId);
	assert.equal([...records.keys()].filter((key) => key.startsWith('command:')).length, 1);
	const changed = await request({ ...event, text: 'add "Different report"' }, undefined, options);
	assert.deepEqual(changed, { status: 409, body: { error: 'event_conflict' } });
	const independent = await request({ ...event, eventId: 'request:report-002' }, undefined, options);
	assert.equal(independent.status, 202);
	assert.notEqual(independent.body.commandId, first.body.commandId);
});