'use strict';

// Backup service for the desktop app. D1.0 spike: this version only answers "who is calling?", to prove the desktop
// can authenticate to a Catalyst Function. The backup routes (D2) are added once that is proved.
//
// Who is calling is decided ONLY by the Catalyst SDK confirming a signed-in user for the request's own token.
// The gateway's x-zc-user-id header is not used: for an anonymous caller it carries the project owner's id, so it
// proves nothing, and x-zc-user-type is passed through when a caller supplies it.
const { zcAuth, UserManagement } = require('@zcatalyst/auth/node');

function send(res, status, body) {
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(body));
}

async function currentUser(req) {
	try {
		await zcAuth.init(req, { type: 'advancedio', appName: 'backup', scope: 'user' });
		const um = new UserManagement();
		const user = await um.getCurrentUser();
		if (user && user.user_id) return { user };
		// Spike only: what Catalyst actually answered, to see why the user object is empty.
		let raw = '';
		try {
			const resp = await um.requester.send({ method: 'GET', path: '/project-user/current', service: 'baas', track: true, user: 'user' });
			raw = JSON.stringify({ status: resp.status, data: resp.data }).slice(0, 500);
		} catch (inner) { raw = 'raw call failed: ' + String(inner && inner.message).slice(0, 200); }
		// Spike only, no secrets: is the gateway's id the known app user, and can an admin lookup find that user?
		const gw = String(req.headers['x-zc-user-id'] || '');
		const diag = { gatewayIdIsKnownUser: gw === '75733000000033001', gatewayIdLength: gw.length, gatewayIdIsProject: gw === String(req.headers['x-zc-projectid'] || ''), gatewayUserType: req.headers['x-zc-user-type'], credTypeUser: req.headers['x-zc-user-cred-type'] };
		try {
			await zcAuth.init(req, { type: 'advancedio', appName: 'backup', scope: 'admin' });
			const found = await new UserManagement().getUserDetails(gw);
			diag.adminLookup = found && found.user_id ? 'found ' + (found.role_details && found.role_details.role_name) : 'empty';
		} catch (e) { diag.adminLookup = 'failed: ' + String(e && e.message).slice(0, 120); }
		return { reason: 'no user in the answer', answerKeys: Object.keys(user || {}), raw, diag };
	} catch (error) {
		return { reason: String((error && (error.message || error.code)) || error).slice(0, 300) };
	}
}

module.exports = async (req, res) => {
	const path = (req.url || '/').split('?')[0];
	if (path === '/health') return send(res, 200, { ok: true });
	const found = await currentUser(req);
	if (!found.user) return send(res, 401, { error: 'unauthenticated', reason: found.reason, answerKeys: found.answerKeys, raw: found.raw, diag: found.diag });
	if (path === '/whoami') return send(res, 200, { userId: String(found.user.user_id), email: found.user.email_id || null });
	return send(res, 404, { error: 'not_found' });
};
