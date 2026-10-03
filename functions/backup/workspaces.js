'use strict';

/**
 * Shared workspaces: members, invites by email, and an ordered change log that every member's desktop replays.
 *
 * The desktop keeps a full copy of each shared workspace in its own SQLite and works on that copy. This service is the
 * meeting point: a member sends a batch of changes (one Data Store insert per batch), it gets the next sequence number,
 * and the other members are told "something changed" through Ably, then pull everything after the last number they
 * applied. Nothing polls. Every replica applies the same changes in the same order, so all copies end up the same.
 *
 * Pure: storage, the push, the mail and the clock are passed in, so every rule here is tested with fakes. The caller
 * ({ userId, email, name }) always comes from the verified session, never from the body.
 */
const { randomBytes, createHash } = require('node:crypto');

class WorkspaceError extends Error {
	constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const fail = (status, code) => { throw new WorkspaceError(status, code); };

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const MAX_OPS = 200;
const MAX_OPS_BYTES = 9_500;
const PULL_LIMIT = 200;
const SEQ_RETRIES = 6;

/** Fields a member may change, per table: the stored task and list fields, plus who the task is assigned to. */
const FIELDS = {
	tasks: new Set(['Title', 'Status', 'Quadrant', 'Priority', 'Note', 'DueDate', 'DueTime', 'Category', 'ListId', 'TaskOrder',
		'ReminderEnabled', 'ReminderMinutesBefore', 'Recurrence', 'CompletedAt', 'CreatedAt', 'UpdatedAt',
		'AssigneeUserId', 'AssigneeName', 'AssignedBy', 'AssignedAt']),
	lists: new Set(['Name', 'Color', 'ListOrder', 'CreatedAt', 'UpdatedAt']),
};

const digest = (value) => createHash('sha256').update(value).digest('hex');
const token32 = () => randomBytes(32).toString('base64url'); // 43 characters, the same shape as a local owner id
const validWorkspaceId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const validUserId = (value) => typeof value === 'string' && /^[0-9]{5,30}$/.test(value);
const validEntityId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const validDevice = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const validBatch = validDevice;
const normalEmail = (value) => {
	const e = String(value || '').trim().toLowerCase();
	return e.length <= 254 && /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(e) ? e : null;
};
const cleanName = (value, fallback) => {
	const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
	return text || fallback;
};
const displayName = (caller) => cleanName(caller.name, String(caller.email || '').split('@')[0] || 'Member');

/** A batch of changes, checked: known tables and fields only, plain values, bounded size. Returns the cleaned ops. */
function cleanOps(ops) {
	if (!Array.isArray(ops) || ops.length === 0 || ops.length > MAX_OPS) fail(400, 'invalid_ops');
	const out = ops.map((op) => {
		if (!op || typeof op !== 'object' || Array.isArray(op)) fail(400, 'invalid_ops');
		const fields = FIELDS[op.table];
		if (!fields || !validEntityId(op.id)) fail(400, 'invalid_ops');
		if (op.deleted === true) return { table: op.table, id: op.id, deleted: true };
		if (!op.fields || typeof op.fields !== 'object' || Array.isArray(op.fields)) fail(400, 'invalid_ops');
		const clean = {};
		for (const [key, value] of Object.entries(op.fields)) {
			if (!fields.has(key)) fail(400, 'invalid_field');
			const ok = value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
				|| (typeof value === 'string' && value.length <= 5000);
			if (!ok) fail(400, 'invalid_field');
			clean[key] = value;
		}
		if (Object.keys(clean).length === 0) fail(400, 'invalid_ops');
		return { table: op.table, id: op.id, fields: clean };
	});
	if (Buffer.byteLength(JSON.stringify(out)) > MAX_OPS_BYTES) fail(413, 'ops_too_large');
	return out;
}

/**
 * store: createWorkspace, getWorkspace, addMember -> bool, getMember, membersOf, membershipsOf, removeMember,
 *        createInvite, getInvite, setInviteStatus, lastSeq, insertChange -> 'ok'|'duplicate-seq'|'duplicate-batch',
 *        changeByBatch, changesAfter
 * publish(workspaceId, seq) -> bool   (the doorbell; failures are fine, members catch up on their next connect)
 * sendInvite({ to, workspaceName, inviterName, link }) -> bool
 * issueToken(channelsByWorkspace) -> { token } | null
 */
function createWorkspaceService({ store, publish = async () => false, sendInvite = async () => false, issueToken = null,
	inviteBaseUrl = '', allowedDomains = [], now = Date.now, newId = token32 }) {
	const callerOf = (caller) => {
		if (!caller || !validUserId(caller.userId) || !normalEmail(caller.email)) fail(403, 'invalid_account');
		return { userId: caller.userId, email: normalEmail(caller.email), name: displayName(caller) };
	};
	const memberOf = async (caller, workspaceId) => {
		if (!validWorkspaceId(workspaceId)) fail(400, 'invalid_workspace');
		const member = await store.getMember(workspaceId, caller.userId);
		if (!member) fail(403, 'not_a_member');
		return member;
	};
	const publicMember = (m) => ({ userId: m.userId, email: m.email, name: m.name, role: m.role, joinedAt: m.joinedAt });
	const view = async (workspace, role) => ({
		workspaceId: workspace.workspaceId, name: workspace.name, ownerUserId: workspace.ownerUserId, role,
		members: (await store.membersOf(workspace.workspaceId)).map(publicMember),
	});

	async function createWorkspace(rawCaller, { name } = {}) {
		const caller = callerOf(rawCaller);
		const workspace = { workspaceId: newId(), name: cleanName(name, 'Shared workspace'), ownerUserId: caller.userId, createdAt: now() };
		if (!validWorkspaceId(workspace.workspaceId)) fail(500, 'bad_id');
		await store.createWorkspace(workspace);
		await store.addMember({ workspaceId: workspace.workspaceId, userId: caller.userId, email: caller.email, name: caller.name, role: 'owner', joinedAt: now() });
		return view(workspace, 'owner');
	}

	async function listWorkspaces(rawCaller) {
		const caller = callerOf(rawCaller);
		const out = [];
		for (const m of await store.membershipsOf(caller.userId)) {
			const workspace = await store.getWorkspace(m.workspaceId);
			if (workspace) out.push(await view(workspace, m.role));
		}
		return { workspaces: out };
	}

	async function invite(rawCaller, workspaceId, { email } = {}) {
		const caller = callerOf(rawCaller);
		const me = await memberOf(caller, workspaceId);
		if (me.role !== 'owner') fail(403, 'owner_only');
		const to = normalEmail(email);
		if (!to) fail(400, 'invalid_email');
		if (allowedDomains.length && !allowedDomains.includes(to.split('@')[1])) fail(400, 'email_not_allowed');
		if (to === caller.email) fail(400, 'already_member');
		const workspace = await store.getWorkspace(workspaceId);
		if (!workspace) fail(404, 'no_workspace');
		const token = newId();
		const expiresAt = now() + SEVEN_DAYS;
		await store.createInvite({ tokenHash: digest(token), workspaceId, email: to, invitedBy: caller.userId, expiresAt, status: 'pending' });
		const link = `${inviteBaseUrl}${inviteBaseUrl.includes('?') ? '&' : '?'}t=${token}`;
		let emailed = false;
		try { emailed = await sendInvite({ to, workspaceName: workspace.name, inviterName: caller.name, link }) === true; } catch { emailed = false; }
		// The token is shown once, to the person who made it, so it can also be shared by hand. Only its hash is stored.
		return { link, token, expiresAt, emailed, email: to };
	}

	async function acceptInvite(rawCaller, { token } = {}) {
		const caller = callerOf(rawCaller);
		if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) fail(400, 'invalid_invite');
		const found = await store.getInvite(digest(token));
		if (!found || found.status === 'revoked') fail(404, 'invalid_invite');
		if (found.email !== caller.email) fail(403, 'wrong_account');
		const workspace = await store.getWorkspace(found.workspaceId);
		if (!workspace) fail(404, 'invalid_invite');
		const already = await store.getMember(found.workspaceId, caller.userId);
		if (found.status === 'used' && !already) fail(410, 'invite_used');
		if (found.status === 'pending' && found.expiresAt < now()) fail(410, 'invite_expired');
		if (!already) {
			await store.addMember({ workspaceId: found.workspaceId, userId: caller.userId, email: caller.email, name: caller.name, role: 'member', joinedAt: now() });
		}
		if (found.status === 'pending') await store.setInviteStatus(found.tokenHash, 'used');
		return view(workspace, already ? already.role : 'member');
	}

