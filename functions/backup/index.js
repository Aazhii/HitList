'use strict';

// Backup service for the desktop app (D1.0 passed: see docs/desktop-first/00-INDEX.md). For now it only answers
// "who is calling?"; the backup routes (D2) build on `callerOf`.
const { zcAuth, UserManagement } = require('@zcatalyst/auth/node');
const { createBackupService, BackupError, MAX_BYTES } = require('./backupService');
const { createCatalystStorage } = require('./catalystStorage');
const cliq = require('./cliq');
const { createCliqRoutes } = require('./cliqRoutes');
const handleCliqRoute = createCliqRoutes();

function send(res, status, body) {
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(body));
}

/**
 * The signed-in app user behind a request, or null. Two checks, both must hold:
 *  1. The SDK accepts the request's own user token ("user scope"). An anonymous caller is refused here.
 *  2. Catalyst's gateway id for the request resolves, by an admin lookup, to an actual App User of this project.
 *     The gateway id alone proves nothing (for an anonymous caller it carries the project owner's id), and
 *     x-zc-user-type is passed through when a caller supplies it, so neither is trusted by itself.
 * The id is never read from the body or the query. (`getCurrentUser()` is not used: it answers null here even for a
 * signed-in app user.)
 */
async function callerOf(req) {
	try {
		await zcAuth.init(req, { type: 'advancedio', appName: 'backup', scope: 'user' });
	} catch {
		return null;
	}
	const id = String(req.headers['x-zc-user-id'] || '');
	if (!/^[0-9]{5,30}$/.test(id) || id === String(req.headers['x-zc-projectid'] || '')) return null;
	try {
		await zcAuth.init(req, { type: 'advancedio', appName: 'backup', scope: 'admin' });
		const user = await new UserManagement().getUserDetails(id);
		const role = user && user.role_details && user.role_details.role_name;
		return user && String(user.user_id) === id && role === 'App User' ? { userId: id, email: user.email_id || null } : null;
	} catch {
		return null;
	}
}

/** The request body as bytes, refusing anything over the size limit before it is all read. */
function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on('data', (chunk) => {
			size += chunk.length;
			if (size > MAX_BYTES) { reject(new BackupError(413, 'too_large', `A backup may be at most ${MAX_BYTES} bytes`)); req.destroy(); return; }
			chunks.push(chunk);
		});
		req.on('end', () => resolve(Buffer.concat(chunks)));
		req.on('error', reject);
	});
}

/** A small JSON body, refusing anything over `limit` bytes before it is all read. */
function readJson(req, limit = 20 * 1024) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on('data', (chunk) => {
			size += chunk.length;
			if (size > limit) { reject(new BackupError(413, 'too_large', 'That request is too large')); req.destroy(); return; }
			chunks.push(chunk);
		});
		req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new BackupError(400, 'bad_json', 'The body must be JSON')); } });
		req.on('error', reject);
	});
}

/** Sends one Cliq message to the person named in the request, if their email's domain is allowed. Settings come from the environment. */
async function notifyCliq(req, res, textFor) {
	const body = await readJson(req);
	const email = cliq.validateRecipient(body.email, cliq.parseDomains(process.env.CLIQ_ALLOWED_DOMAINS));
	if (!email) return send(res, 400, { error: 'bad_recipient', message: 'That email is not allowed. Use your work email.' });
	const text = textFor(body);
	if (!text) return send(res, 400, { error: 'nothing_to_send' });
	const result = await cliq.postToBot({ fetch, bot: process.env.CLIQ_BOT, token: process.env.CLIQ_TOKEN, dc: process.env.CLIQ_DC || 'in', email, text });
	if (result.reason === 'bot_not_configured' || result.reason === 'token_not_configured') return send(res, 503, { error: 'cliq_not_configured' });
	if (!result.ok) return send(res, 502, { error: 'cliq_failed', status: result.status });
	return send(res, 200, { sent: true });
}

module.exports = async (req, res) => {
	const path = (req.url || '/').split('?')[0];
	if (path === '/health') return send(res, 200, { ok: true });
	const caller = await callerOf(req);
	if (!caller) return send(res, 401, { error: 'unauthenticated' });
	if (path === '/whoami') return send(res, 200, caller);

	try {
		if (await handleCliqRoute(req, res, caller, path)) return;
		if (path === '/notify/overdue' && req.method === 'POST') {
			return await notifyCliq(req, res, (body) => {
				const tasks = cliq.cleanTasks(body.tasks);
				return tasks && tasks.length ? cliq.buildOverdueMessage(tasks, Number(body.total) || tasks.length) : '';
			});
		}
		if (path === '/notify/test' && req.method === 'POST') return await notifyCliq(req, res, () => cliq.TEST_MESSAGE);
		const backups = createBackupService(await createCatalystStorage(req));
		if (path === '/backup' && (req.method === 'PUT' || req.method === 'POST')) {
			const { stored, entry } = await backups.save(caller.userId, await readBody(req), String(req.headers['x-content-hash'] || ''));
			return send(res, stored ? 201 : 200, { stored, at: entry.at, hash: entry.hash, size: entry.size });
		}
		if (path === '/backup/list' && req.method === 'GET') return send(res, 200, await backups.list(caller.userId));
		if (path === '/backup/latest' && req.method === 'GET') {
			const found = await backups.latest(caller.userId);
			if (!found) return send(res, 404, { error: 'no_backup' });
			res.writeHead(200, { 'Content-Type': 'application/gzip', 'X-Backup-At': String(found.entry.at), 'X-Content-Hash': found.entry.hash });
			return res.end(found.bytes);
		}
		return send(res, 404, { error: 'not_found' });
	} catch (error) {
		if (error instanceof BackupError) return send(res, error.status, { error: error.code, message: error.message, ...error.extra });
		console.error('backup failed:', error && error.message);
		return send(res, 500, { error: 'server_error' });
	}
};
