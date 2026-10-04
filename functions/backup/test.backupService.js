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
	const stats = { deleteCalls: 0, listCalls: 0 };
	return {
		rows,
		stats,
		blobs,
		index: {
			latest: async (u) => rows.filter((r) => r.userId === u).sort((a, b) => b.at - a.at)[0] || null,
			list: async (u) => { stats.listCalls++; return rows.filter((r) => r.userId === u).sort((a, b) => b.at - a.at); },
			add: async (e) => { const row = { ...e, rowId: ++n }; rows.push(row); return row; },
			removeMany: async (u, es) => { stats.deleteCalls++; for (const e of es) { const i = rows.findIndex((r) => r.userId === u && r.rowId === e.rowId); if (i >= 0) rows.splice(i, 1); } },
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
// Most tests are not about the daily cap, so they get a generous one; the cap has its own test below.
const service = (s, extra = {}) => createBackupService({ ...s, now: () => (clock += 10), maxPerDay: 1000, ...extra });

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

test('prunes to the newest seven in one batch once there are fourteen, and deletes the files with them', async () => {
	const s = fakeStorage(); let time = 0;
	const svc = service(s, { now: () => (time += 24 * 60 * 60 * 1000) });
	for (let i = 0; i < 13; i++) { const x = snap(`v${i}`); await svc.save('111', x.bytes, x.hash); }
	assert.equal((await svc.list('111')).length, 13);
	assert.equal(s.stats.deleteCalls, 0);
	const x = snap('v13'); await svc.save('111', x.bytes, x.hash);
	const list = await svc.list('111');
	assert.equal(list.length, 7);
	assert.equal(s.blobs.size, 7);
	assert.equal(s.stats.deleteCalls, 1);
	assert.ok(list[0].at > list[6].at);
	assert.equal(list[0].hash, x.hash);
});

test('one backup costs one index query, and nothing more when the content is unchanged', async () => {
	const s = fakeStorage(); const svc = service(s);
	const a = snap('only');
	await svc.save('111', a.bytes, a.hash);
	assert.equal(s.stats.listCalls, 1);
	await svc.save('111', a.bytes, a.hash);
	assert.equal(s.stats.listCalls, 2);
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
	for (let i = 0; i < 20; i++) { const x = snap(`a${i}`); await svc.save('111', x.bytes, x.hash); }
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

test('allows ten stored backups per person per rolling day, and says when the eleventh is allowed', async () => {
	const s = fakeStorage(); let t = 10_000_000;
	const svc = createBackupService({ ...s, now: () => t });
	const day = 24 * 60 * 60 * 1000;
	const stamps = [];
	for (let i = 0; i < 10; i++) { t += 1000; stamps.push(t); const x = snap(`d${i}`); assert.equal((await svc.save('111', x.bytes, x.hash)).stored, true); }
	t += 1000;
	const eleventh = snap('d10');
	await assert.rejects(svc.save('111', eleventh.bytes, eleventh.hash), (e) => e.status === 429 && e.code === 'daily_limit' && e.extra.retryAt === stamps[0] + day);
	assert.equal((await svc.list('111')).length, 10);
	// Unchanged content is still not a new backup, and is not refused.
	const same = snap('d9');
	assert.equal((await svc.save('111', same.bytes, same.hash)).stored, false);
	// Someone else is unaffected.
	assert.equal((await svc.save('222', eleventh.bytes, eleventh.hash)).stored, true);
	// A day after the oldest, the next is allowed.
	t = stamps[0] + day;
	assert.equal((await svc.save('111', eleventh.bytes, eleventh.hash)).stored, true);
});

test('pruning preserves recent entries so it cannot reset the ten-backup allowance', async () => {
	const storage = fakeStorage(); let time = 1000;
	const day = 24 * 60 * 60 * 1000;
	const svc = createBackupService({ ...storage, now: () => time });
	for (let index = 0; index < 4; index++) {
		const snapshot = snap(`old-${index}`);
		await svc.save('111', snapshot.bytes, snapshot.hash);
		time += 1000;
	}
	time += day;
	const oldestRecent = time;
	for (let index = 0; index < 10; index++) {
		const snapshot = snap(`recent-${index}`);
		assert.equal((await svc.save('111', snapshot.bytes, snapshot.hash)).stored, true);
		time += 1000;
	}
	assert.equal(storage.rows.length, 10);
	assert.equal(storage.blobs.size, 10);
	const extra = snap('over-limit');
	await assert.rejects(svc.save('111', extra.bytes, extra.hash),
		(error) => error.code === 'daily_limit' && error.extra.retryAt === oldestRecent + day);
});

test('automatic backups bypass a full manual allowance without consuming or resetting its slots', async () => {
	const storage = fakeStorage(); let time = 1000;
	const svc = createBackupService({ ...storage, now: () => ++time });
	for (let index = 0; index < 10; index++) {
		const snapshot = snap(`manual-${index}`);
		await svc.save('111', snapshot.bytes, snapshot.hash, 'manual');
	}
	for (const reason of ['sign-out', 'signed-in', 'scheduled', 'update']) {
		for (let index = 0; index < 12; index++) {
			const snapshot = snap(`${reason}-${index}`);
			assert.equal((await svc.save('111', snapshot.bytes, snapshot.hash, reason)).stored, true);
		}
	}
	assert.equal(storage.rows.filter((entry) => entry.reason === 'manual').length, 10);
	assert.ok(storage.rows.length <= 17);
	const extra = snap('manual-eleventh');
	await assert.rejects(svc.save('111', extra.bytes, extra.hash, 'manual'), (error) => error.code === 'daily_limit');
	assert.equal((await svc.save('222', extra.bytes, extra.hash, 'manual')).stored, true);
});

test('automatic backups before manual use consume no manual slots, and legacy entries count conservatively', async () => {
	const storage = fakeStorage(); let time = 1000;
	const svc = createBackupService({ ...storage, now: () => ++time });
	for (let index = 0; index < 12; index++) {
		const snapshot = snap(`login-${index}`);
		await svc.save('111', snapshot.bytes, snapshot.hash, 'signed-in');
	}
	for (let index = 0; index < 10; index++) {
		const snapshot = snap(`manual-${index}`);
		await svc.save('111', snapshot.bytes, snapshot.hash);
	}
	for (const entry of storage.rows) if (entry.reason === 'manual') delete entry.reason;
	const extra = snap('another');
	await assert.rejects(svc.save('111', extra.bytes, extra.hash), (error) => error.code === 'daily_limit');
	await assert.rejects(svc.save('111', extra.bytes, extra.hash, 'invented'), (error) => error.code === 'bad_reason');
});
