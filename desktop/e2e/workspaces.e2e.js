'use strict';
/**
 * End-to-end check of shared workspaces without Catalyst: two real local servers (A and B), the real sync engine on each, and the
 * real cloud service logic over an in-memory store. Run by hand: build the jar first (mvn -f api/pom.xml package), then
 *   node desktop/e2e/workspaces.e2e.js
 * Takes about 45 seconds because the engine deliberately waits 3-5 seconds before sending a batch.
 */
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const R = path.resolve(__dirname, '..', '..');
const { createWorkspaceSync } = require(`${R}/desktop/workspaceSync.js`);
const { createWorkspaceService, WorkspaceError } = require(`${R}/functions/backup/workspaces.js`);

const TOKEN = 'e2e-desktop-launch-secret-0123456789abcdef';
const owner = (id) => crypto.createHash('sha256').update(`catalyst:${id}`).digest('base64url');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the cloud: the real service over an in-memory store ──────────────────────────────────────────────────────────────
function memoryStore() {
  const workspaces = new Map(); const members = new Map(); const invites = new Map(); const changes = [];
  return {
    async createWorkspace(w) { workspaces.set(w.workspaceId, { ...w }); },
    async getWorkspace(id) { return workspaces.has(id) ? { ...workspaces.get(id) } : null; },
    async addMember(m) { const k = `${m.workspaceId}:${m.userId}`; if (members.has(k)) return false; members.set(k, { ...m }); return true; },
    async getMember(ws, u) { const m = members.get(`${ws}:${u}`); return m ? { ...m } : null; },
    async membersOf(ws) { return [...members.values()].filter((m) => m.workspaceId === ws); },
    async membershipsOf(u) { return [...members.values()].filter((m) => m.userId === u); },
    async removeMember(ws, u) { members.delete(`${ws}:${u}`); },
    async createInvite(i) { invites.set(i.tokenHash, { ...i }); },
    async getInvite(h) { return invites.has(h) ? { ...invites.get(h) } : null; },
    async setInviteStatus(h, s) { invites.get(h).status = s; },
    async lastSeq(ws) { return changes.filter((c) => c.workspaceId === ws).reduce((m, c) => Math.max(m, c.seq), 0); },
    async insertChange(c) { if (changes.some((x) => x.batchKey === c.batchKey)) return 'duplicate-batch'; if (changes.some((x) => x.workspaceId === c.workspaceId && x.seq === c.seq)) return 'duplicate-seq'; changes.push(structuredClone(c)); return 'ok'; },
    async changeByBatch(k) { return changes.find((c) => c.batchKey === k) || null; },
    async changesAfter(ws, after, limit) { return changes.filter((c) => c.workspaceId === ws && c.seq > after).sort((a, b) => a.seq - b.seq).slice(0, limit); },
    stats: () => ({ writes: changes.length }),
  };
}
const store = memoryStore();
const rings = new Set();
const service = createWorkspaceService({
  store, inviteBaseUrl: 'https://app/invite.html', allowedDomains: [],
  publish: async (id, seq) => { for (const r of rings) r(id, seq); return true; },
  sendInvite: async () => true,
  issueToken: async (ids) => ({ token: 'jwt', channels: Object.fromEntries(ids.map((id) => [id, `hitlist:ws:${'a'.repeat(64)}`])) }),
});
const people = { A: { userId: '100001', email: 'alice@example.com', name: 'Alice' }, B: { userId: '200002', email: 'bob@example.com', name: 'Bob' } };
const cloudFor = (who) => async (method, url, body) => {
  const caller = people[who]; let m;
  try {
    if (method === 'GET' && url === '/ws') return { status: 200, json: await service.listWorkspaces(caller) };
    if (method === 'POST' && url === '/ws') return { status: 200, json: await service.createWorkspace(caller, body) };
    if (method === 'POST' && url === '/ws/token') return { status: 200, json: await service.token(caller) };
    if (method === 'POST' && url === '/ws/invite/accept') return { status: 200, json: await service.acceptInvite(caller, body) };
    if ((m = /^\/ws\/(.{43})\/invite$/.exec(url))) return { status: 200, json: await service.invite(caller, m[1], body) };
    if ((m = /^\/ws\/(.{43})\/changes$/.exec(url)) && method === 'POST') return { status: 200, json: await service.pushChanges(caller, m[1], body) };
    if ((m = /^\/ws\/(.{43})\/changes\?after=(\d+)&limit=(\d+)$/.exec(url))) return { status: 200, json: await service.pullChanges(caller, m[1], { after: m[2], limit: m[3] }) };
  } catch (e) { if (e instanceof WorkspaceError) return { status: e.status, json: { error: e.code } }; throw e; }
  return { status: 404, json: {} };
};

