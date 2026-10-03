'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCliqInboxService } = require('./cliqInboxService');

function memoryStore() {
	const records = new Map();
	const accounts = new Map();
	const senders = new Map();
	return {
		records,
		async insertUnique(key, value) { if (records.has(key)) return false; records.set(key, structuredClone(value)); return true; },
		async get(key) { return structuredClone(records.get(key) || null); },
		async set(key, value) { records.set(key, structuredClone(value)); },
		async remove(key) { records.delete(key); },
		async linkByAccount(id) { return structuredClone(accounts.get(id) || null); },
		async linkBySender(key) { return structuredClone(senders.get(key) || null); },
		async createLink(link) {
			if (accounts.has(link.accountId) || senders.has(link.senderKey)) return false;
			accounts.set(link.accountId, structuredClone(link)); senders.set(link.senderKey, structuredClone(link)); return true;
		},
		async deleteLink(link) { if (accounts.get(link.accountId)?.linkId !== link.linkId) return; accounts.delete(link.accountId); senders.delete(link.senderKey); },
		async listPending(accountId, deviceId, generation, limit) {
			return [...records.entries()].filter(([key, value]) => key.startsWith('command:') && value.status !== 'terminal' && value.accountId === accountId && value.deviceId === deviceId && value.generation === generation).map(([, value]) => structuredClone(value)).slice(0, limit);
		},
	};
}

const alice = { userId: '123456', email: 'ALICE@Example.com' };
const bob = { userId: '234567', email: 'bob@example.com' };
const sender = { id: '987654', email: 'alice@example.com', orgId: '123456' };
const other = { id: '876543', email: 'alice@example.com', orgId: '123456' };
const device = { deviceId: 'desktop-1', timeZone: 'Asia/Kolkata' };
function setup(extra = {}) {
	const store = memoryStore(); let time = 1_800_000_000_000;
	const svc = createCliqInboxService({ store, allowedDomains: ['example.com'], verifySender: (value) => value.trusted !== false, now: () => time, publish: async () => true, reply: async () => true, ...extra });
	return { store, svc, advance: (ms) => { time += ms; } };
}
async function linked(context) {
	const challenge = await context.svc.startLink(alice, device);
	await context.svc.claimLink(sender, challenge.code);
	return context.svc.confirmLink(alice, { nonce: challenge.nonce, deviceId: device.deviceId });
}

test('challenge is hashed, claimed by the same trusted identity, and confirmed only by original account/device', async () => {
	const context = setup(); const { svc, store } = context;
	const challenge = await svc.startLink(alice, device);
	assert.equal([...store.records.values()].some((entry) => JSON.stringify(entry).includes(challenge.code)), false);
	await assert.rejects(svc.claimLink({ ...sender, trusted: false }, challenge.code), { code: 'untrusted_sender' });
	await assert.rejects(svc.claimLink({ ...sender, email: 'evil@outside.org' }, challenge.code), { code: 'untrusted_sender' });
	await svc.claimLink(sender, challenge.code);
	await svc.claimLink(sender, challenge.code);
	await assert.rejects(svc.claimLink(other, challenge.code), { code: 'already_claimed' });
	await assert.rejects(svc.confirmLink(bob, { nonce: challenge.nonce, deviceId: device.deviceId }), { code: 'invalid_challenge' });
	await assert.rejects(svc.confirmLink(alice, { nonce: challenge.nonce, deviceId: 'wrong' }), { code: 'invalid_challenge' });
	const link = await svc.confirmLink(alice, { nonce: challenge.nonce, deviceId: device.deviceId });
	assert.equal(link.senderKey, undefined);
	assert.equal(link.generation, (await svc.confirmLink(alice, { nonce: challenge.nonce, deviceId: device.deviceId })).generation);
	context.advance(1000);
	assert.equal(link.generation, (await svc.confirmLink(alice, { nonce: challenge.nonce, deviceId: device.deviceId })).generation);
	assert.deepEqual(await svc.getLink(alice, { deviceId: device.deviceId }), link);
	assert.equal(await svc.getLink(alice, { deviceId: 'other' }), null);
	assert.equal((await svc.confirmLink(alice, { nonce: challenge.nonce, deviceId: device.deviceId })).linkId, link.linkId);
});

