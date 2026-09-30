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
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  // Needs an UNSEEDED backend (see 00-INDEX.md) — the empty state only shows for an empty list.
  'tasks-empty':  { nav: 'Tasks', tab: 'Matrix' },
  // Needs the seeded backend; types a search nothing matches.
  'tasks-nomatch': { nav: 'Tasks', tab: 'Table', then: ['~Filter'], type: ['Search tasks', 'zzzz-no-such-task'] },
  // Need a dead / hanging /api behind vite (see 00-INDEX.md "Shooting offline and loading").
  'tasks-offline': { nav: 'Tasks', tab: 'Matrix' },
  'tasks-loading': { nav: 'Tasks' },
  // Task dialogs (3B): open each overlay from the matrix.
  'ov-add': { nav: 'Tasks', tab: 'Matrix', then: ['New'] },
  'ov-detail': { nav: 'Tasks', tab: 'Matrix', then: ['~Reply to legal'] },
  'ov-delete': { nav: 'Tasks', tab: 'Matrix', then: ['~Reply to legal', '~Delete'] },
  'ov-filter': { nav: 'Tasks', tab: 'Table', then: ['~Filter'] },
  'ov-fields': { nav: 'Tasks', tab: 'Board', then: ['~Stage', '~Manage fields'] },
  'ov-fielddelete': { nav: 'Tasks', tab: 'Board', then: ['~Stage', '~Manage fields', '~Delete field'] },
  'ov-history': { nav: 'Tasks', tab: 'Matrix', then: ['Today'] },
  'ov-progress': { nav: 'Tasks', tab: 'Matrix', then: ['Weekly progress'] },
  'notes-editor': { nav: 'Notes', notes: true },
  'notes-slash':  { nav: 'Notes', notes: true, focusLast: 'textarea[aria-label^="Block"]', keys: '/' },
  'notes-mention': { nav: 'Notes', notes: true, focusLast: 'textarea[aria-label^="Block"]', keys: 'Confirm laptop shipping address with IT @' },
  'notes-empty':  { nav: 'Notes' },
  'db-table':     { nav: 'Databases', then: ['~Reading list'] },
  'db-empty':     { nav: 'Databases' },
  'db-board':     { nav: 'Databases', then: ['~Reading list', '~By status board'] },
  'db-new':       { nav: 'Databases', then: ['~Reading list', '@New database'] },
  'db-offline':   { nav: 'Databases' },
  'db-group':     { nav: 'Databases', then: ['~Reading list', '@Status column options', '~Group', '@Title column options', '~Calculate', '~Count all', '@Rating column options', '~Calculate', '~Average'] },
  'db-peek':      { nav: 'Databases', then: ['~Reading list', '@Open Dune'] },
  'db-freeze':    { nav: 'Databases', then: ['~Reading list', '@Title column options', '~Freeze'] },
  'db-colmenu':   { nav: 'Databases', then: ['~Reading list', '@Rating column options'] },
  'db-type':      { nav: 'Databases', then: ['~Reading list', '@Rating column options', '~Change type'] },
  'db-options':   { nav: 'Databases', then: ['~Reading list', '@Status column options', '~Edit options'] },
  'db-newprop':   { nav: 'Databases', then: ['~Reading list', '@Add a property'] },
  'db-props':     { nav: 'Databases', then: ['~Reading list', '@Show or hide columns'] },
  'db-sort':      { nav: 'Databases', then: ['~Reading list', '@Sort'] },
  'db-filter':    { nav: 'Databases', then: ['~Reading list', '@Filter'] },
  'db-picker':    { nav: 'Databases', then: ['~Reading list', '@Status of Dune'] },
  'sh-notif':     { then: ['@Notifications'] },
  'sh-account':   { then: ['@Account'] },
  'sh-pagemenu':  { nav: 'Notes', notes: true, then: ['^Onboarding plan', '@Options for Onboarding plan'] },
  'library':      { nav: 'Notes', notes: true, then: ['~Databases', '~Reading list', '~Tasks', '~View all'] },
  'auto-list':    { nav: '~Automations' },
  'auto-form':    { nav: '~Automations', then: ['@New rule'] },
  'cal-month':    { nav: 'Calendar' },
  'cal-add':      { nav: 'Calendar', then: ['Add on a day'] },
  'cal-offline':  { nav: 'Calendar' },
};

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith('--'));
const appUrl = (args.find((a) => a.startsWith('--app-url=')) ?? '').slice('--app-url='.length);
const only = args.includes('--ref') ? 'ref' : args.includes('--app') ? 'app' : 'both';

