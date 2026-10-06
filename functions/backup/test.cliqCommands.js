'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCommand } = require('./cliqCommands');

test('parses the supported grammar without allowing arbitrary task fields', () => {
	assert.deepEqual(parseCommand('add "Ship report" --due 2026-10-02 --time 09:30'), { type: 'create', payload: { title: 'Ship report', dueDate: '2026-10-02', dueTime: '09:30' } });
	assert.deepEqual(parseCommand('add "Ship report"'), { type: 'create', payload: { title: 'Ship report' } });
	assert.deepEqual(parseCommand('add "Ship report" --due 2026-10-02'), { type: 'create', payload: { title: 'Ship report', dueDate: '2026-10-02' } });
	assert.deepEqual(parseCommand('list'), { type: 'list', payload: { filter: 'open', page: 1 } });
	assert.deepEqual(parseCommand('list overdue --page 2'), { type: 'list', payload: { filter: 'overdue', page: 2 } });
	assert.deepEqual(parseCommand('done abc-2 --version 2026-10-02T12:00:00.000Z'), { type: 'complete', payload: { taskId: 'abc-2', expectedUpdatedAt: '2026-10-02T12:00:00.000Z' } });
	assert.deepEqual(parseCommand('edit abc "New title" --version 2026-10-02T12:00:00Z'), { type: 'edit', payload: { taskId: 'abc', title: 'New title', expectedUpdatedAt: '2026-10-02T12:00:00Z' } });
	assert.deepEqual(parseCommand('link ' + 'a'.repeat(32)), { type: 'link', payload: { code: 'a'.repeat(32) } });
	assert.deepEqual(parseCommand('status ' + 'a'.repeat(64)), { type: 'status', payload: { commandId: 'a'.repeat(64) } });
});

test('rejects malformed, oversized, and extra-field commands', () => {
	for (const text of ['add "x" --due 2026-02-30 --time 12:00', 'add "x" --due 2026-10-02 --time 25:00', 'add "x" --time 12:00', 'list open --page 0', 'done id', 'edit id "x" --version tomorrow', 'add "x" --due 2026-10-02 --time 12:00 --priority high', 'help now', 'x'.repeat(2001)]) assert.equal(parseCommand(text), null, text);
});