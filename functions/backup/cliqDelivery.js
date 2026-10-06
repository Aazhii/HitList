'use strict';

const { createHash, createHmac } = require('node:crypto');
const { postToBot } = require('./cliq');

const channelFor = (link) => `hitlist:inbox:${createHash('sha256').update(link.linkId).digest('hex')}`;
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

function createCliqDelivery({ config = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
	const match = /^([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+):([^:\s]+)$/.exec(config.ABLY_API_KEY || '');
	const sign = (channel, capability) => {
		if (!match) return null;
		const issued = Math.floor(now() / 1000);
		const content = `${encode({ typ: 'JWT', alg: 'HS256', kid: match[1] })}.${encode({ iat: issued, exp: issued + 3600, 'x-ably-capability': JSON.stringify({ [channel]: [capability] }) })}`;
		return `${content}.${createHmac('sha256', match[2]).update(content).digest('base64url')}`;
	};
	return {
		issueToken: match ? async (link) => {
			const channel = channelFor(link);
			return { token: sign(channel, 'subscribe'), channel, accountId: link.accountId, deviceId: link.deviceId, generation: link.generation };
		} : undefined,
		publish: async (link, command) => {
			if (!match) return false;
			const channel = channelFor(link);
			try {
				const response = await fetchImpl(`https://rest.ably.io/channels/${encodeURIComponent(channel)}/messages`, {
					method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
					headers: { Authorization: `Bearer ${sign(channel, 'publish')}`, 'Content-Type': 'application/json' },
					body: JSON.stringify({ id: command.commandId, name: 'inbox-changed', data: {} }),
				});
				return response.ok;
			} catch { return false; }
		},
		reply: async (link, commandId, result) => {
			const tasks = result.tasks || (result.task ? [result.task] : []);
			const lines = tasks.slice(0, 10).map((task) => `${task.title.replace(/\s+/g, ' ').slice(0, 120)}\nID: ${task.taskId}\nVersion: ${task.updatedAt}`);
			const text = [`HitList ${result.status}: ${commandId}`, ...lines, ...(result.hasMore ? ['More tasks available on the next page.'] : [])].join('\n');
			const response = await postToBot({ fetch: fetchImpl, bot: config.CLIQ_BOT, token: config.CLIQ_TOKEN, dc: config.CLIQ_DC || 'in', email: link.email, text });
			return response.ok;
		},
	};
}

module.exports = { createCliqDelivery, channelFor };