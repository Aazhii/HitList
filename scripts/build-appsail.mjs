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
 *   server/             run directly via Node's native type stripping
 *   dist/               the built frontend, served from the same origin
 *
 * Dropping vitest also sidesteps the npm 10 arborist crash entirely, rather
 * than relying on the lockfile to route around it.
 *
 *   node scripts/build-appsail.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

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
// Copy only the TypeScript the server actually runs. Without this the bundle
// also carried server/pom.xml, server/README.md and the whole server/src Java
// tree, plus the JSON-file store's local data.
fs.cpSync(path.join(ROOT, 'server'), path.join(OUT, 'server'), {
  recursive: true,
  filter: (src) => fs.statSync(src).isDirectory() || src.endsWith('.ts'),
});

const slim = {
  name: `${pkg.name}-appsail`,
  private: true,
  version: pkg.version,
  type: 'module',
  // Node 23.6+ strips types natively, so no transpiler ships to production.
  engines: { node: '>=23.6' },
  dependencies: Object.fromEntries(RUNTIME_DEPS.map((d) => [d, pkg.dependencies[d]])),
};
fs.writeFileSync(path.join(OUT, 'package.json'), `${JSON.stringify(slim, null, 2)}\n`);

// ── Lock the slim tree ───────────────────────────────────────────────────────

console.log('[appsail] resolving the production lockfile...');
execFileSync('npm', ['install', '--package-lock-only', '--no-audit', '--no-fund'], {
  cwd: OUT,
  stdio: ['ignore', 'ignore', 'inherit'],
});

const lock = JSON.parse(fs.readFileSync(path.join(OUT, 'package-lock.json'), 'utf8'));
console.log(
  `[appsail] build/ ready — ${RUNTIME_DEPS.length} direct dependencies, ` +
  `${Object.keys(lock.packages ?? {}).length - 1} packages locked`
);
console.log('[appsail] deploy with: catalyst deploy appsail --name <service-name>');
