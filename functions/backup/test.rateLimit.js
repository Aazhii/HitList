'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRateLimit } = require('./rateLimit');

test('each person gets a limited number of sends a minute, and the allowance returns as time passes', () => {
	let t = 1_000;
	const limit = createRateLimit({ limit: 3, windowMs: 60_000, now: () => t });
	assert.deepEqual([1, 2, 3, 4].map(() => limit.allow('alice')), [true, true, true, false]);
	assert.equal(limit.allow('bob'), true, 'another person is not affected');
	t += 61_000;
	assert.equal(limit.allow('alice'), true);
});
