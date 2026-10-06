'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('./index');

test('packaged webhook entry fails closed before configuration', async () => {
  let status;
  let body;
  const response = { writeHead: (value) => { status = value; }, end: (value) => { body = JSON.parse(value); } };
  await handler({ method: 'POST', headers: {} }, response, { config: {} });
  assert.equal(status, 503);
  assert.deepEqual(body, { error: 'cliq_inbound_unavailable' });
});