'use strict';

const { timingSafeEqual } = require('node:crypto');
const { createCatalystCliqStorage } = require('./catalystCliqStorage');
const { createCliqInboxService, InboxError } = require('./cliqInboxService');
const { createCliqDelivery } = require('./cliqDelivery');
const { parseDomains } = require('./cliq');

const respond = (res, status, body) => {
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(body));
};
const shaped = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
	&& Object.keys(value).sort().join(',') === keys.slice().sort().join(',');

async function handleCliqWebhook(req, res, { config = process.env, createStorage = createCatalystCliqStorage, fetchImpl = globalThis.fetch } = {}) {
	if (config.CLIQ_INBOUND_ENABLED !== 'true' || !config.CLIQ_LINKS_TABLE || !config.CLIQ_RECORDS_TABLE
		|| !parseDomains(config.CLIQ_ALLOWED_DOMAINS).length || !config.CLIQ_ORG_ID
		|| typeof config.CLIQ_WEBHOOK_SECRET !== 'string' || config.CLIQ_WEBHOOK_SECRET.length < 32
		|| !config.CLIQ_BOT || !config.CLIQ_TOKEN || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+:[^:\s]+$/.test(config.ABLY_API_KEY || '')) {
		respond(res, 503, { error: 'cliq_inbound_unavailable' }); return;
	}
	if (req.method !== 'POST') { respond(res, 405, { error: 'method_not_allowed' }); return; }
	const provided = req.headers['x-hitlist-cliq-secret'];
	const expected = Buffer.from(config.CLIQ_WEBHOOK_SECRET);
	if (typeof provided !== 'string' || Buffer.byteLength(provided) !== expected.length
		|| !timingSafeEqual(Buffer.from(provided), expected)) {
		respond(res, 401, { error: 'unauthorized' }); return;
	}
	try {
		const chunks = [];
		let size = 0;
		for await (const chunk of req) {
			size += chunk.length;
			if (size > 10_000) throw new InboxError(413, 'body_too_large');
			chunks.push(chunk);
		}
		let body;
		try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
		catch { throw new InboxError(400, 'bad_json'); }
		if (!shaped(body, ['eventId', 'sender', 'text']) || !shaped(body.sender, ['id', 'orgId', 'email'])
			|| typeof body.eventId !== 'string' || typeof body.text !== 'string'
			|| body.sender.orgId !== config.CLIQ_ORG_ID) throw new InboxError(403, 'untrusted_sender');
		const store = await createStorage(req, { linksTable: config.CLIQ_LINKS_TABLE, recordsTable: config.CLIQ_RECORDS_TABLE });
		const delivery = createCliqDelivery({ config, fetchImpl });
		const service = createCliqInboxService({ store, allowedDomains: parseDomains(config.CLIQ_ALLOWED_DOMAINS), verifySender: () => true, publish: delivery.publish, reply: delivery.reply, issueToken: delivery.issueToken });
		const result = await service.acceptEvent(body);
		if (result.help) respond(res, 200, { status: 'help', text: result.help });
		else if (result.claimed) respond(res, 200, { status: 'claimed' });
		else if (Object.hasOwn(result, 'result')) respond(res, 200, { status: result.result ? result.result.status : 'queued', commandId: result.commandId, result: result.result });
		else respond(res, 202, { status: 'queued', commandId: result.commandId, pushPending: result.pushPending || false });
	} catch (error) {
		respond(res, error instanceof InboxError ? error.status : 503, { error: error instanceof InboxError ? error.code : 'cliq_inbound_unavailable' });
	}
}

module.exports = { handleCliqWebhook };