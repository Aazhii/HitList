'use strict';

// Backup service for the desktop app (D1.0 passed: see docs/desktop-first/00-INDEX.md). For now it only answers
// "who is calling?"; the backup routes (D2) build on `callerOf`.
const { zcAuth, UserManagement } = require('@zcatalyst/auth/node');
const { createBackupService, BackupError, MAX_BYTES } = require('./backupService');
const { createCatalystStorage } = require('./catalystStorage');

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

module.exports = async (req, res) => {
	const path = (req.url || '/').split('?')[0];
	if (path === '/health') return send(res, 200, { ok: true });
	const caller = await callerOf(req);
	if (!caller) return send(res, 401, { error: 'unauthenticated' });
	if (path === '/whoami') return send(res, 200, caller);

	try {
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
		if (error instanceof BackupError) return send(res, error.status, { error: error.code, message: error.message });
		console.error('backup failed:', error && error.message);
		// `detail` is for bringing storage up; remove it once the smoke test passes.
		return send(res, 500, { error: 'server_error', detail: String((error && (error.message || error.code)) || error).slice(0, 300) });
	}
};
