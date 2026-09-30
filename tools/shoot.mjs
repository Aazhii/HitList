#!/usr/bin/env node
/**
 * shoot — render a prototype screen and the app's equivalent, side by side.
 *
 * Every Phase 3 task in docs/design-migration/03-SCREENS.md closes on the pair
 * this produces, not on a description of the diff.
 *
 *   node scripts/shoot.mjs tasks-matrix              both sides
 *   node scripts/shoot.mjs tasks-matrix --ref        prototype only
 *   node scripts/shoot.mjs tasks-matrix --app        app only
 *   node scripts/shoot.mjs --list                    every screen id
 *   node scripts/shoot.mjs tasks-matrix --app-url=http://localhost:9000
 *
 * Output: docs/design-migration/shots/<id>.ref.png and .app.png
 *
 * Two things about the prototype that cost an afternoon to find, both handled
 * below: a DOM `.click()` does not fire its handlers (it needs a real synthetic
 * mouse click at the element's box centre), and several screen labels collide
 * with live tabs inside the rendered app, so entries must be matched excluding
 * elements whose role is `tab`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const REPO = new URL('..', import.meta.url).pathname;
const SHOTS = join(REPO, 'docs/design-migration/shots');
const PROTOTYPE = 'file:///Users/arikaran-25256/Documents/newHitlistDesign/project/HitList%20Notion%20x%20Zoho.dc.html';
const VIEWPORT = { width: 1440, height: 900 };

/**
 * id -> how to drive the app to the equivalent state. `nav` is the sidebar row;
 * `tab` is the layout tab inside the page header; `then` is further button
 * clicks (text; a leading `~` means starts-with) — e.g. picking a board's field. Screens with no entry are
 * prototype-only for now (a dialog or a feature that does not exist yet) and
 * shoot the reference side alone.
 */
const APP_ROUTE = {
  'tasks-matrix': { nav: 'Tasks', tab: 'Matrix' },
  'tasks-list':   { nav: 'Tasks', tab: 'List' },
  'tasks-table':  { nav: 'Tasks', tab: 'Table' },
  'tasks-board':  { nav: 'Tasks', tab: 'Board', then: ['~Stage'] },
  'tasks-empty':  { nav: 'Tasks', tab: 'Matrix' },
  'notes-editor': { nav: 'Notes' },
  'notes-empty':  { nav: 'Notes' },
  'db-table':     { nav: 'Databases' },
  'db-empty':     { nav: 'Databases' },
  'cal-month':    { nav: 'Calendar' },
};

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith('--'));
const appUrl = (args.find((a) => a.startsWith('--app-url=')) ?? '').slice('--app-url='.length);
const only = args.includes('--ref') ? 'ref' : args.includes('--app') ? 'app' : 'both';

/** A real mouse click at the element's centre. `.click()` does not work here. */
async function realClick(page, handle) {
  const box = await handle?.asElement?.()?.boundingBox?.();
  if (!box) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return true;
}

async function openSwitcher(page) {
  const pill = await page.evaluateHandle(() =>
    Array.from(document.querySelectorAll('button, div'))
      .find((n) => /Screens\s*·\s*\d+\s*\/\s*\d+/.test(n.textContent || '') && n.offsetWidth < 300) ?? null);
  return realClick(page, pill);
}

async function listScreens(page) {
  await openSwitcher(page);
  await new Promise((r) => setTimeout(r, 400));
  return page.evaluate(() => Array.from(document.querySelectorAll('button'))
    .filter((n) => n.getAttribute('role') !== 'tab')
    .map((n) => n.textContent?.trim())
    .filter(Boolean));
}

