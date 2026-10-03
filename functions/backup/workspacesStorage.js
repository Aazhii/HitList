'use strict';

/**
 * Catalyst Data Store tables for shared workspaces. Create them in the Catalyst console (ids are stored as text):
 *   Workspaces  WorkspaceId (unique), Name, OwnerUserId, CreatedAt (bigint)
 *   WsMembers   MemberKey (unique, "<workspaceId>:<userId>"), WorkspaceId, UserId, Email, Name, Role, JoinedAt (bigint)
 *   WsInvites   TokenHash (unique), WorkspaceId, Email, InvitedBy, ExpiresAt (bigint), Status
 *   WsChanges   ChangeKey (unique, "<workspaceId>:<seq>"), BatchKey (unique), WorkspaceId, Seq (bigint), AuthorUserId,
 *               DeviceId, Ops (text, up to 10,000 characters), CreatedAt (bigint)
 * Uniqueness must be enforced by the database on insert: the sequence numbers and single-use invites depend on it.
 * Every value placed in a query is checked against a strict pattern first; free text (names, emails) is only ever inserted.
 */
const catalyst = require('zcatalyst-sdk-node');

const TABLES = { workspaces: 'Workspaces', members: 'WsMembers', invites: 'WsInvites', changes: 'WsChanges' };
const safe = (value, pattern) => {
	if (typeof value !== 'string' || !pattern.test(value)) throw new Error('invalid storage key');
	return value;
};
const wsKey = (v) => safe(v, /^[A-Za-z0-9_-]{43}$/);
const userKey = (v) => safe(v, /^[0-9]{5,30}$/);
const hashKey = (v) => safe(v, /^[a-f0-9]{64}$/);
const batchKey = (v) => safe(v, /^[A-Za-z0-9_-]{43}:[A-Za-z0-9_-]{1,64}:[A-Za-z0-9_-]{1,64}$/);
const seqNumber = (v) => { if (!Number.isSafeInteger(v) || v < 0) throw new Error('invalid seq'); return v; };
const changeKey = (ws, seq) => `${wsKey(ws)}:${String(seqNumber(seq)).padStart(12, '0')}`;
const duplicate = (error) => /duplicate|unique|already.exists/i.test(`${error && error.code || ''} ${error && error.message || ''}`);
const num = (v) => Number(v) || 0;

function createWorkspacesStorage(req, { tables = TABLES, app = catalyst.initialize(req, { type: 'advancedio', appName: 'backup', scope: 'admin' }) } = {}) {
	const t = { ...TABLES, ...tables };
	const select = async (table, where, extra = '', limit = 200) => {
		const raw = await app.zcql().executeZCQLQuery(`SELECT * FROM ${table} WHERE ${where} ${extra} LIMIT ${limit}`);
		return raw.map((entry) => entry[table]).filter(Boolean);
	};
	const insert = (table, row) => app.datastore().table(table).insertRow(row);

	const member = (r) => r && { workspaceId: r.WorkspaceId, userId: String(r.UserId), email: r.Email, name: r.Name, role: r.Role, joinedAt: num(r.JoinedAt), rowId: r.ROWID };
	const change = (r) => r && { seq: num(r.Seq), workspaceId: r.WorkspaceId, authorUserId: String(r.AuthorUserId), deviceId: r.DeviceId, ops: JSON.parse(r.Ops), createdAt: num(r.CreatedAt), batchKey: r.BatchKey };

	return {
		async createWorkspace(w) {
			await insert(t.workspaces, { WorkspaceId: wsKey(w.workspaceId), Name: w.name, OwnerUserId: userKey(w.ownerUserId), CreatedAt: w.createdAt });
		},
		async getWorkspace(id) {
			const r = (await select(t.workspaces, `WorkspaceId='${wsKey(id)}'`, '', 1))[0];
			return r ? { workspaceId: r.WorkspaceId, name: r.Name, ownerUserId: String(r.OwnerUserId), createdAt: num(r.CreatedAt) } : null;
		},
		async addMember(m) {
			try {
				await insert(t.members, {
					MemberKey: `${wsKey(m.workspaceId)}:${userKey(m.userId)}`, WorkspaceId: m.workspaceId, UserId: m.userId,
					Email: m.email, Name: m.name, Role: m.role === 'owner' ? 'owner' : 'member', JoinedAt: m.joinedAt,
				});
				return true;
			} catch (error) {
				if (duplicate(error)) return false;
				throw new Error('member insert failed');
			}
		},
		async getMember(ws, user) {
			return member((await select(t.members, `MemberKey='${wsKey(ws)}:${userKey(user)}'`, '', 1))[0]) || null;
		},
		async membersOf(ws) { return (await select(t.members, `WorkspaceId='${wsKey(ws)}'`, 'ORDER BY JoinedAt ASC', 100)).map(member); },
		async membershipsOf(user) { return (await select(t.members, `UserId='${userKey(user)}'`, '', 100)).map(member); },
		async removeMember(ws, user) {
			const found = await this.getMember(ws, user);
			if (found) await app.datastore().table(t.members).deleteRow(found.rowId);
		},
		async createInvite(i) {
			await insert(t.invites, {
				TokenHash: hashKey(i.tokenHash), WorkspaceId: wsKey(i.workspaceId), Email: i.email, InvitedBy: userKey(i.invitedBy),
				ExpiresAt: i.expiresAt, Status: 'pending',
			});
		},
		async getInvite(hash) {
			const r = (await select(t.invites, `TokenHash='${hashKey(hash)}'`, '', 1))[0];
			return r ? { tokenHash: r.TokenHash, workspaceId: r.WorkspaceId, email: r.Email, invitedBy: String(r.InvitedBy), expiresAt: num(r.ExpiresAt), status: r.Status, rowId: r.ROWID } : null;
		},
		async setInviteStatus(hash, status) {
			const found = await this.getInvite(hash);
			if (found) await app.datastore().table(t.invites).updateRow({ ROWID: found.rowId, Status: status });
		},
		async lastSeq(ws) {
			const r = (await select(t.changes, `WorkspaceId='${wsKey(ws)}'`, 'ORDER BY Seq DESC', 1))[0];
			return r ? num(r.Seq) : 0;
		},
		async insertChange(c) {
			try {
				await insert(t.changes, {
					ChangeKey: changeKey(c.workspaceId, c.seq), BatchKey: batchKey(c.batchKey), WorkspaceId: c.workspaceId, Seq: c.seq,
					AuthorUserId: userKey(c.authorUserId), DeviceId: c.deviceId, Ops: JSON.stringify(c.ops), CreatedAt: c.createdAt,
				});
				return 'ok';
			} catch (error) {
				if (!duplicate(error)) throw new Error('change insert failed');
				return (await this.changeByBatch(c.batchKey)) ? 'duplicate-batch' : 'duplicate-seq';
			}
		},
		async changeByBatch(key) {
			return change((await select(t.changes, `BatchKey='${batchKey(key)}'`, '', 1))[0]) || null;
		},
		async changesAfter(ws, after, limit) {
			return (await select(t.changes, `WorkspaceId='${wsKey(ws)}' AND Seq > ${seqNumber(after)}`, 'ORDER BY Seq ASC', Math.min(300, limit))).map(change);
		},
	};
}

module.exports = { createWorkspacesStorage, TABLES };
