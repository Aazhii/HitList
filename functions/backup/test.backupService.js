'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { gzipSync } = require('node:zlib');
const { createHash } = require('node:crypto');
const { createBackupService, BackupError } = require('./backupService');

/** An in-memory stand-in for the Data Store index and the File Store. */
function fakeStorage() {
	const rows = [];
	const blobs = new Map();
	let n = 0;
	return {
		rows,
		blobs,
		index: {
			latest: async (u) => rows.filter((r) => r.userId === u).sort((a, b) => b.at - a.at)[0] || null,
			list: async (u) => rows.filter((r) => r.userId === u).sort((a, b) => b.at - a.at),
			add: async (e) => { const row = { ...e, rowId: ++n }; rows.push(row); return row; },
			remove: async (u, e) => { const i = rows.findIndex((r) => r.userId === u && r.rowId === e.rowId); if (i >= 0) rows.splice(i, 1); },
		},
		files: {
			put: async (_u, _name, bytes) => { const id = String(++n); blobs.set(id, bytes); return id; },
			get: async (id) => blobs.get(id),
			remove: async (id) => { blobs.delete(id); },
		},
	};
}
const snap = (text) => { const bytes = gzipSync(Buffer.from(text)); return { bytes, hash: createHash('sha256').update(bytes).digest('hex') }; };
let clock = 1000;
const service = (s, extra = {}) => createBackupService({ ...s, now: () => (clock += 10), ...extra });

test('stores a backup and returns it as the latest', async () => {
	const s = fakeStorage(); const svc = service(s);
	const a = snap('one');
	assert.equal((await svc.save('111', a.bytes, a.hash)).stored, true);
	const latest = await svc.latest('111');
	assert.deepEqual(latest.bytes, a.bytes);
	assert.equal(latest.entry.hash, a.hash);
});

test('does not store the same content twice in a row', async () => {
	const s = fakeStorage(); const svc = service(s);
	const a = snap('same');
	await svc.save('111', a.bytes, a.hash);
	assert.equal((await svc.save('111', a.bytes, a.hash)).stored, false);
	assert.equal(s.rows.length, 1);
	const b = snap('changed');
	assert.equal((await svc.save('111', b.bytes, b.hash)).stored, true);
	assert.equal((await svc.list('111')).length, 2);
});

test('keeps only the newest seven, and deletes the files with them', async () => {
	const s = fakeStorage(); const svc = service(s);
	for (let i = 0; i < 10; i++) { const x = snap(`v${i}`); await svc.save('111', x.bytes, x.hash); }
	const list = await svc.list('111');
	assert.equal(list.length, 7);
	assert.equal(s.blobs.size, 7);
	assert.ok(list[0].at > list[6].at);
});

test('one user can never read or change another user\'s backups', async () => {
	const s = fakeStorage(); const svc = service(s);
	const a = snap('alice secret'); const b = snap('bob data');
	await svc.save('111', a.bytes, a.hash);
	await svc.save('222', b.bytes, b.hash);
	assert.deepEqual((await svc.latest('222')).bytes, b.bytes);
	assert.deepEqual((await svc.latest('111')).bytes, a.bytes);
	assert.equal(await svc.latest('333'), null);
	assert.deepEqual(await svc.list('333'), []);
	// Alice saving the very content Bob already has is still stored for Alice: the dedupe is per user.
	assert.equal((await svc.save('111', b.bytes, b.hash)).stored, true);
	// Pruning one user's old backups never touches the other's.
	for (let i = 0; i < 9; i++) { const x = snap(`a${i}`); await svc.save('111', x.bytes, x.hash); }
	assert.equal((await svc.list('222')).length, 1);
	assert.deepEqual((await svc.latest('222')).bytes, b.bytes);
});

test('refuses a bad hash, an empty body, a non-gzip body and an oversize one', async () => {
	const svc = service(fakeStorage(), { maxBytes: 100 });
	const ok = snap('x');
	await assert.rejects(svc.save('1', ok.bytes, 'nothex'), (e) => e instanceof BackupError && e.status === 400);
	await assert.rejects(svc.save('1', Buffer.alloc(0), ok.hash), (e) => e.status === 400);
	await assert.rejects(svc.save('1', Buffer.from('plain text, not gzip'), ok.hash), (e) => e.code === 'not_gzip');
	const big = svc.save('1', Buffer.concat([ok.bytes, Buffer.alloc(200)]), ok.hash);
	await assert.rejects(big, (e) => e.status === 413);
});
