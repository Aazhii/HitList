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
  return { names: cookies.map((c) => c.name), header: cookies.map((c) => `${c.name}=${c.value}`).join('; ') };
}

async function whoami(header) {
  const res = await fetch(WHOAMI, { headers: header ? { Cookie: header } : {} });
  return `${res.status} ${(await res.text()).slice(0, 200)}`;
}

app.whenReady().then(async () => {
  const ses = session.fromPartition('persist:hitlist-spike');
  const win = new BrowserWindow({ width: 520, height: 720, title: 'HitList sign-in (spike)', webPreferences: { session: ses } });
  await win.loadURL(LOGIN);
  say('Sign in in the window. The check runs 5 s after each page load that is not the login page.');
  let done = false;
  win.webContents.on('did-navigate', (_e, url) => say('navigated to', new URL(url).pathname));
  win.webContents.on('did-finish-load', () => {
    setTimeout(async () => {
      if (done) return;
      const { names, header } = await cookieHeader(ses);
      say('cookie names:', names.join(', ') || '(none)');
      const authed = await whoami(header);
      say('whoami with the window\'s cookies ->', authed);
      say('whoami with no cookies           ->', await whoami(''));
      if (authed.startsWith('200')) { done = true; say('SPIKE PASSED'); setTimeout(() => app.quit(), 1500); }
    }, 5000);
  });
});
