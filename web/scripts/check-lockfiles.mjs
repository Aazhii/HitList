/**
 * Guards against the two lockfiles drifting apart.
 *
 * This repo carries both:
 *   pnpm-lock.yaml    — local development (packageManager is pinned to pnpm)
 *   package-lock.json — npm-based CI and container builds
 *
 * Two lockfiles is a smell, and the failure mode is nasty: add a dependency
 * with pnpm alone and the deploy silently installs the old tree, so what ships
 * is not what you tested. This compares each lockfile's recorded direct
 * dependencies against package.json and reports anything missing or mismatched.
 *
 *   node scripts/check-lockfiles.mjs
 *
 * After changing dependencies, refresh the npm lockfile with:
 *   pnpm run lock:npm
 */
import fs from 'node:fs';

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const pkg = read('package.json');

const declared = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
const problems = [];

// ── package-lock.json ────────────────────────────────────────────────────────
if (!fs.existsSync('package-lock.json')) {
  problems.push('package-lock.json is missing — npm-based builds run `npm install` and need it.');
} else {
  const lock = read('package-lock.json');
  const root = lock.packages?.[''] ?? {};
  const lockDeps = { ...(root.dependencies ?? {}), ...(root.devDependencies ?? {}) };

  for (const [name, range] of Object.entries(declared)) {
    if (!(name in lockDeps)) {
      problems.push(`package-lock.json does not know about ${name} (${range})`);
    } else if (lockDeps[name] !== range) {
      problems.push(`package-lock.json has ${name} at "${lockDeps[name]}", package.json says "${range}"`);
    }
  }
  for (const name of Object.keys(lockDeps)) {
    if (!(name in declared)) problems.push(`package-lock.json still lists removed dependency ${name}`);
  }
}

// ── pnpm-lock.yaml ───────────────────────────────────────────────────────────
// Parsed by pattern rather than with a YAML dependency: we only need the
// declared specifiers, which appear as `specifier: <range>` lines.
if (!fs.existsSync('pnpm-lock.yaml')) {
  problems.push('pnpm-lock.yaml is missing — local development uses pnpm.');
} else {
  const text = fs.readFileSync('pnpm-lock.yaml', 'utf8');
  const specifiers = new Map();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const name = /^\s{6}(\S+?):\s*$/.exec(lines[i]);
    const spec = /^\s{8}specifier:\s*(.+?)\s*$/.exec(lines[i + 1] ?? '');
    if (name && spec) specifiers.set(name[1].replace(/^'|'$/g, ''), spec[1].replace(/^'|'$/g, ''));
  }
  if (specifiers.size === 0) {
    problems.push('Could not read any specifiers from pnpm-lock.yaml — the format may have changed.');
  } else {
    for (const [name, range] of Object.entries(declared)) {
      if (!specifiers.has(name)) problems.push(`pnpm-lock.yaml does not know about ${name} (${range})`);
      else if (specifiers.get(name) !== range) {
        problems.push(`pnpm-lock.yaml has ${name} at "${specifiers.get(name)}", package.json says "${range}"`);
      }
    }
  }
}

if (problems.length) {
  console.error('Lockfiles are out of sync with package.json:\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nRefresh them with:  pnpm install  &&  pnpm run lock:npm\n');
  process.exit(1);
}

console.log(`Lockfiles agree with package.json (${Object.keys(declared).length} direct dependencies).`);
