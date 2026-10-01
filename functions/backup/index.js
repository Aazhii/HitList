'use strict';

// Backup service for the desktop app. D1.0 spike: this first version only answers "who is calling?", to prove the
// desktop can authenticate to a Catalyst Function. The backup routes (D2) are added once that is proved.
const { zcAuth, UserManagement } = require('@zcatalyst/auth/node');

function send(res, status, body) {
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(body));
}

/** The signed-in Catalyst user from the request, or null. The id is never taken from the body or the query. */
async function currentUser(req) {
	try {
		await zcAuth.init(req);
		const user = await new UserManagement().getCurrentUser();
		return user && user.user_id ? { user } : { reason: 'no user in the answer' };
	} catch (error) {
		// The reason is for the spike only; it carries no token or cookie.
		return { reason: String((error && (error.message || error.code)) || error).slice(0, 300) };
	}
}

module.exports = async (req, res) => {
	const path = (req.url || '/').split('?')[0];
	if (path === '/health') return send(res, 200, { ok: true });
	const found = await currentUser(req);
	if (!found.user) return send(res, 401, { error: 'unauthenticated', reason: found.reason });
	const user = found.user;
	if (path === '/whoami') return send(res, 200, { userId: String(user.user_id), email: user.email_id || null });
	return send(res, 404, { error: 'not_found' });
};
