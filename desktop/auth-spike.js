/**
 * D1.0 spike, throwaway: can a desktop app sign in with Catalyst's hosted login and then call a Catalyst Function
 * as that user? Run it with:  cd desktop && pnpm exec electron auth-spike.js
 * It opens the hosted login in a window, waits for you to sign in, reads the session cookies for the project domain
 * and calls the deployed `backup` function's /whoami with them from this (Node) side. It prints what happened and
 * never prints a cookie value, only the cookie names.
 */
const { app, BrowserWindow, session } = require('electron');

const DOMAIN = 'hitlist-60090109165.development.catalystserverless.in';
const LOGIN = `https://${DOMAIN}/__catalyst/auth/login`;
const WHOAMI = `https://${DOMAIN}/server/backup/whoami`;

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
  console.log('Sign in in the window. The check runs 5 s after each page load that is not the login page.');
  let done = false;
  win.webContents.on('did-navigate', (_e, url) => console.log('navigated to', new URL(url).pathname));
  win.webContents.on('did-finish-load', () => {
    setTimeout(async () => {
      if (done) return;
      const { names, header } = await cookieHeader(ses);
      console.log('cookie names:', names.join(', ') || '(none)');
      const authed = await whoami(header);
      console.log('whoami with the window\'s cookies ->', authed);
      console.log('whoami with no cookies           ->', await whoami(''));
      if (authed.startsWith('200')) { done = true; console.log('SPIKE PASSED'); setTimeout(() => app.quit(), 1500); }
    }, 5000);
  });
});
