'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCliqConnection } = require('./cliqConnection');
const { createCliqInboxService } = require('../functions/backup/cliqInboxService');

test('pairing and bot add cross the cloud and desktop contracts with replay protection', async (context) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hitlist-pipeline-'));
  context.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const records = new Map();
  let link = null;
  let handlers;
  let pushed;
  const store = {
    insertUnique: async (key, value) => { if (records.has(key)) return false; records.set(key, value); return true; },
    get: async (key) => records.get(key),
    set: async (key, value) => records.set(key, value),
    remove: async (key) => records.delete(key),
    linkByAccount: async (accountId) => link?.accountId === accountId ? link : null,
    linkBySender: async (senderKey) => link?.senderKey === senderKey ? link : null,
    createLink: async (value) => { if (link) return false; link = value; return true; },
    deleteLink: async () => { link = null; },
    listPending: async (accountId, deviceId, generation, limit) => [...records.entries()]
      .filter(([key, value]) => key.startsWith('command:') && value.accountId === accountId
        && value.deviceId === deviceId && value.generation === generation && value.status !== 'terminal')
      .map(([, value]) => value).slice(0, limit),
  };
  const caller = { userId: '75733000000033001', email: 'person@example.org' };
  const sender = { id: 'sender1', orgId: 'org1', email: caller.email };
  const service = createCliqInboxService({ store, allowedDomains: ['example.org'], verifySender: () => true,
    publish: async () => { pushed = handlers?.onSignal(); return true; }, reply: async () => true });
  const localReceipts = new Map();
  const executed = [];
  const connection = createCliqConnection({ stateDir, getAccount: () => caller,
    localGet: async () => Buffer.from('{}'),
    localPost: async (_route, command, options) => {
      assert.equal(options.accountIdentity, caller.userId);
      assert.equal(options.headers['X-Timezone'], 'Asia/Kolkata');
      assert.equal(command.schemaVersion, 1);
      assert.equal(command.type, 'create');
      assert.deepEqual(command.payload, { title: 'Prepare report', dueDate: '2026-10-05', dueTime: '17:00' });
      if (!localReceipts.has(command.id)) {
        executed.push(command);
        localReceipts.set(command.id, { status: 'applied', task: { taskId: 'local-task', title: command.payload.title,
          status: 'TODO', dueDate: command.payload.dueDate, dueTime: command.payload.dueTime, updatedAt: new Date().toISOString() } });
      }
      return { status: 200, json: localReceipts.get(command.id) };
    },
    cloudPost: async (route, body) => {
      const actions = {
        '/cliq/link': () => service.getLink(caller, body),
        '/cliq/link/start': () => service.startLink(caller, body),
        '/cliq/link/confirm': () => service.confirmLink(caller, body),
        '/cliq/pending': () => service.fetchPending(caller, body),
        '/cliq/ack': () => service.ack(caller, body),
      };
      assert.ok(actions[route], `Unexpected route ${route}`);
      return actions[route]();
    },
    createPush: () => ({ subscribe: async (_identity, callbacks) => { handlers = callbacks; return () => {}; } }),
  });
  context.after(() => connection.stop());
  const challenge = await connection.start('Asia/Kolkata');
  assert.ok(challenge.code);
  assert.equal(Object.hasOwn(challenge, 'nonce'), false);
  await service.acceptEvent({ eventId: 'pairing-1', sender, text: `link ${challenge.code}` });
  assert.equal((await connection.confirm()).linked, true);
  await connection.enable(true);
  const event = { eventId: 'message-1', sender, text: 'add "Prepare report" --due 2026-10-05 --time 17:00' };
  const accepted = await service.acceptEvent(event);
  await pushed;
  assert.equal(accepted.queued, true);
  assert.equal(executed.length, 1);
  assert.equal((await store.get(`result:${accepted.commandId}`)).status, 'applied');
  await service.acceptEvent(event);
  await connection.fetchNow();
  assert.equal(executed.length, 1);
});