'use strict';

const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { parseCommand } = require('./cliqCommands');
const { validateRecipient } = require('./cliq');

const hex = () => randomBytes(16).toString('hex');
const digest = (value) => createHash('sha256').update(value).digest('hex');
const TEN_MINUTES = 600_000;
const SEVEN_DAYS = 604_800_000;

class InboxError extends Error {
	constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const fail = (status, code) => { throw new InboxError(status, code); };
const same = (left, right) => typeof left === 'string' && typeof right === 'string' && left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const validAccount = (value) => typeof value === 'string' && /^[0-9]{5,30}$/.test(value);
const validDevice = validId;
const validZone = (value) => {
		if (typeof value !== 'string' || value.length > 80) return false;
		try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; }
	};
const publicLink = (link) => ({ accountId: link.accountId, deviceId: link.deviceId, generation: link.generation, email: link.email, timeZone: link.timeZone, linkId: link.linkId });
const commandFor = (command) => ({ id: command.commandId, accountId: command.accountId, deviceId: command.deviceId, generation: command.generation, schemaVersion: 1, type: command.type, payload: command.payload, expiresAt: command.expiresAt });
const objectWith = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key));
const validTask = (task) => objectWith(task, ['taskId', 'title', 'status', 'dueDate', 'dueTime', 'updatedAt'])
	&& ['taskId', 'title', 'status', 'dueDate', 'dueTime', 'updatedAt'].every((key) => Object.hasOwn(task, key))
	&& validId(task.taskId) && typeof task.title === 'string' && task.title.length <= 255
	&& typeof task.status === 'string' && task.status.length <= 32
	&& typeof task.updatedAt === 'string' && task.updatedAt.length <= 40
	&& ['dueDate', 'dueTime'].every((field) => task[field] == null || typeof task[field] === 'string' && task[field].length <= 32);
const validResult = (result) => objectWith(result, ['status', 'task', 'tasks', 'page', 'hasMore'])
	&& ['applied', 'failed', 'expired'].includes(result.status)
	&& (result.task === undefined || validTask(result.task))
	&& (result.tasks === undefined || Array.isArray(result.tasks) && result.tasks.length <= 10 && result.tasks.every(validTask))
	&& (result.page === undefined || Number.isInteger(result.page) && result.page >= 1 && result.page <= 1000)
	&& (result.hasMore === undefined || typeof result.hasMore === 'boolean')
	&& (result.status === 'applied' || Object.keys(result).length === 1);
const canonical = (value) => JSON.stringify(value, (_key, item) => item && !Array.isArray(item) && typeof item === 'object'
	? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) : item);