async function shootRef(browser, screenId) {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  await page.goto(PROTOTYPE, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));

  // The switcher labels a screen by its `label`, not its id — read the
  // screens[] array out of the page so an id maps to the right entry.
  const label = await page.evaluate((wanted) => {
    const src = Array.from(document.querySelectorAll('script'))
      .map((s) => s.textContent || '').find((t) => t.includes("id: '") && t.includes('g:'));
    if (!src) return null;
    const re = new RegExp(`\\{\\s*id:\\s*'${wanted}'[^}]*?label:\\s*'([^']+)'`);
    return re.exec(src)?.[1] ?? null;
  }, screenId);
  if (!label) throw new Error(`no screen with id "${screenId}" in the prototype`);

  await openSwitcher(page);
  await new Promise((r) => setTimeout(r, 400));
  const entries = await page.evaluateHandle((l) => Array.from(document.querySelectorAll('button'))
    .filter((n) => n.textContent?.trim() === l && n.getAttribute('role') !== 'tab'), label);
  const first = await page.evaluateHandle((a) => a[0], entries);
  if (!(await realClick(page, first))) throw new Error(`could not click "${label}"`);
  await new Promise((r) => setTimeout(r, 1200));

  const out = join(SHOTS, `${screenId}.ref.png`);
  await page.screenshot({ path: out });
  await page.close();
  return out;
}

/**
 * The backend scopes everything to an owner cookie it sets on first contact, so
 * a fresh browser sees an empty workspace. When a seeding run has left a curl
 * cookie jar behind, reuse its owner — otherwise the app side of every pair
 * shoots the empty state and proves nothing.
 */
function seedCookie() {
  try {
    const jar = readFileSync('/tmp/hitlist-seed-jar.txt', 'utf8');
    const row = jar.split('\n').find((l) => l.includes('hitlist_owner_v1'));
    const value = row?.split('\t').pop()?.trim();
    return value ? { name: 'hitlist_owner_v1', value } : null;
  } catch { return null; }
}

async function shootApp(browser, screenId, url) {
  const route = APP_ROUTE[screenId];
  if (!route) return null;
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  const cookie = seedCookie();
  if (cookie) await page.setCookie({ ...cookie, url });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 1400));

  const clickText = async (text) => {
    const h = await page.evaluateHandle((t) => Array.from(document.querySelectorAll('button'))
      .find((n) => { const x = n.textContent?.trim() ?? ''; return t.startsWith('~') ? x.startsWith(t.slice(1)) : x === t; }) ?? null, text);
    return realClick(page, h);
  };
  if (route.nav) { await clickText(route.nav); await new Promise((r) => setTimeout(r, 900)); }
  if (route.tab) { await clickText(route.tab); await new Promise((r) => setTimeout(r, 800)); }
  for (const t of route.then ?? []) { await clickText(t); await new Promise((r) => setTimeout(r, 800)); }

  const out = join(SHOTS, `${screenId}.app.png`);
  await page.screenshot({ path: out });
  await page.close();
  if (errors.length) console.log(`  ! ${errors.length} console/page error(s):\n    ${errors.join('\n    ')}`);
  return out;
}

/** The desktop app serves the built frontend on its own port; find it. */
function desktopUrl() {
  try {
    const port = readFileSync('/tmp/hitlist-port', 'utf8').trim();
    if (port) return `http://localhost:${port}`;
  } catch { /* fall through */ }
  return 'http://localhost:9000';
}

/**
 * pnpm skips puppeteer's post-install by default, so its own download may be
 * missing while a Chrome for Testing from an earlier install sits in the shared
 * cache. Reuse that rather than making every contributor fetch 300MB again.
 */
function cachedChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const base = join(process.env.HOME ?? '', '.cache/puppeteer/chrome');
  try {
    const build = readdirSync(base).sort().pop();
    if (!build) return undefined;
    const p = join(base, build, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
    return existsSync(p) ? p : undefined;
  } catch { return undefined; }
}

const browser = await puppeteer.launch({
  headless: true,
  executablePath: cachedChrome(),
  args: ['--allow-file-access-from-files'],
});
try {
  if (args.includes('--list')) {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await page.goto(PROTOTYPE, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1500));
    console.log((await listScreens(page)).join('\n'));
  } else if (!id) {
    console.error('usage: shoot.mjs <screen-id> [--ref|--app] [--app-url=…]   or --list');
    process.exitCode = 2;
  } else {
    mkdirSync(SHOTS, { recursive: true });
    if (only !== 'app') console.log('ref:', await shootRef(browser, id));
    if (only !== 'ref') {
      const out = await shootApp(browser, id, appUrl || desktopUrl());
      console.log(out ? `app: ${out}` : `app: no route for "${id}" — reference only`);
    }
  }
} finally {
  await browser.close();
}
