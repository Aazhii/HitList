'use strict';
/**
 * Finds out why the shared-workspace live signal (Ably) will not connect, using the real Ably service and the same code the
 * app and the cloud function use. It prints each step and the exact reason a step fails. It never prints the key.
 *
 *   1. Put your Ably key in functions/backup/.env.cliq as a line:  ABLY_API_KEY=<name>.<id>:<secret>   (that file is git-ignored)
 *   2. Run from the repo root:  node desktop/scripts/check-live-signal.js
 *
 * It signs a subscribe-only token for a made-up workspace exactly as the function does, connects like the desktop does,
 * rings the doorbell for that made-up workspace through Ably's REST API, and waits for it. No Catalyst, no Data Store,
 * no HitList data is touched; it sends a few Ably messages on a channel nobody else uses.
 */
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { createWorkspaceDelivery } = require('../../functions/backup/workspaceDelivery');
const { createWorkspacePush } = require('../workspacePush');

function keyFromFile() {
  const file = path.join(__dirname, '..', '..', 'functions', 'backup', '.env.cliq');
  if (!fs.existsSync(file)) return '';
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*ABLY_API_KEY\s*=\s*(.+?)\s*$/.exec(line);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  }
  return '';
}

const step = (ok, text) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${text}`);

(async () => {
  const key = process.env.ABLY_API_KEY || keyFromFile();
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+:[^:\s]+$/.test(key)) {
    step(false, 'No usable ABLY_API_KEY (expected name.id:secret) in the environment or functions/backup/.env.cliq');
    process.exit(2);
  }
  step(true, `ABLY_API_KEY found (${key.length} characters, not shown)`);

  const workspaceId = randomBytes(32).toString('base64url');
  const delivery = createWorkspaceDelivery({ config: { ABLY_API_KEY: key } });
  const issued = await delivery.issueToken([workspaceId]);
  step(!!(issued && issued.token), 'The function code signs a subscribe-only token for a test workspace');

  try { step(typeof require('ably').Realtime === 'function', 'The ably package loads'); }
  catch (error) { step(false, `The ably package does not load: ${error.message}`); process.exit(1); }

  const push = createWorkspacePush({ requestToken: async () => issued });
  const heard = new Promise((resolve) => { globalThis.__resolveSignal = resolve; });
  let stop;
  try {
    stop = await push.subscribe({
      signal: new AbortController().signal,
      onSignal: (id, seq) => globalThis.__resolveSignal({ id, seq }),
      onReconnect: () => {},
      onUnavailable: (reason) => console.log(`NOTE  the connection dropped later: ${reason}`),
    });
    step(true, 'Connected and subscribed like the desktop does');
  } catch (error) {
    step(false, `Could not connect or subscribe: ${(error.cause && error.cause.message) || error.message}`);
    process.exit(1);
  }

  const published = await delivery.publish(workspaceId, 7);
  step(published, 'The function code rings the doorbell through Ably (REST publish)');
  const got = await Promise.race([heard, new Promise((resolve) => setTimeout(() => resolve(null), 8000))]);
  step(!!got && got.seq === 7, got ? `The desktop code heard it (workspace matched: ${got.id === workspaceId}, seq ${got.seq})` : 'The doorbell was NOT heard within 8 seconds');
  stop();
  process.exit(got && got.seq === 7 && published ? 0 : 1);
})().catch((error) => { step(false, `Unexpected: ${error.message}`); process.exit(1); });
