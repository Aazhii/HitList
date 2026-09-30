#!/usr/bin/env node
/**
 * Diff the DOM dumps `shoot.mjs --dump` writes for one screen: matches prototype
 * (ref) and app elements by their text, and prints every pair whose position,
 * size, font or colour differ. Positions are compared relative to the content
 * column when --rel is given; otherwise absolute (same 1440x900 viewport).
 *   node tools/cmp.mjs tasks-table [--tol=1.5] [--all]
 * Text that only one side has is listed separately — copy or structure gaps.
 */
import { readFileSync } from 'node:fs';
const id = process.argv[2];
const tol = Number((process.argv.find((a) => a.startsWith('--tol=')) ?? '--tol=1.5').slice(6));
const load = (side) => JSON.parse(readFileSync(`/tmp/hitlist-dump-${id}.${side}.json`, 'utf8'));
const ref = load('ref'); const app = load('app');
const key = (e) => `${e.tag === 'button' || e.tag === 'input' ? 'c' : 't'}:${e.text}`;
const bucket = (list) => { const m = new Map(); for (const e of list) { const k = key(e); if (!m.has(k)) m.set(k, []); m.get(k).push(e); } return m; };
const R = bucket(ref), A = bucket(app);
const rows = []; const onlyRef = []; const onlyApp = [];
for (const [k, rs] of R) {
  if (!k.slice(2)) continue;
  const as = A.get(k);
  if (!as) { onlyRef.push(k.slice(2)); continue; }
  rs.forEach((r, i) => {
    const a = as[i]; if (!a) return;
    const d = [];
    // Text is an inline box whose height is line-height noise: compare its left edge
    // and vertical centre. Controls and boxes compare their real rectangle.
    const ctl = r.tag === 'button' || r.tag === 'input' || r.tag === 'img' || r.tag === 'svg';
    const cyR = r.y + r.h / 2, cyA = a.y + a.h / 2;
    if (Math.abs(r.x - a.x) > tol) d.push(`x ${r.x}→${a.x}`);
    if (Math.abs(cyR - cyA) > tol) d.push(`cy ${cyR.toFixed(1)}→${cyA.toFixed(1)}`);
    if (ctl) for (const f of ['w', 'h']) if (Math.abs(r[f] - a[f]) > tol) d.push(`${f} ${r[f]}→${a[f]}`);
    for (const f of ['fs', 'fw', 'color', 'ls']) if (r[f] !== a[f]) d.push(`${f} ${r[f]}→${a[f]}`);
    if (d.length) rows.push(`${JSON.stringify(r.text)}  ${d.join(' · ')}`);
  });
}
for (const [k] of A) if (k.slice(2) && !R.has(k)) onlyApp.push(k.slice(2));
console.log(`== ${rows.length} differing elements (tol ${tol}px)`); console.log(rows.join('\n'));
console.log(`\n== only in prototype (${onlyRef.length})`); console.log(onlyRef.join(' | '));
console.log(`\n== only in app (${onlyApp.length})`); console.log(onlyApp.join(' | '));
