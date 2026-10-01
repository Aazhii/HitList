const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// auth.js requires electron for its window code; the pure parts are tested with a stub in its place.
require.cache[require.resolve('electron')] = { exports: { BrowserWindow: class {}, session: { fromPartition: () => ({}) } }, loaded: true, id: 'electron', filename: 'electron' };
const { createAuth, ownerFor, isSignedInUrl } = require('./auth');
const { HOST } = require('./catalyst-config');

test('the owner id matches the one the server derives (43 url-safe characters)', () => {
  const id = ownerFor('75733000000033001');
  assert.match(id, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(ownerFor('75733000000033001'), id);
  assert.notEqual(ownerFor('75733000000033002'), id);
});

test('sign-in is finished only when Catalyst lands the window on /app/ of our own host', () => {
  assert.equal(isSignedInUrl(`https://${HOST}/app/`), true);
  assert.equal(isSignedInUrl(`https://${HOST}/app`), true);
  assert.equal(isSignedInUrl(`https://${HOST}/__catalyst/auth/login`), false);
  assert.equal(isSignedInUrl('https://evil.example/app/'), false);
  assert.equal(isSignedInUrl(`http://${HOST}/app/`), false);
  assert.equal(isSignedInUrl('not a url'), false);
});

test('the account is remembered on disk, refused if damaged, and forgotten on sign-out', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-auth-'));
  const cleared = [];
  const auth = createAuth({ userDataDir: dir, getSession: () => ({ clearStorageData: async () => { cleared.push(1); } }) });
  assert.equal(auth.cachedAccount(), null);
  fs.writeFileSync(path.join(dir, 'account.json'), JSON.stringify({ userId: '75733000000033001', email: 'a@b.c' }));
  assert.deepEqual(auth.cachedAccount(), { userId: '75733000000033001', email: 'a@b.c' });
  fs.writeFileSync(path.join(dir, 'account.json'), JSON.stringify({ userId: 'not-a-number' }));
  assert.equal(auth.cachedAccount(), null);
  fs.writeFileSync(path.join(dir, 'account.json'), '{ broken');
  assert.equal(auth.cachedAccount(), null);
  fs.writeFileSync(path.join(dir, 'account.json'), JSON.stringify({ userId: '75733000000033001' }));
  await auth.signOut();
  assert.equal(auth.cachedAccount(), null);
  assert.equal(cleared.length, 1);
});

test('whoami answers null for a signed-out session and throws when it cannot be reached', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-auth-'));
  const reply = (status, body) => ({ fetch: async () => ({ status, ok: status < 300, json: async () => body }) });
  assert.equal(await createAuth({ userDataDir: dir, getSession: () => reply(401, {}) }).whoami(), null);
  assert.deepEqual(await createAuth({ userDataDir: dir, getSession: () => reply(200, { userId: '75733000000033001', email: 'x@y.z' }) }).whoami(), { userId: '75733000000033001', email: 'x@y.z' });
  await assert.rejects(createAuth({ userDataDir: dir, getSession: () => reply(502, {}) }).whoami());
});