	async function removeMember(rawCaller, workspaceId, userId) {
		const caller = callerOf(rawCaller);
		const me = await memberOf(caller, workspaceId);
		if (userId === caller.userId) {
			if (me.role === 'owner') fail(400, 'owner_cannot_leave');
		} else if (me.role !== 'owner') {
			fail(403, 'owner_only');
		}
		if (!validUserId(userId)) fail(400, 'invalid_member');
		const target = await store.getMember(workspaceId, userId);
		if (!target) return { removed: false };
		if (target.role === 'owner') fail(400, 'owner_cannot_leave');
		await store.removeMember(workspaceId, userId);
		await publish(workspaceId, null);
		return { removed: true };
	}

	/** One batch of changes from one device. Retrying the same batch id returns the same seq and adds nothing. */
	async function pushChanges(rawCaller, workspaceId, { deviceId, batchId, ops } = {}) {
		const caller = callerOf(rawCaller);
		await memberOf(caller, workspaceId);
		if (!validDevice(deviceId) || !validBatch(batchId)) fail(400, 'invalid_device');
		const clean = cleanOps(ops);
		const batchKey = `${workspaceId}:${deviceId}:${batchId}`;
		const existing = await store.changeByBatch(batchKey);
		if (existing) return { seq: existing.seq, duplicate: true };
		for (let attempt = 0; attempt < SEQ_RETRIES; attempt += 1) {
			const seq = (await store.lastSeq(workspaceId)) + 1;
			const outcome = await store.insertChange({ workspaceId, seq, batchKey, authorUserId: caller.userId, deviceId, ops: clean, createdAt: now() });
			if (outcome === 'ok') {
				await publish(workspaceId, seq);
				return { seq, duplicate: false };
			}
			if (outcome === 'duplicate-batch') {
				const again = await store.changeByBatch(batchKey);
				if (again) return { seq: again.seq, duplicate: true };
			}
			// 'duplicate-seq': someone else took that number first; read the new last seq and try the next one.
		}
		fail(409, 'busy_try_again');
	}

