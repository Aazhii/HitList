#!/usr/bin/env node
/**
 * design:check — conformance against the design system.
 *
 * The migration to `HitList Notion x Zoho.dc.html` failed twice before because
 * "matches the design" was a judgement call. This turns it into a number.
 *
 * Every rule below is a closed set taken from docs/design-migration/CONVENTIONS.md,
 * which in turn quotes the Zoho DataPrep design system and the showcase's own
 * `:root`. Nothing here is a preference.
 *
 *   node scripts/design-check.mjs              all rules, summary table
 *   node scripts/design-check.mjs --list       every violation with file:line
 *   node scripts/design-check.mjs --rule=radius
 *
 * Exits non-zero when any rule has violations.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

// ── the closed sets ─────────────────────────────────────────────────────────
const FONT_SIZES = new Set([11, 12, 13, 14, 16, 18, 20, 24, 32]);
const RADII = new Set([3, 4, 6, 8, 12]);
const DURATIONS = new Set([120, 180, 260]);
const STROKE = '1.75';
const WRONG_ACCENT = /#2383e2/i;

/**
 * `rounded-full` is correct on exactly four things (CONVENTIONS.md section 4):
 * tags, toggles, avatars and status dots — plus progress tracks, which the
 * showcase itself draws at border-radius:99px. Everything else is 4/6/8/12.
 * A line qualifies by looking like one of those, not by which file it is in.
 */
const PILL_OK = [
  /\bsize-\[?[0-9.]+(px)?\]?\b(?![^"'`]*\bpx-)/, // a square: dot, avatar, icon bubble
  /\b(h|w)-(full|1|1\.5|2|2\.5|3)\b/,            // hairline tracks
  /\banimate-ping\b/,
  /aspect-square/,
  /peer|switch|scrollbar|thumb/i,
];
const PILL_OK_FILES = [/ui\/avatar\.tsx$/, /ui\/switch\.tsx$/, /ui\/scroll-area\.tsx$/,
                       /ui\/progress\.tsx$/, /ui\/badge\.tsx$/, /MomentumBar\.tsx$/];

// ── rules ───────────────────────────────────────────────────────────────────
const RULES = {
  'font-size': {
    why: `text-[Npx] outside {${[...FONT_SIZES].join(',')}}`,
    scan: (line) => [...line.matchAll(/text-\[([0-9.]+)px\]/g)]
      .filter((m) => !FONT_SIZES.has(Number(m[1])))
      .map((m) => m[0]),
  },
  radius: {
    why: `rounded-[Npx] outside {${[...RADII].join(',')}}, or rounded-2xl/3xl/4xl`,
    scan: (line) => [
      ...[...line.matchAll(/rounded-(?:[a-z]+-)?\[([0-9.]+)px\]/g)]
        .filter((m) => !RADII.has(Number(m[1]))).map((m) => m[0]),
      ...[...line.matchAll(/rounded-(?:[a-z]+-)?(2xl|3xl|4xl)\b/g)].map((m) => m[0]),
    ],
  },
  pill: {
    why: 'rounded-full on something that is not a tag, toggle, avatar, dot or track',
    scan: (line, file) => {
      if (!line.includes('rounded-full')) return [];
      if (PILL_OK_FILES.some((r) => r.test(file))) return [];
      if (PILL_OK.some((r) => r.test(line))) return [];
      return ['rounded-full'];
    },
  },
  stroke: {
    why: `strokeWidth != ${STROKE}`,
    scan: (line) => [...line.matchAll(/strokeWidth=\{([0-9.]+)\}/g)]
      .filter((m) => m[1] !== STROKE).map((m) => m[0]),
  },
  motion: {
    why: `duration outside {${[...DURATIONS].join(',')}}ms`,
    scan: (line) => [
      ...[...line.matchAll(/duration-\[([0-9.]+)ms\]/g)]
        .filter((m) => !DURATIONS.has(Number(m[1]))).map((m) => m[0]),
      ...[...line.matchAll(/\bduration-([0-9]+)\b/g)].map((m) => m[0]), // bare = Tailwind's scale
    ],
  },
  accent: {
    why: 'the wrong blue — #2383e2 is Notion, the design is #006EB9',
    scan: (line) => (WRONG_ACCENT.test(line) ? ['#2383e2'] : []),
  },
  colour: {
    why: 'hex literal outside index.css — colours belong to a token',
    scan: (line, file) => {
      if (file.endsWith('index.css')) return [];
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return [];      // a comment naming a value
      return [...line.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0]);
    },
  },
};

// ── walk ────────────────────────────────────────────────────────────────────
function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(tsx?|css)$/.test(p)) yield p;
  }
}

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--rule='))?.slice('--rule='.length);
const list = args.includes('--list');
const active = only ? { [only]: RULES[only] } : RULES;
if (only && !RULES[only]) {
  console.error(`unknown rule "${only}". known: ${Object.keys(RULES).join(', ')}`);
  process.exit(2);
}

/**
 * A line may opt out with a trailing `design-check-ignore: <rule> — <reason>`.
 * The reason is required: the point is that a deviation is recorded, not that
 * it is silenced. Use it only where the design itself disagrees with the rule.
 */
const IGNORE = /design-check-ignore:\s*([a-z-]+)\s*[—-]\s*\S/;

const found = Object.fromEntries(Object.keys(active).map((k) => [k, []]));
for (const file of files(SRC)) {
  const rel = relative(ROOT, file);
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    // an ignore may sit on the line itself or on the line above it
    const waiver = IGNORE.exec(line) ?? IGNORE.exec(lines[i - 1] ?? '');
    for (const [name, rule] of Object.entries(active)) {
      if (waiver && waiver[1] === name) continue;
      for (const hit of rule.scan(line, rel)) {
        found[name].push({ where: `${rel}:${i + 1}`, hit });
      }
    }
  });
}

console.log('design:check');
let total = 0;
for (const [name, hits] of Object.entries(found)) {
  total += hits.length;
  const n = String(hits.length).padStart(4);
  console.log(`  ${name.padEnd(11)}${n}${hits.length ? '  — ' + active[name].why : ''}`);
  if (list && hits.length) {
    for (const h of hits) console.log(`      ${h.where}  ${h.hit}`);
  }
}
console.log('  ---');
console.log(total === 0 ? '  PASS' : `  FAIL  ${total} total`);
if (total && !list) console.log('\n  re-run with --list to see every file:line');
process.exit(total === 0 ? 0 : 1);