// insertUnique and createLink must be atomic DB uniqueness operations, never read-then-write.
// createLink must enforce BOTH unique UserId and unique SenderKey in the same insert.
function createCliqInboxService({ store, allowedDomains, verifySender, publish, reply, issueToken, now = Date.now }) {
	const emailOf = (email) => validateRecipient(email, allowedDomains || []);
	const accountOf = (caller) => {
		if (!caller || !validAccount(caller.userId) || !emailOf(caller.email)) fail(403, 'invalid_account');
		return emailOf(caller.email);
	};
	const keyOf = (sender) => {
		if (!sender || !validId(sender.id) || !validId(sender.orgId) || !emailOf(sender.email) || typeof verifySender !== 'function' || verifySender(sender) !== true) fail(403, 'untrusted_sender');
		return `${sender.orgId}:${sender.id}`;
	};
	const active = (link, accountId, deviceId, generation) => link && link.accountId === accountId && link.deviceId === deviceId && link.generation === generation;

	async function startLink(caller, { deviceId, timeZone } = {}) {
		const email = accountOf(caller);
		if (!validDevice(deviceId) || !validZone(timeZone)) fail(400, 'invalid_device');
		if (await store.linkByAccount(caller.userId)) fail(409, 'already_linked');
		const code = hex();
		const nonce = hex();
		const codeHash = digest(code);
		const challenge = { accountId: caller.userId, email, deviceId, timeZone, codeHash, expiresAt: now() + TEN_MINUTES };
		if (!await store.insertUnique(`challenge:${digest(code)}`, challenge)) fail(503, 'storage_conflict');
		if (!await store.insertUnique(`nonce:${digest(nonce)}`, challenge)) fail(503, 'storage_conflict');
		return { code, nonce, expiresAt: challenge.expiresAt };
	}

	async function claimLink(sender, code) {
		const senderKey = keyOf(sender);
		if (typeof code !== 'string' || !/^[a-f0-9]{32}$/.test(code)) fail(400, 'invalid_code');
		const codeHash = digest(code);
		const challenge = await store.get(`challenge:${codeHash}`);
		if (!challenge || challenge.expiresAt <= now() || !same(challenge.email, emailOf(sender.email))) fail(404, 'invalid_challenge');
		const claimKey = `claim:${codeHash}`;
		const claim = { senderKey, email: emailOf(sender.email) };
		if (!await store.insertUnique(claimKey, claim)) {
			const previous = await store.get(claimKey);
			if (!previous || previous.senderKey !== senderKey || previous.email !== claim.email) fail(409, 'already_claimed');
		}
		return { claimed: true };
	}

	async function confirmLink(caller, { nonce, deviceId } = {}) {
		const email = accountOf(caller);
		if (!/^[a-f0-9]{32}$/.test(nonce || '') || !validDevice(deviceId)) fail(400, 'invalid_confirmation');
		// The nonce is returned only to the authenticated desktop. Lookup is by its hash, never by bot input.
		const challenge = await store.get(`nonce:${digest(nonce)}`);
		if (!challenge || challenge.accountId !== caller.userId || challenge.email !== email || challenge.deviceId !== deviceId || challenge.expiresAt <= now()) fail(404, 'invalid_challenge');
		const claim = await store.get(`claim:${challenge.codeHash}`);
		if (!claim || claim.email !== email) fail(409, 'not_claimed');
		const consumedKey = `consumed:${digest(nonce)}`;
		let linkId = hex();
		let generation = now();
		if (!Number.isSafeInteger(generation) || generation <= 0) fail(503, 'invalid_clock');
		if (!await store.insertUnique(consumedKey, { linkId, accountId: caller.userId, deviceId, generation })) {
			const consumed = await store.get(consumedKey);
			if (!consumed || consumed.accountId !== caller.userId || consumed.deviceId !== deviceId) fail(409, 'already_consumed');
			linkId = consumed.linkId;
			generation = consumed.generation;
		}
		const link = { linkId, accountId: caller.userId, senderKey: claim.senderKey, email, deviceId, timeZone: challenge.timeZone, generation };
		if (!Number.isSafeInteger(link.generation) || link.generation <= 0) fail(503, 'invalid_clock');
		if (!await store.createLink(link)) {
			const existing = await store.linkByAccount(caller.userId);
			if (!existing || existing.linkId !== linkId || existing.deviceId !== deviceId || existing.senderKey !== claim.senderKey) fail(409, 'link_conflict');
			return publicLink(existing);
		}
		return publicLink(link);
	}

	async function getLink(caller, { deviceId } = {}) {
		accountOf(caller);
		if (!validDevice(deviceId)) fail(400, 'invalid_device');
		const link = await store.linkByAccount(caller.userId);
		return link && link.deviceId === deviceId ? publicLink(link) : null;
	}

	async function unlink(caller) {
		accountOf(caller);
		const link = await store.linkByAccount(caller.userId);
		if (link) await store.deleteLink(link);
		return { unlinked: true };
	}

	async function acceptEvent({ eventId, sender, text }) {
		const senderKey = keyOf(sender);
		if (typeof eventId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(eventId)) fail(400, 'invalid_event');
		const parsed = parseCommand(text);
		if (!parsed) fail(400, 'invalid_command');
		if (parsed.type === 'link') return claimLink(sender, parsed.payload.code);
		if (parsed.type === 'help') return { help: 'add "Title" [--due YYYY-MM-DD [--time HH:MM]]; list [open|today|overdue] [--page N]; done ID --version UPDATED_AT; edit ID "Title" --version UPDATED_AT; status COMMAND_ID; link CODE' };
		const link = await store.linkBySender(senderKey);
		if (!link || link.email !== emailOf(sender.email)) fail(403, 'not_linked');
		const commandId = digest(`${senderKey}:${eventId}`);
		if (parsed.type === 'status') {
			const envelope = await store.get(`command:${parsed.payload.commandId}`);
			if (!envelope || envelope.accountId !== link.accountId || envelope.linkId !== link.linkId) fail(404, 'unknown_command');
			return { commandId: parsed.payload.commandId, result: await store.get(`result:${parsed.payload.commandId}`) };
		}
		const payloadHash = digest(JSON.stringify({ senderKey, eventId, parsed }));
		const envelope = { commandId, payloadHash, type: parsed.type, payload: parsed.payload, accountId: link.accountId, deviceId: link.deviceId, generation: link.generation, linkId: link.linkId, expiresAt: now() + SEVEN_DAYS, createdAt: now() };
		let command = envelope;
		if (!await store.insertUnique(`command:${commandId}`, envelope)) {
			command = await store.get(`command:${commandId}`);
			if (!command || command.payloadHash !== payloadHash || command.linkId !== link.linkId) fail(409, 'event_conflict');
		}
		let pushPending = false;
		if (!await store.get(`result:${commandId}`)) {
			try { if (typeof publish !== 'function' || await publish(link, command) === false) pushPending = true; }
			catch { pushPending = true; }
		}
		return { commandId, queued: true, pushPending, expiresAt: command.expiresAt };
	}

	async function fetchPending(caller, { deviceId, generation, limit = 20 } = {}) {
		accountOf(caller);
		const link = await store.linkByAccount(caller.userId);
		if (!active(link, caller.userId, deviceId, generation)) fail(403, 'inactive_link');
		if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail(400, 'invalid_limit');
		const pending = [];
		while (pending.length < limit) {
			const entries = await store.listPending(caller.userId, deviceId, generation, limit - pending.length);
			if (!entries.length) break;
			for (const entry of entries) {
				if (entry.linkId !== link.linkId) {
					await store.set(`command:${entry.commandId}`, { ...entry, status: 'terminal' });
					continue;
				}
				if (await store.get(`result:${entry.commandId}`)) {
					await store.set(`command:${entry.commandId}`, { ...entry, status: 'terminal' });
					continue;
				}
				pending.push(commandFor(entry));
			}
			if (pending.length) break;
		}
		return pending;
	}

	async function ack(caller, { deviceId, generation, commandId, result } = {}) {
		accountOf(caller);
		const link = await store.linkByAccount(caller.userId);
		if (!active(link, caller.userId, deviceId, generation)) fail(403, 'inactive_link');
		if (typeof commandId !== 'string' || !/^[a-f0-9]{64}$/.test(commandId)) fail(400, 'invalid_command_id');
		const command = await store.get(`command:${commandId}`);
		if (!command || command.linkId !== link.linkId || command.accountId !== caller.userId || command.deviceId !== deviceId || command.generation !== generation) fail(404, 'unknown_command');
		if (!validResult(result)) fail(400, 'invalid_result');
		const previousResult = await store.get(`result:${commandId}`);
		if (command.expiresAt <= now() && result.status !== 'expired' && !previousResult) fail(400, 'invalid_result');
		const body = canonical(result);
		if (Buffer.byteLength(body) > 5000) fail(413, 'result_too_large');
		if (!await store.insertUnique(`result:${commandId}`, result)) {
			const previous = await store.get(`result:${commandId}`);
			if (!previous || canonical(previous) !== body) fail(409, 'result_conflict');
		}
		await store.set(`command:${commandId}`, { ...command, status: 'terminal' });
		let replyPending = false;
		if (!await store.get(`replied:${commandId}`)) {
			try {
				if (typeof reply !== 'function' || await reply(link, commandId, result) === false) replyPending = true;
				else await store.insertUnique(`replied:${commandId}`, { deliveredAt: now() });
			} catch { replyPending = true; }
		}
		return { acknowledged: true, replyPending };
	}

	async function token(caller, { deviceId, generation } = {}) {
		accountOf(caller);
		const link = await store.linkByAccount(caller.userId);
		if (!active(link, caller.userId, deviceId, generation)) fail(403, 'inactive_link');
		if (typeof issueToken !== 'function') fail(503, 'token_unavailable');
		return issueToken(link);
	}

	return { startLink, claimLink, confirmLink, getLink, unlink, acceptEvent, fetchPending, ack, token };
}

module.exports = { createCliqInboxService, InboxError };