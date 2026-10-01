/**
 * D2 smoke test, throwaway: with the sign-in remembered by auth-spike.js, upload one small gzip "backup" to the
 * deployed `backup` Function, list it, download it, upload the same thing again (should be skipped), and check
 * that signed-out calls are refused. Run:  cd desktop && pnpm exec electron backup-smoke.js
 * Result is also written to /tmp/hitlist-backup-smoke.txt.
 */
const { app, session } = require('electron');
const fs = require('node:fs');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { BACKUP_FUNCTION_URL } = require('./catalyst-config');

const RESULT = '/tmp/hitlist-backup-smoke.txt';
fs.writeFileSync(RESULT, '');
const say = (...p) => { const l = p.join(' '); console.log(l); fs.appendFileSync(RESULT, l + '\n'); };

app.whenReady().then(async () => {
  const ses = session.fromPartition('persist:hitlist-spike');
  const call = async (path, init, signedIn = true) => {
    const res = await (signedIn ? ses.fetch(BACKUP_FUNCTION_URL + path, init) : fetch(BACKUP_FUNCTION_URL + path, init));
    return { status: res.status, text: Buffer.from(await res.arrayBuffer()) };
  };
  const body = zlib.gzipSync(Buffer.from(JSON.stringify({ smoke: true, at: new Date().toISOString() })));
  const hash = crypto.createHash('sha256').update(body).digest('hex');
  const put = (signedIn = true) => call('/backup', { method: 'PUT', body, headers: { 'x-content-hash': hash } }, signedIn);
  try {
    say('whoami            ->', (await call('/whoami')).status);
    const first = await put();
    say('upload            ->', first.status, first.text.toString().slice(0, 160));
    const again = await put();
    say('same again        ->', again.status, again.text.toString().slice(0, 160), '(expect 200 stored:false)');
    say('list              ->', (await call('/backup/list')).text.toString().slice(0, 300));
    const latest = await call('/backup/latest');
    const roundTrip = latest.status === 200 && zlib.gunzipSync(latest.text).toString() === zlib.gunzipSync(body).toString();
    say('download latest   ->', latest.status, roundTrip ? 'matches what was uploaded' : 'DOES NOT MATCH');
    say('signed out upload ->', (await put(false)).status, '(expect 401)');
    say('signed out list   ->', (await call('/backup/list', {}, false)).status, '(expect 401)');
    say(first.status < 300 && roundTrip ? 'SMOKE PASSED' : 'SMOKE FAILED');
  } catch (e) { say('error:', e.message); }
  setTimeout(() => app.quit(), 500);
});
