/**
 * D1.0 spike, throwaway: can a desktop app sign in with Catalyst's hosted login and then call a Catalyst Function
 * as that user? Run it with:  cd desktop && pnpm exec electron auth-spike.js
 * It opens the hosted login in a window, waits for you to sign in, reads the session cookies for the project domain
 * and calls the deployed `backup` function's /whoami with them from this (Node) side. It prints what happened and
 * never prints a cookie value, only the cookie names.
 */
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');

// Everything printed is also appended here, so the result can be read without copying it out of a terminal.
const RESULT = '/tmp/hitlist-auth-spike.txt';
fs.writeFileSync(RESULT, '');
const say = (...parts) => { const line = parts.join(' '); console.log(line); fs.appendFileSync(RESULT, line + '\n'); };

const { HOST: DOMAIN, LOGIN_URL, SIGNUP_URL, RESET_PASSWORD_URL, BACKUP_FUNCTION_URL } = require('./catalyst-config');
// SPIKE_PAGE=reset or =signup opens that hosted page instead of the sign-in page (to set a first password).
const LOGIN = { reset: RESET_PASSWORD_URL, signup: SIGNUP_URL }[process.env.SPIKE_PAGE] ?? LOGIN_URL;
const WHOAMI = `${BACKUP_FUNCTION_URL}/whoami`;

async function cookieHeader(ses) {
  const cookies = await ses.cookies.get({ domain: DOMAIN });
  return { names: cookies.map((c) => c.name), csrf: cookies.find((c) => c.name === 'ZD_CSRF_TOKEN')?.value, header: cookies.map((c) => `${c.name}=${c.value}`).join('; ') };
}

async function whoami(header, csrf) {
  const headers = header ? { Cookie: header } : {};
  if (csrf) headers['X-ZCSRF-TOKEN'] = `ZD_CSRF_TOKEN=${csrf}`;
  const res = await fetch(WHOAMI, { headers });
  return `${res.status} ${(await res.text()).slice(0, 200)}`;
}

app.whenReady().then(async () => {
  const ses = session.fromPartition('persist:hitlist-spike');
  const win = new BrowserWindow({ width: 520, height: 720, title: 'HitList sign-in (spike)', webPreferences: { session: ses } });
  let done = false;
  const check = async () => {
    if (done) return;
    const { names, header, csrf } = await cookieHeader(ses);
    say('cookie names:', names.join(', ') || '(none)');
    const withCsrf = await whoami(header, csrf);
    say('whoami with cookies only          ->', await whoami(header, ''));
    say('whoami with cookies + csrf header ->', withCsrf);
    say('whoami with no cookies            ->', await whoami(''));
    // The same call made by the signed-in page itself, as a browser would.
    const inPage = await win.webContents.executeJavaScript(`fetch('/server/backup/whoami',{credentials:'include'}).then(async (r) => r.status + ' ' + (await r.text()).slice(0, 600)).catch((e) => 'failed ' + e.message)`);
    say('whoami from inside the window         ->', inPage);
    if (withCsrf.startsWith('200') || inPage.startsWith('200') || (await whoami(header, '')).startsWith('200')) {
      done = true; say('SPIKE PASSED'); setTimeout(() => app.quit(), 1500);
    }
  };
  win.webContents.on('did-navigate', (_e, url) => say('navigated to', new URL(url).pathname));
  // Listening before the first load, so an already signed-in window is checked too. A check runs 5 s after every
  // page load until one passes (sign-in takes you through several pages).
  win.webContents.on('did-finish-load', () => { setTimeout(() => { check().catch((e) => say('check failed:', e.message)); }, 5000); });
  say('Sign in in the window if it asks. The check runs 5 s after each page load.');
  await win.loadURL(LOGIN);
});