/**
 * Every visible text-bearing element's box and type/colour, for tools/cmp.mjs.
 * `--dump` writes /tmp/hitlist-dump-<id>.<ref|app>.json next to the screenshot.
 */
async function dumpDom(page) {
  return page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    for (let n = walker.currentNode; n; n = walker.nextNode()) {
      const el = n;
      const own = Array.from(el.childNodes).filter((c) => c.nodeType === 3).map((c) => c.textContent.trim()).join(' ').trim();
      const isControl = /^(BUTTON|INPUT|TEXTAREA|SELECT|IMG|SVG)$/i.test(el.tagName);
      if (!own && !isControl) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      // The box the text sits in: the nearest ancestor (within 3) that is rounded or filled.
      let box = el;
      for (let i = 0; i < 3 && box; i += 1, box = box.parentElement) {
        const b = getComputedStyle(box);
        if (b.borderRadius !== '0px' || b.backgroundColor !== 'rgba(0, 0, 0, 0)') break;
      }
      const bs = box ? getComputedStyle(box) : cs;
      const br = box ? box.getBoundingClientRect() : r;
      out.push({
        ar: bs.borderRadius, abg: bs.backgroundColor, aw: +br.width.toFixed(1), ah: +br.height.toFixed(1),
        ash: bs.boxShadow === 'none' ? '' : bs.boxShadow.slice(0, 50), abd: bs.borderTopWidth + ' ' + bs.borderTopColor,
        text: own.slice(0, 60), tag: el.tagName.toLowerCase(),
        x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
        fs: cs.fontSize, fw: cs.fontWeight, color: cs.color, bg: cs.backgroundColor, radius: cs.borderRadius,
        ls: cs.letterSpacing, lh: cs.lineHeight,
      });
    }
    return out;
  });
}

/** A real mouse click at the element's centre. `.click()` does not work here. */
async function realClick(page, handle) {
  // The switcher panel scrolls; an entry below the fold has no clickable box until it is shown.
  await handle?.asElement?.()?.evaluate?.((el) => el.scrollIntoView({ block: 'center' }));
  const box = await handle?.asElement?.()?.boundingBox?.();
  if (!box) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return true;
}


/**
 * One route step. '@label' clicks by aria-label prefix, '~text' by text prefix, plain text by exact
 * text, and '^text' only hovers the element showing exactly that text (a row whose "⋯" appears on hover).
 */
