'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { randomBytes, createHash } = require('node:crypto');
const { spawn } = require('node:child_process');

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  });
}

async function smokeBackend({ java, jar, timeout = 60_000 }) {
  assert.ok(fs.existsSync(java), 'Bundled Java executable missing');
  assert.ok(fs.existsSync(jar), 'Bundled backend jar missing');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hitlist build smoke-'));
  let child;
  try {
    const port = await availablePort();
    const token = randomBytes(32).toString('hex');
    child = spawn(java, ['-jar', jar], {
      env: { ...process.env, STORAGE_MODE: 'sqlite', SQLITE_PATH: path.join(dir, 'hitlist.db'),
        SERVER_PORT: String(port), AUTH_MODE: 'desktop', DESKTOP_TOKEN: token,
        OWNER_COOKIE_SECRET: randomBytes(32).toString('hex') },
      stdio: 'ignore', windowsHide: true,
    });
    let spawnError;
    child.once('error', (error) => { spawnError = error; });
    const origin = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + timeout;
    while (true) {
      if (spawnError) throw new Error(`Bundled Java could not start (${spawnError.code || 'spawn error'})`);
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Bundled backend exited before becoming healthy');
      let healthy = false;
      try { healthy = (await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1_000) })).ok; } catch {}
      if (healthy) break;
      if (Date.now() > deadline) throw new Error('Bundled backend health timeout');
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const index = await fetch(origin, { signal: AbortSignal.timeout(5_000) });
    assert.equal(index.status, 200, 'Frontend index missing from jar');
    const html = await index.text();
    const asset = html.match(/src="(\/assets\/[^"\s]+\.js)"/);
    assert.ok(asset, 'Built frontend JavaScript reference missing from jar');
    assert.equal((await fetch(`${origin}${asset[1]}`, { signal: AbortSignal.timeout(5_000) })).status, 200, 'Frontend JavaScript asset missing');
    const request = async (user, route, method = 'GET', body) => {
      const response = await fetch(`${origin}${route}`, {
        method, signal: AbortSignal.timeout(5_000),
        headers: { 'Content-Type': 'application/json', 'X-Hitlist-Desktop-Token': token,
          'X-Hitlist-Desktop-Owner': createHash('sha256').update(`catalyst:${user}`).digest('base64url'),
          'X-Hitlist-Desktop-User': user },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      assert.ok(response.ok, `Backend smoke request failed: ${method} ${route} (${response.status})`);
      return response.status === 204 ? null : response.json();
    };
    const list = await request('100001', '/api/lists', 'POST', { name: 'Build smoke' });
    const task = await request('100001', '/api/tasks', 'POST', { title: 'Smoke task', listId: list.id });
    assert.ok((await request('100001', '/api/tasks')).some((row) => row.id === task.id), 'Task read-back failed');
    assert.equal((await request('200002', '/api/tasks')).length, 0, 'Account B can see account A tasks');
    assert.ok((await request('100001', '/api/tasks')).some((row) => row.id === task.id), 'Account A data missing after switch');
    const alertContext = { workspaceId: null, timezone: 'UTC' };
    await request('100001', `/api/tasks/${task.id}`, 'PUT', { dueDate: '2000-01-01', dueTime: '09:00' });
    const reserved = await request('100001', '/api/overdue/reserve', 'POST', alertContext);
    assert.equal(reserved.tasks.length, 1, 'Overdue schedule was not created from a task edit');
    assert.equal(reserved.tasks[0].id, task.id);
    assert.equal(reserved.tasks[0].dueDate, '2000-01-01');
    assert.equal((await request('200002', '/api/overdue/reserve', 'POST', alertContext)).tasks.length, 0, 'Account B can see account A schedules');
    const batch = { workspaceId: null, batchId: reserved.batchId };
    const validated = await request('100001', '/api/overdue/validate', 'POST', batch);
    assert.equal(validated.tasks.length, 1);
    await request('100001', '/api/overdue/ack', 'POST', { ...batch, tasks: validated.tasks.map(({ id, occurrence }) => ({ id, occurrence })) });
    assert.equal((await request('100001', '/api/overdue/reserve', 'POST', alertContext)).tasks.length, 0, 'Acknowledged occurrence sent again');
    await request('100001', `/api/tasks/${task.id}`, 'PUT', { dueDate: '2000-01-02' });
    const changed = await request('100001', '/api/overdue/reserve', 'POST', alertContext);
    assert.equal(changed.tasks.length, 1, 'Rescheduled task did not create a new occurrence');
    await request('100001', `/api/tasks/${task.id}`, 'PUT', { dueDate: '', dueTime: '' });
    assert.equal((await request('100001', '/api/overdue/validate', 'POST', { workspaceId: null, batchId: changed.batchId })).tasks.length, 0, 'Cleared task remains eligible');
    const cleared = await request('100001', `/api/tasks/${task.id}`);
    assert.equal(cleared.dueDate ?? null, null); assert.equal(cleared.dueTime ?? null, null);
    const unauthenticated = await fetch(`${origin}/api/overdue/reserve`, { method: 'POST', signal: AbortSignal.timeout(5_000),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(alertContext) });
    assert.equal(unauthenticated.status, 401, 'Anonymous requests can reserve schedules');
    assert.ok(fs.existsSync(path.join(dir, 'hitlist.db')), 'SQLite file was not created');
    console.log('PASS bundled Java, backend, frontend assets, SQLite, account partition and overdue lifecycle smoke');
  } finally {
    if (child) await stop(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const [java, jar] = process.argv.slice(2);
  if (!java || !jar) {
    console.error('Usage: node desktop/scripts/smoke-backend.js <bundled-java> <bundled-jar>');
    process.exitCode = 1;
  } else {
    void smokeBackend({ java: path.resolve(java), jar: path.resolve(jar) }).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}

module.exports = { smokeBackend };