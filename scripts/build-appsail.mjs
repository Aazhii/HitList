/**
 * Stages a minimal production bundle for Catalyst AppSail in build/.
 *
 * Pointing AppSail's build_path at the repo root would upload ~310MB — mostly
 * node_modules and .git — and then install all 43 direct dependencies,
 * including vite, vitest and typescript, none of which production runs.
 *
 * The server needs exactly three runtime packages (express, cors,
 * zcatalyst-sdk-node) plus the built frontend, so the bundle contains:
 *
 *   package.json        slim: runtime dependencies only
 *   package-lock.json   generated to match, so the deploy install is
 *                       deterministic and never re-resolves
 *   server.js           the server compiled to plain JavaScript
 *   dist/               the built frontend, served from the same origin
 *
 * The server ships as compiled JS rather than TypeScript. Running
 * `node server/notes-server.ts` works locally on Node 24, which strips types
 * natively, but it makes the deployment depend on the platform's Node being
 * 23.6+ — and when that assumption is wrong the only symptom is AppSail's
 * "Execution failed. Please check the startup command or port." Compiling
 * removes the assumption: the bundle runs on any Node 18+.
 *
 * Dropping vitest also sidesteps the npm 10 arborist crash entirely, rather
 * than relying on the lockfile to route around it.
 *
 *   node scripts/build-appsail.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'build');

/** Packages the server imports at runtime. Keep in step with server/. */
const RUNTIME_DEPS = ['express', 'cors', 'zcatalyst-sdk-node'];

function fail(message) {
  console.error(`\n[appsail] ${message}\n`);
  process.exit(1);
}

// ── Preconditions ────────────────────────────────────────────────────────────

if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
  fail('dist/index.html is missing. Run `pnpm build` first (or `pnpm run build:appsail`).');
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const missing = RUNTIME_DEPS.filter((d) => !(d in (pkg.dependencies ?? {})));
if (missing.length) fail(`Runtime dependencies absent from package.json: ${missing.join(', ')}`);

// Guard against the server growing an import that the slim bundle would omit.
// Catches `from 'x'` and `require('x')` for bare specifiers.
const serverFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name.endsWith('.ts')) serverFiles.push(p);
  }
})(path.join(ROOT, 'server'));

const imported = new Set();
for (const file of serverFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/(?:from|require\()\s*['"]([^'"]+)['"]/g)) {
    const spec = m[1];
    if (spec.startsWith('.') || spec.startsWith('node:')) continue;
    // Reduce "pkg/sub/path" and "@scope/pkg/sub" to the package name.
    const parts = spec.split('/');
    imported.add(spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
  }
}
const unlisted = [...imported].filter((d) => !RUNTIME_DEPS.includes(d));
if (unlisted.length) {
  fail(
    `server/ imports package(s) the AppSail bundle would not install: ${unlisted.join(', ')}.\n` +
    `          Add them to RUNTIME_DEPS in scripts/build-appsail.mjs (and to\n` +
    `          package.json dependencies, not devDependencies).`
  );
}

// ── Stage ────────────────────────────────────────────────────────────────────

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

fs.cpSync(path.join(ROOT, 'dist'), path.join(OUT, 'dist'), { recursive: true });

// Compile server/ into a single ESM file with the runtime packages left
// external, so node_modules still resolves them normally. Bundling also avoids
// having to rewrite the .ts import specifiers that Node requires but tsc
// cannot emit.
console.log('[appsail] compiling the server...');
await build({
  entryPoints: [path.join(ROOT, 'server', 'notes-server.ts')],
  outfile: path.join(OUT, 'server.js'),
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  packages: 'external',
  sourcemap: 'inline',
  logLevel: 'warning',
});

// AppSail treats the *source* directory as the app root: it expects
// package.json and the startup entry point at the top level, alongside
// app-config.json. Pointing source at the repo root put the container's
// working directory somewhere with no server.js, so `node server.js` failed
// with "Execution failed. Please check the startup command or port." — the
// same error whatever the app contained. The bundle is the app directory, so
// its config belongs here too.
fs.writeFileSync(
  path.join(OUT, 'app-config.json'),
  `${JSON.stringify({
    command: 'node server.js',
    build_path: '.',
    stack: 'node24',
    memory: 512,
    catalyst_auth: false,
    env_variables: {
      // CATALYST_-prefixed names are rejected by AppSail as reserved.
      APP_OWNER_ID: process.env['APPSAIL_OWNER_ID'] ?? 'hitlist-shared',
      // The Slate-hosted frontend is a different origin, so it needs an
      // explicit CORS allowance. The AppSail-hosted copy is same-origin and
      // does not.
      ALLOWED_ORIGINS: process.env['APPSAIL_ALLOWED_ORIGINS']
        ?? 'https://hitlist-kgewwunu.onslate.in,https://hitlist-eqrgelva.onslate.in,'
          + 'https://hitlist-api-50045863073.development.catalystappsail.in',
    },
  }, null, 2)}\n`
);

const slim = {
  name: `${pkg.name}-appsail`,
  private: true,
  version: pkg.version,
  type: 'module',
  // The server is compiled to ES2022-era JS targeting node18, so it does not
  // need a modern runtime. This previously demanded >=23.6, left over from
  // running the TypeScript directly — a stale constraint that an older stack
  // could reject at install time with EBADENGINE.
  engines: { node: '>=18' },
  dependencies: Object.fromEntries(RUNTIME_DEPS.map((d) => [d, pkg.dependencies[d]])),
};
fs.writeFileSync(path.join(OUT, 'package.json'), `${JSON.stringify(slim, null, 2)}\n`);

// ── Lock the slim tree ───────────────────────────────────────────────────────

// Vendor the dependencies into the bundle.
//
// AppSail does not run `npm install` on a managed Node runtime — it starts the
// uploaded directory as-is. A bundle with only package.json therefore crashes
// on `import express` the moment it boots, and the platform reports it as
// "Execution failed. Please check the startup command or port.", which points
// at the command rather than at the missing modules. The documented AppSail
// layout includes node_modules/ for exactly this reason.
console.log('[appsail] installing production dependencies...');
execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
  cwd: OUT,
  stdio: ['ignore', 'ignore', 'inherit'],
});

const lock = JSON.parse(fs.readFileSync(path.join(OUT, 'package-lock.json'), 'utf8'));
const bytes = fs.statSync(path.join(OUT, 'server.js')).size;
if (!fs.existsSync(path.join(OUT, 'node_modules', 'express'))) {
  fail('node_modules was not vendored into build/ — the deployed app would crash on startup.');
}
console.log(
  `[appsail] build/ ready — server.js ${(bytes / 1024).toFixed(0)}kB, ` +
  `${RUNTIME_DEPS.length} direct dependencies, ` +
  `${Object.keys(lock.packages ?? {}).length - 1} packages vendored`
);
console.log('[appsail] deploy with: catalyst deploy appsail --name <service-name>');
