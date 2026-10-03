'use strict';

function parseCommand(text) {
	if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 2000) return null;
	const input = text.trim();
	if (input === 'help') return { type: 'help', payload: {} };
	let match = /^link ([a-f0-9]{32})$/.exec(input);
	if (match) return { type: 'link', payload: { code: match[1] } };
	match = /^status ([a-f0-9]{64})$/.exec(input);
	if (match) return { type: 'status', payload: { commandId: match[1] } };
	match = /^add "([^"\r\n]{1,255})"(?: --due (\d{4}-\d{2}-\d{2})(?: --time ((?:[01]\d|2[0-3]):[0-5]\d))?)?$/.exec(input);
	if (match && (!match[2] || validDate(match[2]))) return { type: 'create', payload: { title: match[1], ...(match[2] ? { dueDate: match[2] } : {}), ...(match[3] ? { dueTime: match[3] } : {}) } };
	match = /^list(?: (open|today|overdue))?(?: --page ([1-9]\d{0,2}))?$/.exec(input);
	if (match) return { type: 'list', payload: { filter: match[1] || 'open', page: Number(match[2] || 1) } };
	match = /^done ([A-Za-z0-9_-]{1,64}) --version (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z)$/.exec(input);
	if (match && validVersion(match[2])) return { type: 'complete', payload: { taskId: match[1], expectedUpdatedAt: match[2] } };
	match = /^edit ([A-Za-z0-9_-]{1,64}) "([^"\r\n]{1,200})" --version (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z)$/.exec(input);
	if (match && validVersion(match[3])) return { type: 'edit', payload: { taskId: match[1], title: match[2], expectedUpdatedAt: match[3] } };
	return null;
}

function validDate(date) {
	const parsed = new Date(`${date}T00:00:00Z`);
	return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date;
}

function validVersion(value) {
	const parsed = new Date(value);
	return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value.replace(/(?:\.(\d{1,3}))?Z$/, (_whole, fraction = '') => `.${fraction.padEnd(3, '0')}Z`);
}

module.exports = { parseCommand };