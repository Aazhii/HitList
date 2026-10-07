'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkspaceService, cleanOps, digest } = require('./workspaces');

function memoryStore() {
	const workspaces = new Map(); const members = new Map(); const invites = new Map(); const changes = [];
	return {
		workspaces, members, invites, changes,
		async createWorkspace(w) { workspaces.set(w.workspaceId, { ...w }); },
		async getWorkspace(id) { return workspaces.has(id) ? { ...workspaces.get(id) } : null; },
		async addMember(m) { const k = `${m.workspaceId}:${m.userId}`; if (members.has(k)) return false; members.set(k, { ...m }); return true; },
		async getMember(ws, user) { const m = members.get(`${ws}:${user}`); return m ? { ...m } : null; },
		async membersOf(ws) { return [...members.values()].filter((m) => m.workspaceId === ws); },
		async membershipsOf(user) { return [...members.values()].filter((m) => m.userId === user); },
		async removeMember(ws, user) { members.delete(`${ws}:${user}`); },
		async createInvite(i) { invites.set(i.tokenHash, { ...i }); },
		async getInvite(h) { return invites.has(h) ? { ...invites.get(h) } : null; },
		async setInviteStatus(h, status) { invites.get(h).status = status; },
		async lastSeq(ws) { return changes.filter((c) => c.workspaceId === ws).reduce((m, c) => Math.max(m, c.seq), 0); },
		async insertChange(c) {
			if (changes.some((x) => x.batchKey === c.batchKey)) return 'duplicate-batch';
			if (changes.some((x) => x.workspaceId === c.workspaceId && x.seq === c.seq)) return 'duplicate-seq';
			changes.push(structuredClone(c)); return 'ok';
		},
		async changeByBatch(k) { return changes.find((c) => c.batchKey === k) || null; },
		async changesAfter(ws, after, limit) { return changes.filter((c) => c.workspaceId === ws && c.seq > after).sort((a, b) => a.seq - b.seq).slice(0, limit); },
	};
}

const alice = { userId: '100001', email: 'Alice@Example.com', name: 'Alice A' };
const bob = { userId: '200002', email: 'bob@example.com', name: null };
const eve = { userId: '300003', email: 'eve@example.com', name: 'Eve' };
let n = 0;
const ids = () => `${String(n++).padStart(3, '0')}${'x'.repeat(40)}`;

function setup(extra = {}) {
	const store = memoryStore(); let time = 1_800_000_000_000;
	const published = []; const mails = [];
	const svc = createWorkspaceService({
		store, now: () => time, newId: ids, inviteBaseUrl: 'https://app.example/invite.html',
		publish: async (ws, seq) => { published.push([ws, seq]); return true; },
		sendInvite: async (m) => { mails.push(m); return true; },
		issueToken: async (wsIds) => ({ token: 'jwt', channels: Object.fromEntries(wsIds.map((id) => [id, `ch:${id}`])) }),
		...extra,
	});
	return { store, svc, published, mails, advance: (ms) => { time += ms; } };
}
async function sharedWithBob(ctx) {
	const ws = await ctx.svc.createWorkspace(alice, { name: '  Team   work ' });
	const inv = await ctx.svc.invite(alice, ws.workspaceId, { email: 'BOB@example.com' });
	await ctx.svc.acceptInvite(bob, { token: inv.token });
	return { ws, inv };
}
const task = (id, fields) => ({ table: 'tasks', id, fields });

test('creating a workspace makes the caller its owner, with a clean name', async () => {
	const ctx = setup();
	const ws = await ctx.svc.createWorkspace(alice, { name: '  Team   work ' });
	assert.equal(ws.name, 'Team work');
	assert.equal(ws.role, 'owner');
	assert.match(ws.workspaceId, /^[A-Za-z0-9_-]{43}$/);
	assert.deepEqual(ws.members.map((m) => [m.email, m.role, m.name]), [['alice@example.com', 'owner', 'Alice A']]);
	assert.deepEqual((await ctx.svc.listWorkspaces(bob)).workspaces, []);
});

