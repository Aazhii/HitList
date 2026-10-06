'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { smokeBackend } = require('./scripts/smoke-backend');

test('packaging refuses a missing bundled runtime rather than using system Java', async () => {
  await assert.rejects(smokeBackend({ java: '/missing-hitlist-runtime/java', jar: '/missing-hitlist-runtime/hitlist.jar' }), /Bundled Java executable missing/);
});

test('packaging refuses a missing backend jar before starting a process', async () => {
  await assert.rejects(smokeBackend({ java: process.execPath, jar: '/missing-hitlist-runtime/hitlist.jar' }), /Bundled backend jar missing/);
});