test('atomic claim and unique link keys reject competing senders/accounts', async () => {
	const context = setup(); const { svc, store } = context;
	const challenge = await svc.startLink(alice, device);
	const claims = await Promise.allSettled([svc.claimLink(sender, challenge.code), svc.claimLink(other, challenge.code)]);
	assert.deepEqual(claims.map((result) => result.status).sort(), ['fulfilled', 'rejected']);
	const chosen = claims[0].status === 'fulfilled' ? sender : other;
	const link = await svc.confirmLink(alice, { nonce: challenge.nonce, deviceId: device.deviceId });
	assert.equal((await store.linkByAccount(alice.userId)).senderKey, `${chosen.orgId}:${chosen.id}`);
	assert.equal(await store.createLink({ ...link, linkId: 'different', accountId: bob.userId, senderKey: `${chosen.orgId}:${chosen.id}` }), false);
	await assert.rejects(svc.startLink(alice, device), { code: 'already_linked' });
});

test('expired challenge cannot be claimed or confirmed', async () => {
	const context = setup(); const challenge = await context.svc.startLink(alice, device);
	context.advance(600_000);
	await assert.rejects(context.svc.claimLink(sender, challenge.code), { code: 'invalid_challenge' });
	await assert.rejects(context.svc.confirmLink(alice, { nonce: challenge.nonce, deviceId: device.deviceId }), { code: 'invalid_challenge' });
});

test('durable dedup retains expiry and isolates pending by active device and generation', async () => {
	const context = setup(); const { svc, store } = context; const link = await linked(context);
	const event = { eventId: 'evt-1', sender, text: 'add "Report" --due 2026-10-02 --time 09:00' };
	const first = await svc.acceptEvent(event); context.advance(1000);
	assert.deepEqual(await svc.acceptEvent(event), first);
	await assert.rejects(svc.acceptEvent({ ...event, text: 'list open --page 1' }), { code: 'event_conflict' });
	await assert.rejects(svc.fetchPending(bob, { deviceId: link.deviceId, generation: link.generation }), { code: 'inactive_link' });
	await assert.rejects(svc.fetchPending(alice, { deviceId: 'elsewhere', generation: link.generation }), { code: 'inactive_link' });
	assert.equal((await svc.fetchPending(alice, { deviceId: link.deviceId, generation: link.generation })).length, 1);
	assert.deepEqual((await svc.fetchPending(alice, { deviceId: link.deviceId, generation: link.generation }))[0], {
		id: first.commandId, accountId: alice.userId, deviceId: link.deviceId, generation: link.generation,
		schemaVersion: 1, type: 'create', payload: { title: 'Report', dueDate: '2026-10-02', dueTime: '09:00' }, expiresAt: first.expiresAt,
	});
	await svc.unlink(alice);
	await assert.rejects(svc.fetchPending(alice, { deviceId: link.deviceId, generation: link.generation }), { code: 'inactive_link' });
	assert.equal(store.records.has(`command:${first.commandId}`), true);
});

test('publish failure keeps command queued; ACK result is immutable and reply failure independent', async () => {
	const context = setup({ publish: async () => { throw Error('offline'); }, reply: async () => false });
	const { svc } = context; const link = await linked(context);
	const event = { eventId: 'evt-2', sender, text: 'done task1 --version 2026-10-02T12:00:00Z' };
	const queued = await svc.acceptEvent(event);
	assert.equal(queued.pushPending, true);
	assert.equal((await svc.fetchPending(alice, { deviceId: link.deviceId, generation: link.generation })).length, 1);
	const ack = { deviceId: link.deviceId, generation: link.generation, commandId: queued.commandId, result: { status: 'applied', task: { taskId: 'task1', title: 'x'.repeat(255), status: 'DONE', dueDate: null, dueTime: null, updatedAt: '2026-10-02T12:00:00Z' } } };
	assert.deepEqual(await svc.ack(alice, ack), { acknowledged: true, replyPending: true });
	assert.deepEqual(await svc.ack(alice, ack), { acknowledged: true, replyPending: true });
	await assert.rejects(svc.ack(alice, { ...ack, result: { status: 'failed' } }), { code: 'result_conflict' });
	await assert.rejects(svc.ack(alice, { ...ack, result: { ...ack.result, arbitrary: 'secret' } }), { code: 'invalid_result' });
	assert.deepEqual(await svc.fetchPending(alice, { deviceId: link.deviceId, generation: link.generation }), []);
	assert.equal((await svc.acceptEvent(event)).expiresAt, queued.expiresAt);
});

test('ACK frees a bounded pending page for the next queued command', async () => {
	const context = setup(); const { svc } = context; const link = await linked(context);
	const first = await svc.acceptEvent({ eventId: 'first', sender, text: 'list open --page 1' });
	const second = await svc.acceptEvent({ eventId: 'second', sender, text: 'list open --page 1' });
	const scope = { deviceId: link.deviceId, generation: link.generation };
	assert.equal((await svc.fetchPending(alice, { ...scope, limit: 1 }))[0].id, first.commandId);
	await svc.ack(alice, { ...scope, commandId: first.commandId, result: { status: 'applied', tasks: [], page: 1, hasMore: false } });
	assert.equal((await svc.fetchPending(alice, { ...scope, limit: 1 }))[0].id, second.commandId);
});