test('an invite emails a single-use link, stores only a hash, and only the invited email can accept', async () => {
	const ctx = setup();
	const ws = await ctx.svc.createWorkspace(alice, { name: 'Team' });
	const inv = await ctx.svc.invite(alice, ws.workspaceId, { email: 'BOB@example.com' });
	assert.equal(inv.emailed, true);
	assert.equal(inv.link, `https://app.example/invite.html?t=${inv.token}`);
	assert.equal(ctx.mails[0].to, 'bob@example.com');
	assert.equal(ctx.mails[0].inviterName, 'Alice A');
	assert.ok(ctx.store.invites.has(digest(inv.token)));
	assert.equal(JSON.stringify([...ctx.store.invites.values()]).includes(inv.token), false);

	await assert.rejects(ctx.svc.acceptInvite(eve, { token: inv.token }), { code: 'wrong_account' });
	await assert.rejects(ctx.svc.acceptInvite(bob, { token: 'nope' }), { code: 'invalid_invite' });
	const joined = await ctx.svc.acceptInvite(bob, { token: inv.token });
	assert.equal(joined.role, 'member');
	assert.deepEqual(joined.members.map((m) => [m.email, m.name]), [['alice@example.com', 'Alice A'], ['bob@example.com', 'bob']]);
	// Accepting again is harmless for the same person.
	assert.equal((await ctx.svc.acceptInvite(bob, { token: inv.token })).role, 'member');
	assert.equal(ctx.store.members.size, 2);
});

test('invites expire, only the owner invites, and a mail failure still returns the link to copy', async () => {
	const ctx = setup({ sendInvite: async () => { throw new Error('mail down'); } });
	const { ws } = await sharedWithBob(ctx);
	await assert.rejects(ctx.svc.invite(bob, ws.workspaceId, { email: 'eve@example.com' }), { code: 'owner_only' });
	await assert.rejects(ctx.svc.invite(eve, ws.workspaceId, { email: 'eve@example.com' }), { code: 'not_a_member' });
	await assert.rejects(ctx.svc.invite(alice, ws.workspaceId, { email: 'not an email' }), { code: 'invalid_email' });
	const inv = await ctx.svc.invite(alice, ws.workspaceId, { email: 'eve@example.com' });
	assert.equal(inv.emailed, false);
	ctx.advance(8 * 24 * 3600 * 1000);
	await assert.rejects(ctx.svc.acceptInvite(eve, { token: inv.token }), { code: 'invite_expired' });
});

test('an allow-list of email domains is enforced when set', async () => {
	const ctx = setup({ allowedDomains: ['example.com'] });
	const ws = await ctx.svc.createWorkspace(alice, {});
	await assert.rejects(ctx.svc.invite(alice, ws.workspaceId, { email: 'x@gmail.com' }), { code: 'email_not_allowed' });
});

test('changes get increasing numbers, the doorbell rings, and members pull them in order', async () => {
	const ctx = setup();
	const { ws } = await sharedWithBob(ctx);
	const a = await ctx.svc.pushChanges(alice, ws.workspaceId, { deviceId: 'mac-1', batchId: 'b1', ops: [task('t1', { Title: 'Write spec', Status: 'TODO' })] });
	const b = await ctx.svc.pushChanges(bob, ws.workspaceId, { deviceId: 'win-1', batchId: 'b1', ops: [task('t1', { Status: 'DONE' })] });
	assert.deepEqual([a.seq, b.seq], [1, 2]);
	assert.deepEqual(ctx.published.slice(-2), [[ws.workspaceId, 1], [ws.workspaceId, 2]]);
	const pulled = await ctx.svc.pullChanges(bob, ws.workspaceId, { after: '0' });
	assert.deepEqual(pulled.changes.map((c) => [c.seq, c.deviceId, c.authorUserId]), [[1, 'mac-1', '100001'], [2, 'win-1', '200002']]);
	assert.equal(pulled.hasMore, false);
	assert.deepEqual((await ctx.svc.pullChanges(alice, ws.workspaceId, { after: 1 })).changes.map((c) => c.seq), [2]);
	await assert.rejects(ctx.svc.pullChanges(eve, ws.workspaceId, { after: 0 }), { code: 'not_a_member' });
	await assert.rejects(ctx.svc.pushChanges(eve, ws.workspaceId, { deviceId: 'x', batchId: 'y', ops: [task('t1', { Title: 'x' })] }), { code: 'not_a_member' });
});