// ── a "desktop": a real local server + the real engine ───────────────────────────────────────────────────────────────
async function desktop(who, port) {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), `e2e-${who}-`));
  const proc = spawn('java', ['-jar', `${R}/api/target/hitlist.jar`], { env: { ...process.env, STORAGE_MODE: 'sqlite', SQLITE_PATH: path.join(dir, 'hitlist.db'), SERVER_PORT: String(port), OWNER_COOKIE_SECRET: 'e2e-secret-e2e-secret-e2e-secret-12', AUTH_MODE: 'desktop', DESKTOP_TOKEN: TOKEN }, stdio: 'ignore' });
  for (let i = 0; i < 60; i += 1) { try { await new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: '/api/health' }, (r) => { r.resume(); r.statusCode === 200 ? res() : rej(); }).on('error', rej)); break; } catch { await sleep(500); } }
  const me = people[who];
  const headers = (extra = {}) => ({ 'X-Hitlist-Desktop-Token': TOKEN, 'X-Hitlist-Desktop-Owner': owner(me.userId), 'X-Hitlist-Desktop-User': me.userId, ...extra });
  const call = (method, p, body, extra) => new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { ...headers(extra), ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}) } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const raw = Buffer.concat(chunks); let json = {}; try { json = JSON.parse(raw.toString('utf8')); } catch {} resolve({ status: res.statusCode, json, raw }); });
    });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
  const events = { assigned: [], applied: 0 };
  const engine = createWorkspaceSync({
    stateDir: dir, getAccount: () => me,
    localGet: async (p, o = {}) => { const r = await call('GET', p, undefined, o.headers); if (r.status !== 200) throw new Error(`local ${r.status}`); return r.raw; },
    localPost: (p, b) => call('POST', p, b),
    cloud: cloudFor(who),
    createPush: () => ({ subscribe: async ({ onSignal }) => { const ring = (id, seq) => setTimeout(() => onSignal(id, seq), 20); rings.add(ring); return () => rings.delete(ring); } }),
    onApplied: () => { events.applied += 1; }, onAssigned: (a) => events.assigned.push(a),
    fetchTask: async () => null,
  });
  return { who, port, dir, call, engine, events, kill: () => proc.kill('SIGTERM'), inWs: (id) => ({ 'X-Hitlist-Workspace': id }) };
}