async function runStep(page, text) {
  if (text.startsWith('^')) {
    const label = text.slice(1);
    const h = await page.evaluateHandle((t) => {
      const all = Array.from(document.querySelectorAll('body *')).filter((n) => n.children.length === 0 && n.textContent?.trim() === t);
      return all.find((n) => n.getBoundingClientRect().left < 260) ?? all[0] ?? null;
    }, label);
    await h?.asElement?.()?.evaluate?.((el) => el.scrollIntoView({ block: 'center' }));
    const box = await h?.asElement?.()?.boundingBox?.();
    if (!box) return false;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await new Promise((r) => setTimeout(r, 300));
    return true;
  }
  const h = await page.evaluateHandle((t) => Array.from(document.querySelectorAll('button, [role="button"], [role="menuitem"], [role="option"]'))
    .find((n) => {
      if (t.startsWith('@')) return (n.getAttribute('aria-label') ?? '').startsWith(t.slice(1));
      const x = n.textContent?.trim() ?? '';
      return t.startsWith('~') ? x.startsWith(t.slice(1)) : x === t;
    }) ?? null, text);
  return realClick(page, h);
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
  const REF_BASE = { 'sh-pagemenu': 'tasks-matrix' };
  const REF_STEPS = { 'sh-pagemenu': ['^Reading queue', '@Page options'] };
  const { label, nth } = await page.evaluate((wanted) => {
    const src = Array.from(document.querySelectorAll('script'))
      .map((s) => s.textContent || '').find((t) => t.includes("id: '") && t.includes('g:'));
    if (!src) return { label: null, nth: 0 };
    // Every screen in order, so a label shared by two groups ("Table" under Tasks and
    // Databases) resolves to the right one by its position among same-labelled screens.
    const all = [...src.matchAll(/\{\s*id:\s*'([^']+)'[^}]*?label:\s*(['"])(.+?)\2/g)].map((m) => ({ id: m[1], label: m[3] }));
    const hit = all.find((x) => x.id === wanted);
    return { label: hit?.label ?? null, nth: hit ? all.filter((x) => x.label === hit.label).findIndex((x) => x.id === wanted) : 0 };
  }, REF_BASE[screenId] ?? screenId);
  if (!label) throw new Error(`no screen with id "${screenId}" in the prototype`);

  await openSwitcher(page);
  await new Promise((r) => setTimeout(r, 400));
  // Only the switcher's own entries: a label like "Filter" is also a button on the page itself.
  const entries = await page.evaluateHandle((l) => {
    const anchor = Array.from(document.querySelectorAll('button')).find((n) => n.textContent?.trim() === 'Sign in');
    let panel = anchor?.parentElement ?? null;
    while (panel && !panel.textContent?.includes('Task dialogs')) panel = panel.parentElement;
    return Array.from((panel ?? document).querySelectorAll('button'))
      .filter((n) => n.textContent?.trim() === l && n.getAttribute('role') !== 'tab');
  }, label);
  const first = await page.evaluateHandle((a, i) => a[i] ?? a[0], entries, nth);
  if (!(await realClick(page, first))) throw new Error(`could not click "${label}"`);
  await new Promise((r) => setTimeout(r, 1200));

  for (const step of REF_STEPS[screenId] ?? []) { await runStep(page, step); await new Promise((r) => setTimeout(r, 600)); }
  if (['notes-slash', 'notes-mention', 'notes-db-new', 'notes-db', 'notes-db-menu', 'notes-db-board', 'notes-db-linked'].includes(screenId)) {
    // These menus hang off the note's last line, below the fold: scroll every scroller to its end.
    await page.evaluate(() => document.querySelectorAll('*').forEach((el) => {
      if (el.scrollHeight > el.clientHeight + 50 && getComputedStyle(el).overflowY !== 'visible') el.scrollTop = el.scrollHeight;
    }));
    await new Promise((r) => setTimeout(r, 400));
  }
  const out = join(SHOTS, `${screenId}.ref.png`);
  await page.screenshot({ path: out });
  if (args.includes('--dump')) writeFileSync(`/tmp/hitlist-dump-${screenId}.ref.json`, JSON.stringify(await dumpDom(page)));
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
  if (route.notes) {
    // Notes read from localStorage first (useNotes), so copy the seeded server notes into it and reload.
    await page.evaluate(async () => {
      const notes = await (await fetch('/api/notes', { credentials: 'include' })).json();
      localStorage.setItem('kaizen-notes-v1', JSON.stringify(notes.map((n) => ({ ...n, blocks: JSON.parse(n.blocksJson || '[]') }))));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 1400));
  }

  const clickText = (text) => runStep(page, text);
  if (route.nav) { await clickText(route.nav); await new Promise((r) => setTimeout(r, 900)); }
  if (route.tab) { await clickText(route.tab); await new Promise((r) => setTimeout(r, 800)); }
  for (const t of route.then ?? []) { await clickText(t); await new Promise((r) => setTimeout(r, 800)); }
  if (route.focusLast) {
    // Focus the last note block (an empty paragraph) and type into it, leaving any menu it opens showing.
    await page.evaluate((sel) => { const all = document.querySelectorAll(sel); all[all.length - 1]?.focus(); }, route.focusLast);
    await new Promise((r) => setTimeout(r, 300));
    if (route.keys) await page.keyboard.type(route.keys, { delay: 60 });
    await new Promise((r) => setTimeout(r, 700));
  }
  if (route.type) {
    const [label, text] = route.type;
    await page.type(`[aria-label="${label}"]`, text);
    await new Promise((r) => setTimeout(r, 500));
    await page.keyboard.press('Escape'); // close the popover the field lives in
    await new Promise((r) => setTimeout(r, 500));
  }

  // --eval='<js>' runs in the app page once the route has run, and prints the result.
  const evalArg = args.find((a) => a.startsWith('--eval='));
  if (evalArg) console.log('eval:', JSON.stringify(await page.evaluate(evalArg.slice('--eval='.length))));

  const out = join(SHOTS, `${screenId}.app.png`);
  await page.screenshot({ path: out });
  if (args.includes('--dump')) writeFileSync(`/tmp/hitlist-dump-${screenId}.app.json`, JSON.stringify(await dumpDom(page)));
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