test('retrying the same batch returns the same number and stores nothing new', async () => {
	const ctx = setup();
	const { ws } = await sharedWithBob(ctx);
	const body = { deviceId: 'mac-1', batchId: 'retry-1', ops: [task('t1', { Title: 'once' })] };
	const first = await ctx.svc.pushChanges(alice, ws.workspaceId, body);
	const again = await ctx.svc.pushChanges(alice, ws.workspaceId, body);
	assert.equal(again.seq, first.seq);
	assert.equal(again.duplicate, true);
	assert.equal(ctx.store.changes.length, 1);
});

test('a failed notification is reported and a batch retry republishes without another insert', async () => {
	let delivered = false;
	let attempts = 0;
	const ctx = setup({ publish: async () => { attempts += 1; return delivered; } });
	const ws = await ctx.svc.createWorkspace(alice, { name: 'Team' });
	const body = { deviceId: 'mac-1', batchId: 'retry-signal', ops: [task('t1', { Title: 'once' })] };
	assert.equal((await ctx.svc.pushChanges(alice, ws.workspaceId, body)).signalDelivered, false);
	delivered = true;
	const retry = await ctx.svc.pushChanges(alice, ws.workspaceId, body);
	assert.equal(retry.signalDelivered, true);
	assert.equal(retry.duplicate, true);
	assert.equal(attempts, 2);
	assert.equal(ctx.store.changes.length, 1);
});

test('two writers racing for the same number both end up stored, one after the other', async () => {
	const ctx = setup();
	const { ws } = await sharedWithBob(ctx);
	const realLast = ctx.store.lastSeq;
	let stale = true;
	// The first read of the last number is stale, as if another member had just written.
	ctx.store.lastSeq = async (id) => { if (stale) { stale = false; await ctx.store.insertChange({ workspaceId: id, seq: 1, batchKey: 'other', authorUserId: '200002', deviceId: 'win-1', ops: [], createdAt: 0 }); return 0; } return realLast(id); };
	const out = await ctx.svc.pushChanges(alice, ws.workspaceId, { deviceId: 'mac-1', batchId: 'race', ops: [task('t1', { Title: 'x' })] });
	assert.equal(out.seq, 2);
});

test('pulling is paged', async () => {
	const ctx = setup();
	const { ws } = await sharedWithBob(ctx);
	for (let i = 0; i < 5; i += 1) await ctx.svc.pushChanges(alice, ws.workspaceId, { deviceId: 'mac-1', batchId: `b${i}`, ops: [task('t1', { TaskOrder: i })] });
	const page = await ctx.svc.pullChanges(bob, ws.workspaceId, { after: 0, limit: 2 });
	assert.deepEqual(page.changes.map((c) => c.seq), [1, 2]);
	assert.equal(page.hasMore, true);
	await assert.rejects(ctx.svc.pullChanges(bob, ws.workspaceId, { after: -1 }), { code: 'invalid_cursor' });
});

test('change batches are checked: known tables and fields, plain values, bounded size', () => {
	assert.throws(() => cleanOps([]), { code: 'invalid_ops' });
	assert.throws(() => cleanOps([{ table: 'unknown', id: 'n1', fields: { Title: 'x' } }]), { code: 'invalid_ops' });
	assert.throws(() => cleanOps([task('t1', { OwnerId: 'steal' })]), { code: 'invalid_field' });
	assert.throws(() => cleanOps([task('t1', { Title: { nested: true } })]), { code: 'invalid_field' });
	assert.throws(() => cleanOps([task('bad id!', { Title: 'x' })]), { code: 'invalid_ops' });
	assert.throws(() => cleanOps([task('t1', { Note: 'x'.repeat(5000) }), task('t2', { Note: 'x'.repeat(5000) })]), { code: 'ops_too_large' });
	assert.deepEqual(cleanOps([{ table: 'lists', id: 'l1', deleted: true, fields: { Name: 'ignored' } }]), [{ table: 'lists', id: 'l1', deleted: true }]);
	assert.deepEqual(cleanOps([task('t1', { AssigneeUserId: '200002', AssigneeName: 'Bob', DueDate: null })])[0].fields, { AssigneeUserId: '200002', AssigneeName: 'Bob', DueDate: null });
});

