'use strict';

/**
 * HTTP routes for shared workspaces, under /ws. Off until WS_ENABLED=true (the tables must exist first), so a half-set-up
 * project answers 503 instead of failing in odd ways. The caller is always the verified session user (index.js callerOf).
 */
const catalyst = require('zcatalyst-sdk-node');
const { createWorkspaceService, WorkspaceError } = require('./workspaces');
const { createWorkspacesStorage } = require('./workspacesStorage');
const { createWorkspaceDelivery, createInviteMailer } = require('./workspaceDelivery');

const DEFAULT_INVITE_URL = 'https://hitlist-60090109165.development.catalystserverless.in/app/invite.html';
const WS = '([A-Za-z0-9_-]{43})';
const ROUTES = [
	['GET', /^\/ws$/, (s, c) => s.listWorkspaces(c)],
	['POST', /^\/ws$/, (s, c, b) => s.createWorkspace(c, b)],
	['POST', /^\/ws\/invite\/accept$/, (s, c, b) => s.acceptInvite(c, b)],
	['POST', /^\/ws\/token$/, (s, c) => s.token(c)],
	['POST', new RegExp(`^/ws/${WS}/invite$`), (s, c, b, id) => s.invite(c, id, b)],
	['POST', new RegExp(`^/ws/${WS}/members/remove$`), (s, c, b, id) => s.removeMember(c, id, b.userId)],
	['POST', new RegExp(`^/ws/${WS}/leave$`), (s, c, b, id) => s.removeMember(c, id, c.userId)],
	['POST', new RegExp(`^/ws/${WS}/changes$`), (s, c, b, id) => s.pushChanges(c, id, b)],
	['GET', new RegExp(`^/ws/${WS}/changes$`), (s, c, b, id) => s.pullChanges(c, id, b)],
];

function respond(res, status, body) {
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(body));
}

async function readJson(req, limit = 12_000) {
	let size = 0;
	const chunks = [];
	for await (const chunk of req) {
		size += chunk.length;
		if (size > limit) throw new WorkspaceError(413, 'body_too_large');
		chunks.push(chunk);
	}
	try {
		const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
		if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid');
		return value;
	} catch { throw new WorkspaceError(400, 'bad_json'); }
}

const domains = (list) => String(list || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

function createWorkspaceRoutes({ config = process.env, createStorage = createWorkspacesStorage, delivery, mailer, createApp } = {}) {
	const push = delivery || createWorkspaceDelivery({ config });
	return async function handleWorkspaceRoute(req, res, caller, path) {
		if (path !== '/ws' && !path.startsWith('/ws/')) return false;
		if (config.WS_ENABLED !== 'true') { respond(res, 503, { error: 'workspaces_unavailable' }); return true; }
		const route = ROUTES.find(([method, pattern]) => method === req.method && pattern.test(path));
		if (!route) { respond(res, 404, { error: 'not_found' }); return true; }
		try {
			const app = createApp ? createApp(req) : null;
			const store = await createStorage(req, app ? { app } : {});
			const service = createWorkspaceService({
				store,
				publish: push.publish,
				issueToken: push.issueToken,
				sendInvite: mailer || createInviteMailer({ app: app || (config.WS_MAIL_FROM ? catalyst.initialize(req, { type: 'advancedio', appName: 'backup', scope: 'admin' }) : null), from: config.WS_MAIL_FROM }),
				inviteBaseUrl: config.WS_INVITE_URL || DEFAULT_INVITE_URL,
				allowedDomains: domains(config.WS_ALLOWED_DOMAINS),
			});
			const id = (route[1].exec(path) || [])[1];
			const body = req.method === 'GET' ? Object.fromEntries(new URL(req.url, 'https://localhost').searchParams) : await readJson(req);
			respond(res, 200, await route[2](service, caller, body, id));
		} catch (error) {
			if (error instanceof WorkspaceError) respond(res, error.status, { error: error.code });
			else { console.error('workspaces failed:', error && error.message); respond(res, 503, { error: 'workspaces_unavailable' }); }
		}
		return true;
	};
}

module.exports = { createWorkspaceRoutes };
