'use strict';

/**
 * Telling a person in Zoho Cliq that tasks are overdue. Pure of Catalyst: the HTTP call is passed in, so every rule here is
 * testable with a fake. The webhook token only ever lives in the Function's environment; it is never returned or logged.
 *
 * The call is Cliq's "post a message to a bot" endpoint, no bot script needed:
 *   POST https://cliq.zoho.<dc>/api/v2/bots/<bot>/message?zapikey=<token>   { "userids": "<email>", "text": "..." }
 */
const MAX_TASKS = 20;
const MAX_TITLE = 120;
const LISTED = 10;
const POST_TIMEOUT_MS = 10_000;

const parseDomains = (list) => String(list || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/** The email in lower case if it looks like an email AND its domain is allowed; otherwise null. No allowed domains = refuse everyone. */
function validateRecipient(email, domains) {
	const e = String(email || '').trim().toLowerCase();
	if (e.length > 254 || !/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(e)) return null;
	return domains.includes(e.split('@')[1]) ? e : null;
}

/** Tasks from the request, cleaned: at most 20, a text title of at most 120 characters, and a plain due date if given. */
function cleanTasks(input) {
	if (!Array.isArray(input)) return null;
	const out = [];
	for (const t of input.slice(0, MAX_TASKS)) {
		if (!t || typeof t.title !== 'string' || !t.title.trim()) continue;
		const due = typeof t.due === 'string' && /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(t.due) ? t.due : '';
		out.push({ title: t.title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE), due });
	}
	return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-09-29" -> "Sep 29"; "2026-09-29 16:00" -> "Sep 29, 4:00 PM". */
function dueLabel(due) {
	const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/.exec(due || '');
	if (!m) return '';
	const day = `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
	if (!m[4]) return day;
	const h = Number(m[4]);
	return `${day}, ${h % 12 || 12}:${m[5]} ${h < 12 ? 'AM' : 'PM'}`;
}

/** One message for the whole batch: a heading, up to ten tasks, then "and N more". */
function buildOverdueMessage(tasks, total) {
	const count = Math.max(total || 0, tasks.length);
	const head = count === 1 ? '*1 task is overdue*' : `*${count} tasks are overdue*`;
	const lines = tasks.slice(0, LISTED).map((t) => `• ${t.title}${t.due ? ` — due ${dueLabel(t.due)}` : ''}`);
	const more = count - lines.length;
	return [head, ...lines, ...(more > 0 ? [`…and ${more} more`] : [])].join('\n');
}

const MAX_MESSAGE = 2000;

/** Text for a message an automation rule wrote: a string, tidied (no control characters, single blank lines), at most 2,000 characters. */
function cleanMessage(input) {
	if (typeof input !== 'string') return '';
	const text = input.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim();
	return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 1)}…` : text;
}

const TEST_MESSAGE = 'HitList is connected. You will get a message like this when a task becomes overdue (while HitList is open).';

/** Sends one message through the bot. Resolves { ok, status }; the token is never in what comes back. */
async function postToBot({ fetch, bot, token, dc = 'in', email, text, timeoutMs = POST_TIMEOUT_MS }) {
	if (!/^[a-z0-9_]{1,50}$/.test(String(bot || ''))) return { ok: false, status: 0, reason: 'bot_not_configured' };
	if (!token) return { ok: false, status: 0, reason: 'token_not_configured' };
	if (!/^(in|com|eu|com\.au|jp)$/.test(dc)) return { ok: false, status: 0, reason: 'bad_region' };
	const url = `https://cliq.zoho.${dc}/api/v2/bots/${bot}/message?zapikey=${encodeURIComponent(token)}`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userids: email, text }), signal: controller.signal, redirect: 'error' });
		return { ok: res.status >= 200 && res.status < 300, status: res.status };
	} catch {
		return { ok: false, status: 0, reason: controller.signal.aborted ? 'timeout' : 'unreachable' };
	} finally {
		clearTimeout(timer);
	}
}

module.exports = { parseDomains, validateRecipient, cleanTasks, cleanMessage, dueLabel, buildOverdueMessage, postToBot, TEST_MESSAGE, MAX_TASKS, MAX_MESSAGE };