test('a recorded result is marked terminal and does not block the next pending page', async () => {
	const context = setup(); const { svc, store } = context; const link = await linked(context);
	const first = await svc.acceptEvent({ eventId: 'crashed', sender, text: 'list' });
	const second = await svc.acceptEvent({ eventId: 'waiting', sender, text: 'list' });
	await store.insertUnique(`result:${first.commandId}`, { status: 'applied', tasks: [], page: 1, hasMore: false });
	const pending = await svc.fetchPending(alice, { deviceId: link.deviceId, generation: link.generation, limit: 1 });
	assert.equal(pending[0].id, second.commandId);
	assert.equal((await store.get(`command:${first.commandId}`)).status, 'terminal');
});

test('ACK compares nested results canonically but rejects arbitrary receipt fields', async () => {
	const context = setup(); const { svc } = context; const link = await linked(context);
	const queued = await svc.acceptEvent({ eventId: 'canonical', sender, text: 'list' });
	const scope = { deviceId: link.deviceId, generation: link.generation, commandId: queued.commandId };
	await svc.ack(alice, { ...scope, result: { status: 'applied', tasks: [], page: 1, hasMore: false } });
	assert.deepEqual(await svc.ack(alice, { ...scope, result: { hasMore: false, page: 1, tasks: [], status: 'applied' } }), { acknowledged: true, replyPending: false });
	context.advance(604_800_000);
	assert.deepEqual(await svc.ack(alice, { ...scope, result: { hasMore: false, page: 1, tasks: [], status: 'applied' } }), { acknowledged: true, replyPending: false });
	await assert.rejects(svc.ack(alice, { ...scope, result: { status: 'applied', tasks: [{ taskId: 'id', title: 'x', status: 'OPEN', dueDate: null, dueTime: null, updatedAt: 'now', secret: 'no' }], page: 1, hasMore: false } }), { code: 'invalid_result' });
});

test('simultaneous duplicate events insert one immutable command', async () => {
	const context = setup(); const { svc, store } = context; await linked(context);
	const event = { eventId: 'concurrent', sender, text: 'list today --page 1' };
	const results = await Promise.all([svc.acceptEvent(event), svc.acceptEvent(event)]);
	assert.equal(results[0].commandId, results[1].commandId);
	assert.equal([...store.records.keys()].filter((key) => key.startsWith('command:')).length, 1);
});

test('old generation and expired commands cannot be fetched or acknowledged', async () => {
	const context = setup(); const { svc } = context; const firstLink = await linked(context);
	const queued = await svc.acceptEvent({ eventId: 'old', sender, text: 'list open --page 1' });
	await svc.unlink(alice);
	context.advance(1);
	const nextLink = await linked(context);
	assert.notEqual(firstLink.linkId, nextLink.linkId);
	assert.deepEqual(await svc.fetchPending(alice, { deviceId: nextLink.deviceId, generation: nextLink.generation }), []);
	await assert.rejects(svc.ack(alice, { deviceId: nextLink.deviceId, generation: nextLink.generation, commandId: queued.commandId, result: { status: 'ok' } }), { code: 'unknown_command' });
	const current = await svc.acceptEvent({ eventId: 'new', sender, text: 'list today --page 1' });
	context.advance(604_800_000);
	assert.equal((await svc.fetchPending(alice, { deviceId: nextLink.deviceId, generation: nextLink.generation }))[0].id, current.commandId);
	await assert.rejects(svc.ack(alice, { deviceId: nextLink.deviceId, generation: nextLink.generation, commandId: current.commandId, result: { status: 'applied' } }), { code: 'invalid_result' });
	assert.deepEqual(await svc.ack(alice, { deviceId: nextLink.deviceId, generation: nextLink.generation, commandId: current.commandId, result: { status: 'expired' } }), { acknowledged: true, replyPending: false });
});

test('token issuer receives only an active confirmed link', async () => {
	let issued;
	const context = setup({ issueToken: async (link) => { issued = link; return { token: 'short-lived' }; } });
	const link = await linked(context);
	await assert.rejects(context.svc.token(bob, { deviceId: link.deviceId, generation: link.generation }), { code: 'inactive_link' });
	await assert.rejects(context.svc.token(alice, { deviceId: 'other', generation: link.generation }), { code: 'inactive_link' });
	assert.deepEqual(await context.svc.token(alice, { deviceId: link.deviceId, generation: link.generation }), { token: 'short-lived' });
	assert.equal(issued.linkId, link.linkId);
});