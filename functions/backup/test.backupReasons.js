'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const { gzipSync } = require('node:zlib');
const { createHash } = require('node:crypto');
const { createCatalystStorage } = require('./catalystStorage');

test('storage persists backup reasons, unwraps query results and treats legacy entries as manual', async () => {
	const rows = [];
	const queries = [];
	const app = {
		datastore: () => ({ table: () => ({ insertRow: async (row) => { rows.push(row); return { ...row, ROWID: '1' }; } }) }),
		filestore: () => ({}),
		zcql: () => ({ executeZCQLQuery: async (query) => { queries.push(query); return rows.map((row) => ({ Backups: { ...row, ROWID: '1' } })); } }),
	};
	const storage = await createCatalystStorage({}, { initialize: () => app });
	const entry = await storage.index.add({ userId: '100001', at: 123, hash: 'a'.repeat(64), size: 10, fileId: '7', reason: 'sign-out' });
	assert.equal(rows[0].BackupReason, 'sign-out');
	assert.equal(entry.reason, 'sign-out');
	assert.equal((await storage.index.list('100001'))[0].reason, 'sign-out');
	delete rows[0].BackupReason;
	assert.equal((await storage.index.list('100001'))[0].reason, 'manual');
	assert.match(queries[0], /WHERE UserId='100001'/);
});

test('authenticated backup route forwards known triggers, defaults to manual and rejects unknown reasons', async () => {
	const rows = [];
	const storage = {
		index: {
			list: async () => rows.toReversed(),
			add: async (entry) => { rows.push(entry); return entry; },
			removeMany: async () => {},
		},
		files: { put: async () => 'file', remove: async () => {} },
	};
	const module = { exports: {} };
	const dependencies = {
		'@zcatalyst/auth/node': { zcAuth: { init: async () => {} }, UserManagement: class {
			async getUserDetails(id) { return { user_id: id, role_details: { role_name: 'App User' } }; }
		} },
		'./catalystStorage': { createCatalystStorage: async () => storage },
		'./cliqRoutes': { createCliqRoutes: () => async () => false },
		'./workspaceRoutes': { createWorkspaceRoutes: () => async () => false },
	};
	vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8'), {
		module, Buffer, console, process, require: (name) => dependencies[name] || require(name),
	});
	const send = async (reason, content) => {
		const bytes = gzipSync(Buffer.from(content));
		const req = Readable.from([bytes]);
		req.url = '/backup'; req.method = 'PUT';
		req.headers = { 'x-zc-user-id': '100001', 'x-content-hash': createHash('sha256').update(bytes).digest('hex') };
		if (reason !== undefined) req.headers['x-backup-reason'] = reason;
		let status;
		await module.exports(req, { writeHead: (code) => { status = code; }, end: () => {} });
		return status;
	};
	for (let index = 0; index < 10; index++) assert.equal(await send(undefined, `manual-${index}`), 201);
	assert.equal(await send('manual', 'eleventh'), 429);
	assert.equal(await send('sign-out', 'logout'), 201);
	assert.equal(await send('signed-in', 'login'), 201);
	assert.equal(await send('manual', 'still-blocked'), 429);
	assert.equal(await send('invented', 'invalid'), 400);
	assert.deepEqual(rows.slice(-2).map((entry) => entry.reason), ['sign-out', 'signed-in']);
	assert.ok(rows.every((entry) => entry.userId === '100001'));
});