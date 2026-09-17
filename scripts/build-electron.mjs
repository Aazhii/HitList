/**
 * Bundles the Electron shell and the server it launches into electron/dist/,
 * as plain, dependency-free CommonJS.
 *
 * Four entry points, each self-contained (esbuild bundles every npm
 * dependency in, not just the app's own files) so the packaged app needs no
 * node_modules at all — Electron itself supplies the `electron` module, and
 * everything else (express, cors, zcatalyst-sdk-node, …) is inlined:
 *
 *   main.cjs             Electron main process
 *   preload.cjs          the (minimal) preload script
 *   server.cjs           server/notes-server.ts, compiled — what main.cjs
 *                        spawns in production (see electron/main.ts)
 *   reminder-sweep.cjs   the standalone LaunchAgent runner (see
 *                        electron/launchAgent.ts and reminder-sweep.ts)
 *
 * server.cjs and reminder-sweep.ts were written as ESM and use
 * `import.meta.url` (for __dirname-equivalents and createRequire). CJS output
 * has no import.meta, so esbuild's `define` + `banner` below replace it with
 * an equivalent computed from Node's own __filename — the standard shim for
 * bundling ESM sources to CJS.
 *
 * Usage: node scripts/build-electron.mjs
 * (run automatically by `pnpm run electron:build`, which also runs `pnpm
 * build` first so dist/ — the Vite output the server serves — exists)
 */
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'electron', 'dist');

function fail(message) {
  console.error(`\n[electron-build] ${message}\n`);
  process.exit(1);
}

if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
  fail('dist/index.html is missing. Run `pnpm build` first.');
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const IMPORT_META_SHIM = {
  define: { 'import.meta.url': 'importMetaUrl' },
  banner: { js: 'const importMetaUrl = require("url").pathToFileURL(__filename).href;' },
};

const targets = [
  {
    name: 'main',
    entry: path.join(ROOT, 'electron', 'main.ts'),
    out: path.join(OUT, 'main.cjs'),
    external: ['electron'],
  },
  {
    name: 'preload',
    entry: path.join(ROOT, 'electron', 'preload.ts'),
    out: path.join(OUT, 'preload.cjs'),
    external: ['electron'],
  },
  {
    name: 'server',
    entry: path.join(ROOT, 'server', 'notes-server.ts'),
    out: path.join(OUT, 'server.cjs'),
    external: [],
    ...IMPORT_META_SHIM,
  },
  {
    name: 'reminder-sweep',
    entry: path.join(ROOT, 'electron', 'reminder-sweep.ts'),
    out: path.join(OUT, 'reminder-sweep.cjs'),
    external: [],
    ...IMPORT_META_SHIM,
  },
];

for (const target of targets) {
  console.log(`[electron-build] bundling ${target.name}...`);
  await build({
    entryPoints: [target.entry],
    outfile: target.out,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: target.external,
    define: target.define,
    banner: target.banner,
    sourcemap: 'inline',
    logLevel: 'warning',
  });
}

for (const target of targets) {
  if (!fs.existsSync(target.out)) fail(`${target.name} did not produce ${target.out}`);
}

// The built frontend joins the bundled server IN THE SAME directory, not
// alongside it — because DIST_DIR in server/notes-server.ts resolves
// `path.join(__dirname, '..', 'dist')` first, and server.cjs's own __dirname
// here IS electron/dist (its basename already "dist"), so "../dist" resolves
// straight back to electron/dist itself. Putting dist/'s contents directly in
// electron/dist satisfies that lookup with no change to notes-server.ts,
// exactly as the appsail bundle satisfies its own second candidate
// (`__dirname/dist`) by placing dist/ next to server.js in build/.
console.log('[electron-build] copying the built frontend into electron/dist...');
fs.cpSync(path.join(ROOT, 'dist'), OUT, { recursive: true });
if (!fs.existsSync(path.join(OUT, 'index.html'))) {
  fail('electron/dist/index.html is missing after copying dist/ — the frontend build did not produce it.');
}

const sizes = targets
  .map((t) => `${t.name} ${(fs.statSync(t.out).size / 1024).toFixed(0)}kB`)
  .join(', ');
console.log(`[electron-build] electron/dist/ ready — ${sizes}`);