	async function pullChanges(rawCaller, workspaceId, { after, limit } = {}) {
		const caller = callerOf(rawCaller);
		await memberOf(caller, workspaceId);
		const from = Number(after);
		if (!Number.isSafeInteger(from) || from < 0) fail(400, 'invalid_cursor');
		const size = Math.min(PULL_LIMIT, Math.max(1, Number.isSafeInteger(Number(limit)) ? Number(limit) : PULL_LIMIT));
		const rows = await store.changesAfter(workspaceId, from, size + 1);
		const changes = rows.slice(0, size).map((c) => ({ seq: c.seq, deviceId: c.deviceId, authorUserId: c.authorUserId, ops: c.ops, createdAt: c.createdAt }));
		return { changes, hasMore: rows.length > size };
	}

	/** One push token for every workspace the caller belongs to (subscribe only). */
	async function token(rawCaller) {
		const caller = callerOf(rawCaller);
		if (!issueToken) fail(503, 'push_unavailable');
		const memberships = await store.membershipsOf(caller.userId);
		const workspaceIds = memberships.map((m) => m.workspaceId);
		const issued = await issueToken(workspaceIds);
		if (!issued) fail(503, 'push_unavailable');
		return issued;
	}

	return { createWorkspace, listWorkspaces, invite, acceptInvite, removeMember, pushChanges, pullChanges, token };
}

module.exports = { createWorkspaceService, WorkspaceError, cleanOps, FIELDS, digest };
