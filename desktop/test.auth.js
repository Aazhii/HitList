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

test('private data is not sent when cloud cookies belong to another account', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-auth-'));
  const urls = [];
  const auth = createAuth({ userDataDir: dir, getSession: () => ({ fetch: async url => {
    urls.push(url);
    return { status: 200, ok: true, json: async () => ({ userId: '222222' }) };
  } }) });
  await assert.rejects(auth.fetchAs('111111', 'https://example.invalid/backup', { method: 'PUT', body: 'A private snapshot' }), { code: 'account-mismatch' });
  assert.equal(urls.length, 1);
  assert.ok(urls[0].endsWith('/whoami'));
});

test('a cancelled identity check never starts the subsequent upload', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-auth-'));
  let release;
  const urls = [];
  const controller = new AbortController();
  const auth = createAuth({ userDataDir: dir, getSession: () => ({ fetch: async url => {
    urls.push(url);
    await new Promise(resolve => { release = resolve; });
    return { status: 200, ok: true, json: async () => ({ userId: '111111' }) };
  } }) });
  const pending = auth.fetchAs('111111', 'https://example.invalid/backup', { signal: controller.signal });
  controller.abort();
  release();
  await assert.rejects(pending, { code: 'account-mismatch' });
  assert.equal(urls.length, 1);
});

test('a matching cloud session permits the account request', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-auth-'));
  const urls = [];
  const auth = createAuth({ userDataDir: dir, getSession: () => ({ fetch: async url => {
    urls.push(url);
    return { status: 200, ok: true, json: async () => ({ userId: '111111' }) };
  } }) });
  assert.equal((await auth.fetchAs('111111', 'https://example.invalid/backup')).status, 200);
  assert.equal(urls.length, 2);
});

test('the sign-in first screen offers three choices, takes only https links on our own host, and loads nothing remote', () => {
  const html = fs.readFileSync(path.join(__dirname, 'signin.html'), 'utf8');
  for (const id of ['login', 'signup', 'reset']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /Sign in/); assert.match(html, /Create an account/); assert.match(html, /Set or reset my password/);
  assert.match(html, /u\.protocol === 'https:' && u\.host === host/);
  assert.match(html, /default-src 'none'/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=|<img[^>]+src="http/);
  assert.ok(require('./catalyst-config').SIGNUP_URL.includes('/__catalyst/auth/signup'));
});
