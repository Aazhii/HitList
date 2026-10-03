'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createWorkspaceRoutes } = require('./workspaceRoutes');

const caller = { userId: '100001', email: 'alice@example.com', name: 'Alice' };
const ws = 'w'.repeat(43);
async function request(router, path, body = {}, method = 'POST') {
	const req = Readable.from([Buffer.from(JSON.stringify(body))]); req.method = method; req.url = path;
	const res = { writeHead(status) { this.status = status; }, end(data) { this.body = JSON.parse(data); } };
	const handled = await router(req, res, caller, path.split('?')[0]);
	return { handled, status: res.status, body: res.body };
}
const fakeStore = (extra = {}) => ({
	getMember: async (w, u) => (u === caller.userId ? { workspaceId: w, userId: u, role: 'owner' } : null),
	membershipsOf: async () => [], lastSeq: async () => 0, insertChange: async () => 'ok', changeByBatch: async () => null,
	changesAfter: async () => [], ...extra,
});
const delivery = { publish: async () => true, issueToken: async (ids) => ({ token: 't', channels: Object.fromEntries(ids.map((i) => [i, i])) }) };

test('ignores other paths and stays off until enabled', async () => {
	const off = createWorkspaceRoutes({ config: {}, createStorage: () => { throw new Error('no'); }, delivery });
	assert.equal((await request(off, '/backup')).handled, false);
	assert.deepEqual(await request(off, '/ws', {}, 'GET'), { handled: true, status: 503, body: { error: 'workspaces_unavailable' } });
});

test('routes reach the service with the verified caller, and errors never leak details', async () => {
	let pushed;
	const router = createWorkspaceRoutes({ config: { WS_ENABLED: 'true' }, delivery, mailer: async () => false,
		createStorage: () => fakeStore({ insertChange: async (c) => { pushed = c; return 'ok'; } }) });
	const out = await request(router, `/ws/${ws}/changes`, { deviceId: 'mac-1', batchId: 'b1', ops: [{ table: 'tasks', id: 't1', fields: { Title: 'x' } }], authorUserId: '999999' });
	assert.equal(out.status, 200);
	assert.equal(out.body.seq, 1);
	assert.equal(pushed.authorUserId, caller.userId);
	const pulled = await request(router, `/ws/${ws}/changes?after=0&limit=5`, {}, 'GET');
	assert.deepEqual(pulled.body, { changes: [], hasMore: false });
	assert.equal((await request(router, `/ws/short/changes`, {}, 'GET')).status, 404);
	const broken = createWorkspaceRoutes({ config: { WS_ENABLED: 'true' }, delivery, createStorage: () => { throw new Error('SDK token=secret'); } });
	assert.deepEqual(await request(broken, '/ws', {}, 'GET'), { handled: true, status: 503, body: { error: 'workspaces_unavailable' } });
	const bad = await request(router, `/ws/${ws}/changes`, { deviceId: 'mac-1', batchId: 'b1', ops: [] });
	assert.deepEqual(bad.body, { error: 'invalid_ops' });
	assert.equal(bad.status, 400);
});
