'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanMessage, parseDomains, validateRecipient, cleanTasks, dueLabel, buildOverdueMessage, postToBot } = require('./cliq');

test('only allowed domains are accepted, and with none allowed nobody is', () => {
	const domains = parseDomains(' ZohoCorp.com , example.org ');
	assert.deepEqual(domains, ['zohocorp.com', 'example.org']);
	assert.equal(validateRecipient('Arikaran.R@ZohoCorp.com', domains), 'arikaran.r@zohocorp.com');
	assert.equal(validateRecipient('x@gmail.com', domains), null);
	assert.equal(validateRecipient('x@sub.zohocorp.com', domains), null);
	assert.equal(validateRecipient('not an email', domains), null);
	assert.equal(validateRecipient('a@b@zohocorp.com', domains), null);
	assert.equal(validateRecipient('x@zohocorp.com,y@zohocorp.com', domains), null);
	assert.equal(validateRecipient('x@zohocorp.com', []), null);
	assert.equal(validateRecipient(undefined, domains), null);
});

test('cleans tasks: a limit of 20, trimmed text, plain dates only', () => {
	assert.equal(cleanTasks('nope'), null);
	const many = Array.from({ length: 30 }, (_, i) => ({ title: `t${i}`, due: '2026-09-29' }));
	assert.equal(cleanTasks(many).length, 20);
	const [a, b, c] = cleanTasks([{ title: '  Reply   to\nlegal ' + 'x'.repeat(200), due: '2026-09-29 16:00' }, { title: 'Bad date', due: 'yesterday' }, { title: '   ' }, 5, null]);
	assert.equal(a.title.length, 120);
	assert.match(a.title, /^Reply to legal x/);
	assert.equal(a.due, '2026-09-29 16:00');
	assert.equal(b.due, '');
	assert.equal(c, undefined);
});

test('writes dates the way people read them', () => {
	assert.equal(dueLabel('2026-09-29'), 'Sep 29');
	assert.equal(dueLabel('2026-09-29 16:05'), 'Sep 29, 4:05 PM');
	assert.equal(dueLabel('2026-10-01 00:30'), 'Oct 1, 12:30 AM');
	assert.equal(dueLabel('2026-10-01 12:00'), 'Oct 1, 12:00 PM');
	assert.equal(dueLabel('junk'), '');
});

test('the message lists up to ten tasks and says how many more', () => {
	const one = buildOverdueMessage([{ title: 'Pay rent', due: '2026-09-29' }], 1);
	assert.equal(one, '*1 task is overdue*\n• Pay rent — due Sep 29');
	const tasks = Array.from({ length: 12 }, (_, i) => ({ title: `Task ${i + 1}`, due: '' }));
	const text = buildOverdueMessage(tasks, 15);
	assert.match(text, /^\*15 tasks are overdue\*/);
	assert.equal(text.split('\n').filter((l) => l.startsWith('•')).length, 10);
	assert.match(text, /…and 5 more$/);
});

test('a task note goes under its task, and gets shorter before the message gets too long', () => {
	const one = buildOverdueMessage([{ title: 'follow up @indumathi reg table audi', due: '2026-10-06 15:00', note: "asked to @mandy this isn't not added" }], 1);
	assert.equal(one, "*1 task is overdue*\n• follow up @indumathi reg table audi — due Oct 6, 3:00 PM\n   ↳ asked to @mandy this isn't not added");
	assert.equal(buildOverdueMessage([{ title: 'No note', due: '', note: '' }], 1), '*1 task is overdue*\n• No note');
	const long = Array.from({ length: 10 }, (_, i) => ({ title: `Task ${i + 1}`, due: '', note: 'n'.repeat(300) }));
	const text = buildOverdueMessage(long, 10);
	assert.ok(text.length <= 2000, `too long: ${text.length}`);
	assert.equal(text.split('\n').filter((l) => l.startsWith('•')).length, 10);
	assert.ok(text.includes('↳'));
	assert.deepEqual(cleanTasks([{ title: 'A', note: '  two\n\nlines  ' }]), [{ title: 'A', due: '', note: 'two lines' }]);
});

const fakeFetch = (status, seen = []) => async (url, init) => { seen.push({ url, init }); return { status }; };

test('aborts a stalled bot request without exposing credentials', async () => {
	let signal;
	const result = await postToBot({
		bot: 'hitlistbot', token: 'SECRET-TOKEN', email: 'a@zohocorp.com', text: 'hi', timeoutMs: 10,
		fetch: async (_url, init) => {
			signal = init.signal;
			assert.equal(init.redirect, 'error');
			return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('SECRET-TOKEN')), { once: true }));
		},
	});
	assert.equal(signal.aborted, true);
	assert.deepEqual(result, { ok: false, status: 0, reason: 'timeout' });
	assert.doesNotMatch(JSON.stringify(result), /SECRET-TOKEN/);
});

test('posts through the bot with the right address and body, and treats 2xx as sent', async () => {
	const seen = [];
	const r = await postToBot({ fetch: fakeFetch(200, seen), bot: 'hitlistbot', token: '1001.a.b', email: 'a@zohocorp.com', text: 'hi' });
	assert.deepEqual(r, { ok: true, status: 200 });
	assert.equal(seen[0].url, 'https://cliq.zoho.in/api/v2/bots/hitlistbot/message?zapikey=1001.a.b');
	assert.deepEqual(JSON.parse(seen[0].init.body), { userids: 'a@zohocorp.com', text: 'hi' });
});

test('maps refusals and network failures without ever echoing the token', async () => {
	const base = { bot: 'hitlistbot', token: 'SECRET-TOKEN', email: 'a@zohocorp.com', text: 'hi' };
	const refused = await postToBot({ ...base, fetch: fakeFetch(401) });
	assert.deepEqual(refused, { ok: false, status: 401 });
	const down = await postToBot({ ...base, fetch: async () => { throw new Error('connect ECONNREFUSED SECRET-TOKEN'); } });
	assert.deepEqual(down, { ok: false, status: 0, reason: 'unreachable' });
	for (const out of [refused, down]) assert.doesNotMatch(JSON.stringify(out), /SECRET-TOKEN/);
	assert.equal((await postToBot({ ...base, bot: 'Bad Name!', fetch: fakeFetch(200) })).reason, 'bot_not_configured');
	assert.equal((await postToBot({ ...base, token: '', fetch: fakeFetch(200) })).reason, 'token_not_configured');
	assert.equal((await postToBot({ ...base, dc: 'evil.example/', fetch: fakeFetch(200) })).reason, 'bad_region');
});

test('an automation message is tidied and bounded before it reaches the bot', () => {
	assert.equal(cleanMessage('  hello\u0000 there  '), 'hello there');
	assert.equal(cleanMessage('a\r\n\n\n\n\nb'), 'a\n\nb');
	assert.equal(cleanMessage(42), '');
	assert.equal(cleanMessage('   '), '');
	assert.equal(cleanMessage('x'.repeat(5000)).length, 2000);
	assert.match(cleanMessage('x'.repeat(5000)), /…$/);
});