const sourceOps = () => [
	{ table: 'notes', id: 'note-1', fields: { Title: 'Bug report', BlocksJson: '[]', Emoji: '', Pinned: false, CreatedAt: 1, UpdatedAt: 2 } },
	{ table: 'databases', id: 'db-1', fields: { Name: 'Bugs', Icon: '', DateFieldId: 'field-1', TitleLabel: 'Issue', DbOrder: 0, CreatedAt: 1, UpdatedAt: 2 } },
	{ table: 'records', id: 'record-1', fields: { DatabaseId: 'db-1', Title: 'Reproduce', RowOrder: 0, CreatedAt: 1, UpdatedAt: 2 } },
	{ table: 'fields', id: 'field-1', fields: { DatabaseId: 'db-1', Name: 'Details', FieldKind: 'text', OptionsJson: '[]', ShowOnCard: true, DefOrder: 0, CreatedAt: 1, UpdatedAt: 2 } },
	{ table: 'values', id: 'value-1', fields: { TaskId: 'record-1', DefId: 'field-1', ValueText: 'Check the source', EncodedKind: 'text', UpdatedAt: 2 } },
	{ table: 'fragments', id: 'fragment-1', fields: { Table: 'notes', EntityId: 'note-1', Field: 'BlocksJson', Version: 'version-1', Part: 0, Parts: 2, Value: '[{"id":"block-1",' } },
	task('task-1', { Title: 'Fix source', SourceNoteId: 'note-1', SourceBlockId: 'block-1', SourceRecordId: 'record-1', SourceFieldId: 'field-1' }),
];

test('members ship known source tables, fields, values and fragments unchanged; nonmembers cannot read or write them', async () => {
	const ctx = setup();
	const { ws } = await sharedWithBob(ctx);
	const ops = sourceOps();
	assert.deepEqual(cleanOps(ops), ops);
	const body = { deviceId: 'source-device', batchId: 'source-batch', ops };
	await ctx.svc.pushChanges(alice, ws.workspaceId, body);
	assert.deepEqual((await ctx.svc.pullChanges(bob, ws.workspaceId, { after: 0 })).changes[0].ops, ops);
	await ctx.svc.pushChanges(bob, ws.workspaceId, { ...body, batchId: 'member-edit' });
	assert.equal(ctx.store.changes.length, 2);
	for (const op of ops) {
		await assert.rejects(ctx.svc.pushChanges(eve, ws.workspaceId, { ...body, ops: [op] }), { status: 403, code: 'not_a_member' });
	}
	await assert.rejects(ctx.svc.pullChanges(eve, ws.workspaceId, { after: 0 }), { status: 403, code: 'not_a_member' });
	await ctx.svc.removeMember(alice, ws.workspaceId, bob.userId);
	await assert.rejects(ctx.svc.pushChanges(bob, ws.workspaceId, body), { status: 403, code: 'not_a_member' });
	await assert.rejects(ctx.svc.pullChanges(bob, ws.workspaceId, { after: 0 }), { status: 403, code: 'not_a_member' });
	assert.equal(ctx.store.changes.length, 2, 'denied writes never reach storage');
});

test('source operations reject private owner fields directly and through fragments', async () => {
	const ctx = setup();
	const { ws } = await sharedWithBob(ctx);
	for (const op of sourceOps()) {
		for (const key of ['OwnerId', 'owner_id', 'ROWID', 'LocalOwners', 'SourceKey']) {
			const privateOp = { ...op, fields: { ...op.fields, [key]: 'private-owner' } };
			assert.throws(() => cleanOps([privateOp]), { status: 400, code: 'invalid_field' });
			await assert.rejects(ctx.svc.pushChanges(bob, ws.workspaceId, { deviceId: 'member', batchId: 'private-field', ops: [privateOp] }), { status: 400, code: 'invalid_field' });
		}
	}
	const fragment = sourceOps().find((op) => op.table === 'fragments');
	for (const table of ['notes', 'databases', 'records', 'fields', 'values', 'tasks']) {
		assert.throws(() => cleanOps([{ ...fragment, fields: { ...fragment.fields, Table: table, Field: 'OwnerId' } }]), { status: 400, code: 'invalid_fragment' });
	}
	assert.equal(ctx.store.changes.length, 0);
});

