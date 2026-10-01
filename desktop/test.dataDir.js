const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { dataDirIn, migrateLegacyData } = require('./dataDir');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hl-data-'));
const put = (dir, name, text) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), text); };

test('the data folder is HitList inside the app-data folder', () => {
  assert.equal(dataDirIn('/x/Application Support'), '/x/Application Support/HitList');
});

test('copies the database with its secret and account, and leaves the old folder untouched', () => {
  const root = tmp(); const legacyDir = path.join(root, 'old'); const dir = path.join(root, 'HitList');
  put(legacyDir, 'hitlist.db', 'DB'); put(legacyDir, 'hitlist.db-wal', 'WAL'); put(legacyDir, 'owner-secret.txt', 'SECRET'); put(legacyDir, 'account.json', '{"userId":"1"}');
  assert.equal(migrateLegacyData({ legacyDir, dir }), 'copied');
  for (const [n, t] of [['hitlist.db', 'DB'], ['hitlist.db-wal', 'WAL'], ['owner-secret.txt', 'SECRET'], ['account.json', '{"userId":"1"}']]) {
    assert.equal(fs.readFileSync(path.join(dir, n), 'utf8'), t);
    assert.equal(fs.readFileSync(path.join(legacyDir, n), 'utf8'), t);
  }
  assert.equal(fs.existsSync(path.join(dir, 'hitlist.db-shm')), false);
});

test('never overwrites a database that is already in the new folder', () => {
  const root = tmp(); const legacyDir = path.join(root, 'old'); const dir = path.join(root, 'HitList');
  put(legacyDir, 'hitlist.db', 'OLD'); put(dir, 'hitlist.db', 'NEW'); put(dir, 'owner-secret.txt', 'MINE');
  assert.equal(migrateLegacyData({ legacyDir, dir }), 'already-there');
  assert.equal(fs.readFileSync(path.join(dir, 'hitlist.db'), 'utf8'), 'NEW');
  assert.equal(fs.readFileSync(path.join(dir, 'owner-secret.txt'), 'utf8'), 'MINE');
});

test('does nothing when there is nothing to copy, and is safe to repeat', () => {
  const root = tmp();
  assert.equal(migrateLegacyData({ legacyDir: path.join(root, 'none'), dir: path.join(root, 'HitList') }), 'nothing-to-copy');
  const legacyDir = path.join(root, 'old'); const dir = path.join(root, 'HitList');
  put(legacyDir, 'hitlist.db', 'DB');
  assert.equal(migrateLegacyData({ legacyDir, dir }), 'copied');
  assert.equal(migrateLegacyData({ legacyDir, dir }), 'already-there');
});
