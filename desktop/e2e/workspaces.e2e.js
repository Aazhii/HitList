'use strict';
/**
 * End-to-end check of shared workspaces without Catalyst: two real local servers (A and B), the real sync engine on each, and the
 * real cloud service logic over an in-memory store. Run by hand: build the jar first (mvn -f api/pom.xml package), then
 *   node desktop/e2e/workspaces.e2e.js
 * Takes about 45 seconds because the engine deliberately waits 3-5 seconds before sending a batch.
 */
const http = require('node:http');
const net = require('node:net');
const assert = require('node:assert/strict');
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
async function desktop(who) {
  const port = await new Promise((resolve, reject) => {
    const reservation = net.createServer();
    reservation.on('error', reject);
    reservation.listen(0, '127.0.0.1', () => {
      const selected = reservation.address().port;
      reservation.close((error) => error ? reject(error) : resolve(selected));
    });
  });
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), `e2e-${who}-`));
  const java = process.env.HITLIST_JAVA || (process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java');
  const proc = spawn(java, ['-jar', `${R}/api/target/hitlist.jar`], { env: { ...process.env, STORAGE_MODE: 'sqlite', SQLITE_PATH: path.join(dir, 'hitlist.db'), SERVER_PORT: String(port), OWNER_COOKIE_SECRET: 'e2e-secret-e2e-secret-e2e-secret-12', AUTH_MODE: 'desktop', DESKTOP_TOKEN: TOKEN }, stdio: 'ignore' });
  let launchError;
  proc.on('error', (error) => { launchError = error; });
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
  const kill = async () => {
    if (proc.pid && proc.exitCode === null && proc.signalCode === null) {
      await new Promise((resolve) => { proc.once('exit', resolve); proc.kill('SIGTERM'); });
    }
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`CLEANUP ${who}: PID ${proc.pid} exited; scratch directory removed: ${dir}`);
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (launchError) throw launchError;
      if (proc.exitCode !== null || proc.signalCode !== null) throw new Error(`${who}: scratch Java server exited during startup`);
      try { ready = (await call('GET', '/api/health')).status === 200; } catch {}
      if (ready) break;
      await sleep(500);
    }
    if (!ready) throw new Error(`${who}: scratch Java server did not become healthy`);
  } catch (error) { engine.stop(); await kill(); throw error; }
  return { who, port, dir, call, engine, events, kill, inWs: (id) => ({ 'X-Hitlist-Workspace': id }) };
}