(async () => {
  const A = await desktop('A', 18101); const B = await desktop('B', 18102);
  const results = [];
  const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
  try {
    // A has personal data and starts a shared workspace from one list.
    const list = (await A.call('POST', '/api/lists', { name: 'Roadmap', clientId: 'l-mine' })).json;
    await A.call('POST', '/api/tasks', { title: 'Write spec', listId: list.id, dueDate: '2030-01-05', quadrant: 'DO' });
    await A.call('POST', '/api/lists', { name: 'Private list' });
    await A.engine.start();
    const made = await A.engine.create({ name: 'Team', listIds: [list.id] });
    check('A creates a shared workspace from one list', made.ok === true);
    const ws = made.workspace.workspaceId;
    await sleep(100); await A.engine.syncAll();
    check('the cloud got the seeded list + task as ONE batch', store.stats().writes === 1, `${store.stats().writes} write(s)`);
    check('A\'s personal workspace is untouched (2 lists)', (await A.call('GET', '/api/lists')).json.length === 2);
    check('A sees 1 list in the shared workspace', (await A.call('GET', '/api/lists', undefined, A.inWs(ws))).json.length === 1);

    // A invites B; B joins and receives the data.
    await B.engine.start();
    const inv = await A.engine.invite(ws, 'bob@example.com');
    check('A invites B by email', inv.ok === true && inv.link.includes('?t='));
    const joined = await B.engine.accept(inv.token);
    check('B accepts the invite', joined.ok === true);
    const bTasks = (await B.call('GET', '/api/tasks', undefined, B.inWs(ws))).json;
    check('B has A\'s task in the shared workspace', bTasks.length === 1 && bTasks[0].title === 'Write spec' && bTasks[0].dueDate === '2030-01-05', JSON.stringify(bTasks.map((t) => t.title)));
    check('B\'s own workspace is empty', (await B.call('GET', '/api/tasks')).json.length === 0);

    // B assigns the task to A and edits the title; A gets it by push with no polling.
    const taskId = bTasks[0].id;
    await B.call('PUT', `/api/tasks/${taskId}`, { assigneeUserId: people.A.userId, assigneeName: 'Alice', title: 'Write the spec' }, B.inWs(ws));
    B.engine.kick();
    await sleep(3500); // the engine's own 3 second delay
    const aTask = (await A.call('GET', `/api/tasks/${taskId}`, undefined, A.inWs(ws))).json;
    check('A received B\'s edit by push (title)', aTask.title === 'Write the spec', aTask.title);
    check('A received the assignment', aTask.assigneeUserId === people.A.userId && aTask.assignedBy === people.B.userId, `assignedBy=${aTask.assignedBy}`);
    check('A was notified "assigned to you"', A.events.assigned.length === 1, JSON.stringify(A.events.assigned));
    const assigned = (await A.call('GET', '/api/sync/assigned')).json;
    check('A\'s "Assigned to me" lists it with the workspace name', assigned.length === 1 && assigned[0].workspaceName === 'Team');

    // Both edit different fields at the same time; both end the same.
    await A.call('PUT', `/api/tasks/${taskId}`, { dueDate: '2030-02-01' }, A.inWs(ws));
    await B.call('PUT', `/api/tasks/${taskId}`, { quadrant: 'SCHEDULE' }, B.inWs(ws));
    A.engine.kick(); B.engine.kick();
    await sleep(7500);
    const a2 = (await A.call('GET', `/api/tasks/${taskId}`, undefined, A.inWs(ws))).json;
    const b2 = (await B.call('GET', `/api/tasks/${taskId}`, undefined, B.inWs(ws))).json;
    check('different fields edited at once both survive, on both computers', a2.dueDate === '2030-02-01' && a2.quadrant === 'SCHEDULE' && b2.dueDate === '2030-02-01' && b2.quadrant === 'SCHEDULE', `A=${a2.dueDate}/${a2.quadrant} B=${b2.dueDate}/${b2.quadrant}`);

    // Same field at once: both end identical (the later number wins).
    await A.call('PUT', `/api/tasks/${taskId}`, { title: 'From A' }, A.inWs(ws));
    await B.call('PUT', `/api/tasks/${taskId}`, { title: 'From B' }, B.inWs(ws));
    A.engine.kick(); B.engine.kick();
    await sleep(6500);
    await A.engine.syncAll(); await B.engine.syncAll(); await sleep(300);
    const a3 = (await A.call('GET', `/api/tasks/${taskId}`, undefined, A.inWs(ws))).json.title;
    const b3 = (await B.call('GET', `/api/tasks/${taskId}`, undefined, B.inWs(ws))).json.title;
    check('the same field edited at once ends identical on both', a3 === b3, `A="${a3}" B="${b3}"`);

    // Delete propagates; nothing is journaled for personal work.
    await B.call('DELETE', `/api/tasks/${taskId}`, undefined, B.inWs(ws));
    B.engine.kick(); await sleep(4000);
    check('a delete reaches the other computer', (await A.call('GET', '/api/tasks', undefined, A.inWs(ws))).json.length === 0);
    const before = store.stats().writes;
    await A.call('POST', '/api/tasks', { title: 'only mine' }); A.engine.kick(); await sleep(3500);
    check('personal work never goes to the cloud', store.stats().writes === before);
    console.log(`\nCloud change-log writes for the whole scenario: ${store.stats().writes}`);
  } catch (e) { console.log('ERROR', e && e.stack || e); results.push(false); }
  finally { A.engine.stop(); B.engine.stop(); A.kill(); B.kill(); }
  console.log(results.every(Boolean) ? '\nALL PASSED' : '\nSOME FAILED');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