test('malformed fragment envelopes are rejected before a member can store them', async () => {
	const ctx = setup();
	const { ws } = await sharedWithBob(ctx);
	const fragment = sourceOps().find((op) => op.table === 'fragments');
	const invalid = [
		{ Table: 'unknown' }, { Table: 'fragments' }, { Field: 'PrivateField' },
		{ EntityId: '' }, { EntityId: 'bad id' }, { Version: '' }, { Version: 'bad version' },
		{ Part: -1 }, { Part: 2 }, { Part: 0.5 }, { Part: '0' },
		{ Parts: 0 }, { Parts: 65 }, { Parts: 1.5 }, { Parts: '2' },
		{ Value: null }, { Value: 1 }, { Value: 'x'.repeat(4001) },
	];
	for (const patch of invalid) {
		const op = { ...fragment, fields: { ...fragment.fields, ...patch } };
		assert.throws(() => cleanOps([op]), { status: 400, code: 'invalid_fragment' }, JSON.stringify(patch));
		await assert.rejects(ctx.svc.pushChanges(bob, ws.workspaceId, { deviceId: 'member', batchId: 'malformed', ops: [op] }), { status: 400, code: 'invalid_fragment' });
	}
	for (const key of Object.keys(fragment.fields)) {
		const fields = { ...fragment.fields };
		delete fields[key];
		assert.throws(() => cleanOps([{ ...fragment, fields }]), { code: 'invalid_fragment' }, `missing ${key}`);
	}
	assert.equal(ctx.store.changes.length, 0, 'invalid fragments never enter the ordered log');
});

test('the owner removes a member, a member can leave, the owner cannot', async () => {
	const ctx = setup();
	const { ws } = await sharedWithBob(ctx);
	await assert.rejects(ctx.svc.removeMember(bob, ws.workspaceId, alice.userId), { code: 'owner_only' });
	await assert.rejects(ctx.svc.removeMember(alice, ws.workspaceId, alice.userId), { code: 'owner_cannot_leave' });
	assert.deepEqual(await ctx.svc.removeMember(bob, ws.workspaceId, bob.userId), { removed: true });
	await assert.rejects(ctx.svc.pullChanges(bob, ws.workspaceId, { after: 0 }), { code: 'not_a_member' });
	// A used invite cannot bring a removed member back.
	const inv = [...ctx.store.invites.values()][0];
	assert.equal(inv.status, 'used');
});

test('the push token covers exactly the caller\'s workspaces', async () => {
	const ctx = setup();
	const { ws } = await sharedWithBob(ctx);
	const other = await ctx.svc.createWorkspace(eve, { name: 'Eve only' });
	const tok = await ctx.svc.token(bob);
	assert.deepEqual(Object.keys(tok.channels), [ws.workspaceId]);
	assert.equal(Object.keys(tok.channels).includes(other.workspaceId), false);
	const none = setup({ issueToken: null });
	await assert.rejects(none.svc.token(alice), { code: 'push_unavailable' });
});

test('a caller without a usable account is refused everywhere', async () => {
	const ctx = setup();
	await assert.rejects(ctx.svc.createWorkspace({ userId: 'abc', email: 'a@b.co' }), { code: 'invalid_account' });
	await assert.rejects(ctx.svc.listWorkspaces({ userId: '100001', email: null }), { code: 'invalid_account' });
});

test('a task may carry the tasks it needs first, and unknown fields are still refused', () => {
	const ok = cleanOps([{ table: 'tasks', id: 't1', fields: { NeedsFirstIds: '["a","b"]' } }]);
	assert.equal(ok[0].fields.NeedsFirstIds, '["a","b"]');
	assert.equal(cleanOps([{ table: 'tasks', id: 't1', fields: { NeedsFirstIds: '' } }])[0].fields.NeedsFirstIds, '');
	assert.throws(() => cleanOps([{ table: 'tasks', id: 't1', fields: { NotAField: 'x' } }]), (e) => e.code === 'invalid_field');
});