(async () => {
  let A; let B;
  const results = [];
  const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
  const request = async (replica, method, url, body, workspaceId, expected = 200) => {
    const response = await replica.call(method, url, body, workspaceId ? replica.inWs(workspaceId) : undefined);
    assert.equal(response.status, expected, `${replica.who} ${method} ${url}: ${JSON.stringify(response.json)}`);
    return response.json;
  };
  try {
    A = await desktop('A'); B = await desktop('B');
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
    const titleChanges = (await store.changesAfter(ws, 0, 200)).flatMap((change) => change.ops)
      .filter((op) => op.table === 'tasks' && op.id === taskId && typeof op.fields?.Title === 'string');
    const expectedTitle = titleChanges.at(-1).fields.Title;
    check('the same field edited at once matches the later cloud sequence on both', a3 === expectedTitle && b3 === expectedTitle,
      `A="${a3}" B="${b3}" expected="${expectedTitle}"`);

    // Delete propagates; nothing is journaled for personal work.
    await B.call('DELETE', `/api/tasks/${taskId}`, undefined, B.inWs(ws));
    B.engine.kick(); await sleep(4000);
    check('a delete reaches the other computer', (await A.call('GET', '/api/tasks', undefined, A.inWs(ws))).json.length === 0);
    const before = store.stats().writes;
    await A.call('POST', '/api/tasks', { title: 'only mine' }); A.engine.kick(); await sleep(3500);
    check('personal work never goes to the cloud', store.stats().writes === before);

    await A.engine.refresh();
    const sharedList = (await request(A, 'GET', '/api/lists', undefined, ws))[0].id;
    const blocks = [
      { id: 'source-todo', type: 'todo', content: 'Fix the reported bug', checked: false },
      { id: 'source-body', type: 'paragraph', content: '\\"\n'.repeat(1200) },
    ];
    blocks[1].content += 'x'.repeat(9900 - JSON.stringify(blocks).length);
    const blocksJson = JSON.stringify(blocks);
    assert.equal(blocksJson.length, 9900);
    await request(A, 'POST', '/api/notes', { id: 'personal-source-note', title: 'Bug source', blocksJson, emoji: '', pinned: true }, undefined, 201);
    await request(A, 'POST', '/api/notes', { id: 'private-note', title: 'Private sentinel', blocksJson: '[]', emoji: '' }, undefined, 201);
    check('valid near-limit personal note stays out of the shared journal', (await request(A, 'GET', `/api/sync/outbox?workspaceId=${ws}`)).ops.length === 0);
    const noteInput = { workspaceId: ws, clientId: 'note-assignment', title: 'Fix the reported bug', listId: sharedList,
      sourceNoteId: 'personal-source-note', sourceBlockId: 'source-todo', assigneeUserId: people.B.userId, assignedBy: 'forged' };
    const noteAssignment = await request(A, 'POST', '/api/sync/source-task', noteInput);
    const sharedNoteId = noteAssignment.source.id;
    assert.notEqual(sharedNoteId, noteInput.sourceNoteId);
    assert.equal(noteAssignment.task.sourceNoteId, sharedNoteId);
    assert.equal(noteAssignment.task.sourceBlockId, 'source-todo');
    assert.equal(noteAssignment.task.assigneeUserId, people.B.userId);
    assert.equal(noteAssignment.task.assignedBy, people.A.userId);
    const repeatedNote = await request(A, 'POST', '/api/sync/source-task', noteInput);
    assert.deepEqual(repeatedNote, noteAssignment);
    check('personal note assignment creates one canonical source and one task on retry', true);
    const canonicalNote = await request(A, 'GET', `/api/notes/${sharedNoteId}`, undefined, ws);
    const expectedBlocks = structuredClone(blocks);
    expectedBlocks[0].taskId = noteAssignment.task.id;
    assert.deepEqual(JSON.parse(canonicalNote.blocksJson), expectedBlocks);
    assert.ok(canonicalNote.blocksJson.length <= 10000 && canonicalNote.blocksJson.length >= 9900);
    const journal = (await request(A, 'GET', `/api/sync/outbox?workspaceId=${ws}`)).ops;
    const fragments = journal.map((entry) => entry.op).filter((op) => op.table === 'fragments');
    const versions = new Map();
    for (const fragment of fragments) {
      assert.equal(fragment.fields.Table, 'notes');
      assert.equal(fragment.fields.EntityId, sharedNoteId);
      assert.equal(fragment.fields.Field, 'BlocksJson');
      assert.ok(Buffer.byteLength(JSON.stringify(fragment.fields.Value)) <= 3500, 'escaped fragment payload is bounded');
      const parts = versions.get(fragment.fields.Version) || [];
      parts.push(fragment); versions.set(fragment.fields.Version, parts);
    }
    assert.ok(versions.size >= 2, 'copy and task link each produce a complete content version');
    for (const parts of versions.values()) {
      parts.sort((left, right) => left.fields.Part - right.fields.Part);
      assert.equal(parts.length, parts[0].fields.Parts);
      assert.deepEqual(parts.map((part) => part.fields.Part), Array.from({ length: parts.length }, (_, index) => index));
      assert.doesNotThrow(() => JSON.parse(parts.map((part) => part.fields.Value).join('')));
    }
    assert.equal([...versions.values()].at(-1).map((part) => part.fields.Value).join(''), canonicalNote.blocksJson);
    check('near-limit BlocksJson is journaled as complete bounded escaped fragments', true, `${fragments.length} fragments, ${canonicalNote.blocksJson.length} characters`);
    const noteSeq = await store.lastSeq(ws);
    await A.engine.syncAll(); await B.engine.syncAll(); await A.engine.syncAll();
    const noteChanges = await store.changesAfter(ws, noteSeq, 200);
    assert.ok(noteChanges.length > 1);
    assert.deepEqual(noteChanges.flatMap((change) => change.ops), journal.map((entry) => entry.op));
    for (const parts of versions.values()) {
      const sequences = noteChanges.filter((change) => change.ops.some((op) => op.fields?.Version === parts[0].fields.Version));
      assert.ok(sequences.length > 1, 'each full note version spans cloud batches');
    }
    check('the real desktop engine ships every journal fragment across multiple cloud batches', true, `${noteChanges.length} batches`);
    const bobAssigned = await request(B, 'GET', '/api/sync/assigned');
    const bobNoteTask = bobAssigned.find((task) => task.id === noteAssignment.task.id);
    assert.ok(bobNoteTask);
    assert.equal(bobNoteTask.workspaceId, ws);
    assert.equal(bobNoteTask.sourceNoteId, sharedNoteId);
    assert.equal(bobNoteTask.sourceBlockId, 'source-todo');
    assert.equal(bobNoteTask.assignedBy, people.A.userId);
    const openedNote = await request(B, 'GET', `/api/notes/${bobNoteTask.sourceNoteId}`, undefined, bobNoteTask.workspaceId);
    assert.deepEqual(openedNote, canonicalNote);
    check('Bob opens the assigned task source with complete note content and the todo backlink', true);
    assert.equal(B.events.assigned.filter((event) => event.taskId === bobNoteTask.id).length, 1);
    await request(B, 'GET', '/api/notes/personal-source-note', undefined, ws, 404);
    await request(B, 'GET', '/api/notes/private-note', undefined, ws, 404);
    assert.deepEqual(await request(B, 'GET', '/api/notes'), []);
    assert.equal((await request(A, 'GET', '/api/notes/personal-source-note')).blocksJson, blocksJson);
    assert.equal(JSON.stringify(noteChanges).includes('Private sentinel'), false);
    check('assignment notifies Bob once and exposes no personal or unrelated note', true);

    const editedBlocks = JSON.parse(openedNote.blocksJson);
    editedBlocks[1].content = `Bob edit: ${editedBlocks[1].content.slice(20)}`;
    const editedJson = JSON.stringify(editedBlocks);
    const bobEdit = await request(B, 'PUT', `/api/notes/${sharedNoteId}`, { title: 'Bob edited source', blocksJson: editedJson }, ws);
    await B.engine.syncAll(); await A.engine.syncAll(); await B.engine.syncAll();
    assert.deepEqual(await request(A, 'GET', `/api/notes/${sharedNoteId}`, undefined, ws), bobEdit);
    assert.deepEqual(await request(B, 'GET', `/api/notes/${sharedNoteId}`, undefined, ws), bobEdit);
    const sourceRetry = await request(A, 'POST', '/api/sync/share-source', { workspaceId: ws, kind: 'note', id: noteInput.sourceNoteId });
    assert.equal(sourceRetry.id, sharedNoteId);
    assert.equal((await request(A, 'GET', `/api/notes/${sharedNoteId}`, undefined, ws)).blocksJson, editedJson);
    const taskAfterEdit = await request(B, 'GET', `/api/tasks/${bobNoteTask.id}`, undefined, ws);
    assert.equal(taskAfterEdit.sourceNoteId, sharedNoteId);
    assert.equal(taskAfterEdit.sourceBlockId, 'source-todo');
    assert.equal(JSON.parse(bobEdit.blocksJson)[0].taskId, bobNoteTask.id);
    check('recipient long-note edits converge and sharing again preserves edits and source links', true);

    const database = await request(A, 'POST', '/api/databases', { name: 'Source database', titleLabel: 'Issue' }, undefined, 201);
    const details = await request(A, 'POST', '/api/fields', { databaseId: database.id, name: 'Details', kind: 'text', showOnCard: true }, undefined, 201);
    const date = await request(A, 'POST', '/api/fields', { databaseId: database.id, name: 'Due', kind: 'date' }, undefined, 201);
    await request(A, 'PUT', `/api/databases/${database.id}`, { dateFieldId: date.id });
    const record = await request(A, 'POST', `/api/databases/${database.id}/rows`, { title: 'First issue' }, undefined, 201);
    const secondRecord = await request(A, 'POST', `/api/databases/${database.id}/rows`, { title: 'Second issue' }, undefined, 201);
    await request(A, 'PUT', `/api/databases/rows/${record.id}/fields/${details.id}`, { value: 'Original cell content' });
    await request(A, 'PUT', `/api/databases/rows/${record.id}/fields/${date.id}`, { value: '2030-03-01' });
    await request(A, 'PUT', `/api/databases/rows/${secondRecord.id}/fields/${details.id}`, { value: 'Second cell content' });
    const personalRows = await request(A, 'GET', `/api/databases/${database.id}/rows`);
    const personalFields = await request(A, 'GET', `/api/fields?databaseId=${database.id}`);
    const personalValues = await request(A, 'GET', `/api/databases/${database.id}/field-values`);
    await request(A, 'POST', '/api/databases', { name: 'Private database sentinel' }, undefined, 201);
    const dbInput = { workspaceId: ws, clientId: 'database-assignment', title: 'Review first issue', listId: sharedList,
      sourceRecordId: record.id, sourceFieldId: details.id, assigneeUserId: people.B.userId };
    const dbAssignment = await request(A, 'POST', '/api/sync/source-task', dbInput);
    assert.deepEqual(await request(A, 'POST', '/api/sync/source-task', dbInput), dbAssignment);
    const source = dbAssignment.source;
    assert.notEqual(source.id, database.id);
    assert.equal(Object.keys(source.recordIds).length, 2);
    assert.equal(Object.keys(source.fieldIds).length, 2);
    for (const [original, canonical] of Object.entries({ ...source.recordIds, ...source.fieldIds })) assert.notEqual(original, canonical);
    assert.equal(dbAssignment.task.sourceRecordId, source.recordIds[record.id]);
    assert.equal(dbAssignment.task.sourceFieldId, source.fieldIds[details.id]);
    check('database assignment retries reuse a canonical database, remapped rows, definitions and task', true);
    await A.engine.syncAll(); await B.engine.syncAll(); await A.engine.syncAll();
    const bobDbTask = (await request(B, 'GET', '/api/sync/assigned')).find((task) => task.id === dbAssignment.task.id);
    assert.ok(bobDbTask);
    assert.equal(bobDbTask.sourceRecordId, source.recordIds[record.id]);
    assert.equal(bobDbTask.sourceFieldId, source.fieldIds[details.id]);
    const bobDatabases = await request(B, 'GET', '/api/databases', undefined, ws);
    assert.equal(bobDatabases.length, 1);
    assert.equal(bobDatabases[0].id, source.id);
    assert.equal(bobDatabases[0].dateFieldId, source.fieldIds[date.id]);
    const bobRows = await request(B, 'GET', `/api/databases/${source.id}/rows`, undefined, ws);
    const bobFields = await request(B, 'GET', `/api/fields?databaseId=${source.id}`, undefined, ws);
    const bobValues = await request(B, 'GET', `/api/databases/${source.id}/field-values`, undefined, ws);
    assert.deepEqual(bobRows, personalRows.map((row) => ({ ...row, id: source.recordIds[row.id], databaseId: source.id })));
    assert.deepEqual(bobFields, personalFields.map((field) => ({ ...field, id: source.fieldIds[field.id], databaseId: source.id })));
    assert.deepEqual(bobValues, personalValues.map((value) => ({ ...value, recordId: source.recordIds[value.recordId], fieldId: source.fieldIds[value.fieldId] })));
    assert.ok(bobRows.some((row) => row.id === bobDbTask.sourceRecordId));
    assert.ok(bobFields.some((field) => field.id === bobDbTask.sourceFieldId));
    check('Bob resolves database task source links to complete canonical definitions, rows and typed values', true);
    await request(B, 'PUT', `/api/databases/rows/${bobDbTask.sourceRecordId}/fields/${bobDbTask.sourceFieldId}`, { value: 'Bob revised the shared cell' }, ws);
    await request(B, 'PUT', `/api/databases/rows/${bobDbTask.sourceRecordId}`, { title: 'Bob revised the issue' }, ws);
    await B.engine.syncAll(); await A.engine.syncAll(); await B.engine.syncAll();
    assert.deepEqual(await request(A, 'GET', `/api/databases/${source.id}/field-values`, undefined, ws), await request(B, 'GET', `/api/databases/${source.id}/field-values`, undefined, ws));
    assert.deepEqual(await request(A, 'GET', `/api/databases/${source.id}/rows`, undefined, ws), await request(B, 'GET', `/api/databases/${source.id}/rows`, undefined, ws));
    assert.equal((await request(A, 'GET', `/api/databases/${source.id}/rows`, undefined, ws)).find((row) => row.id === bobDbTask.sourceRecordId).title, 'Bob revised the issue');
    assert.equal((await request(A, 'GET', `/api/databases/${source.id}/field-values`, undefined, ws)).find((value) => value.recordId === bobDbTask.sourceRecordId && value.fieldId === bobDbTask.sourceFieldId).value, 'Bob revised the shared cell');
    assert.deepEqual((await request(A, 'POST', '/api/sync/share-source', { workspaceId: ws, kind: 'database', id: database.id })), source);
    assert.deepEqual(await request(A, 'GET', `/api/databases/${database.id}/rows`), personalRows);
    assert.deepEqual(await request(A, 'GET', `/api/databases/${database.id}/field-values`), personalValues);
    assert.deepEqual(await request(B, 'GET', '/api/databases'), []);
    const dbTaskAfterEdit = await request(B, 'GET', `/api/tasks/${bobDbTask.id}`, undefined, ws);
    assert.equal(dbTaskAfterEdit.sourceRecordId, bobDbTask.sourceRecordId);
    assert.equal(dbTaskAfterEdit.sourceFieldId, bobDbTask.sourceFieldId);
    check('recipient database edits converge without changing personal originals or canonical task links', true);
    const allChanges = await store.changesAfter(ws, 0, 200);
    assert.equal(JSON.stringify(allChanges).includes('Private database sentinel'), false);
    for (const change of allChanges) {
      assert.ok(Buffer.byteLength(JSON.stringify(change.ops)) <= 8500, `batch ${change.seq} exceeds the desktop byte bound`);
      assert.ok(change.ops.length <= 200);
      for (const op of change.ops) assert.equal(Object.hasOwn(op.fields || {}, 'OwnerId'), false);
    }
    for (const replica of [A, B]) {
      assert.equal((await request(replica, 'GET', `/api/sync/outbox?workspaceId=${ws}`)).ops.length, 0);
      assert.equal(replica.engine.status().skippedFields, 0);
      assert.equal(replica.engine.status().rejectedOps, 0);
      assert.equal(replica.engine.status().lastError, null);
      assert.equal((await request(replica, 'GET', '/api/sync/workspaces'))[0].cursor, await store.lastSeq(ws));
    }
    check('all shared content is delivered within batch bounds with empty outboxes and converged cursors', true);
    console.log(`\nCloud change-log writes for the whole scenario: ${store.stats().writes}`);
  } catch (e) { console.log('ERROR', e && e.stack || e); results.push(false); }
  finally { A?.engine.stop(); B?.engine.stop(); await Promise.all([A, B].filter(Boolean).map((replica) => replica.kill())); }
  console.log(`Scenario checks: ${results.filter(Boolean).length} passed, ${results.filter((ok) => !ok).length} failed`);
  console.log(results.every(Boolean) ? '\nALL PASSED' : '\nSOME FAILED');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
