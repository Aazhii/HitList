'use strict';

const { createCliqInboxService, InboxError } = require('./cliqInboxService');
const { createCatalystCliqStorage } = require('./catalystCliqStorage');
const { parseDomains } = require('./cliq');
const { createCliqDelivery } = require('./cliqDelivery');

const routes = {
	'GET /cliq/link': (service, caller, body) => service.getLink(caller, body),
	'POST /cliq/link': (service, caller, body) => service.getLink(caller, body),
	'POST /cliq/link/start': (service, caller, body) => service.startLink(caller, body),
	'POST /cliq/link/confirm': (service, caller, body) => service.confirmLink(caller, body),
	'POST /cliq/link/unlink': (service, caller) => service.unlink(caller),
	'POST /cliq/pending': (service, caller, body) => service.fetchPending(caller, body),
	'POST /cliq/ack': (service, caller, body) => service.ack(caller, body),
	'POST /cliq/token': (service, caller, body) => service.token(caller, body),
};

function respond(res, status, body) {
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(body));
}

async function readJson(req) {
	let size = 0;
	const chunks = [];
	for await (const chunk of req) {
		size += chunk.length;
		if (size > 10_000) throw new InboxError(413, 'body_too_large');
		chunks.push(chunk);
	}
	try {
		const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
		if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid');
		return value;
	} catch { throw new InboxError(400, 'bad_json'); }
}

function createCliqRoutes({ createStorage = createCatalystCliqStorage, config = process.env, publish, reply, issueToken } = {}) {
	const delivery = createCliqDelivery({ config });
	return async function handleCliqRoute(req, res, caller, path) {
		if (path !== '/cliq' && !path.startsWith('/cliq/')) return false;
		if (config.CLIQ_INBOUND_ENABLED !== 'true' || !config.CLIQ_LINKS_TABLE || !config.CLIQ_RECORDS_TABLE || !parseDomains(config.CLIQ_ALLOWED_DOMAINS).length) {
			respond(res, 503, { error: 'cliq_inbound_unavailable' }); return true;
		}
		const action = routes[`${req.method} ${path}`];
		if (!action) { respond(res, 404, { error: 'not_found' }); return true; }
		try {
			const store = await createStorage(req, { linksTable: config.CLIQ_LINKS_TABLE, recordsTable: config.CLIQ_RECORDS_TABLE });
			const service = createCliqInboxService({ store, allowedDomains: parseDomains(config.CLIQ_ALLOWED_DOMAINS), verifySender: () => false, publish: publish || delivery.publish, reply: reply || delivery.reply, issueToken: issueToken || delivery.issueToken });
			const body = req.method === 'GET' ? { deviceId: new URL(req.url, 'https://localhost').searchParams.get('deviceId') } : await readJson(req);
			respond(res, 200, await action(service, caller, body));
		} catch (error) {
			respond(res, error instanceof InboxError ? error.status : 503, { error: error instanceof InboxError ? error.code : 'cliq_inbound_unavailable' });
		}
		return true;
	};
}

module.exports = { createCliqRoutes };