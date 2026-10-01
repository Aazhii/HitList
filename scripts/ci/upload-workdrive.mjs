#!/usr/bin/env node
/**
 * Uploads every file in a folder to a Zoho WorkDrive folder, for the "Build desktop apps" workflow. Uses WorkDrive's REST API
 * (India data centre) with a refresh token, so no one has to sign in. Needs, as environment variables:
 *
 *   WORKDRIVE_CLIENT_ID, WORKDRIVE_CLIENT_SECRET, WORKDRIVE_REFRESH_TOKEN   an OAuth "Self Client" (see docs/building/06-workdrive.md)
 *   WORKDRIVE_FOLDER_ID                                                       the folder to upload into
 *   WORKDRIVE_DC (optional)    "in" (default), "com", "eu", "com.au" or "jp": the data centre your account is on
 *
 * Usage: node scripts/ci/upload-workdrive.mjs <folder-with-files> [--dry-run]
 * It only ever adds files. A file whose name already exists in the folder is replaced (the names carry the version, so
 * each run's files are new). It never deletes anything.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const REQUIRED = ['WORKDRIVE_CLIENT_ID', 'WORKDRIVE_CLIENT_SECRET', 'WORKDRIVE_REFRESH_TOKEN', 'WORKDRIVE_FOLDER_ID'];

/** The OAuth and API hosts for a data centre. */
export function hostsFor(dc = 'in') {
  if (!/^(in|com|eu|com\.au|jp)$/.test(dc)) throw new Error(`WORKDRIVE_DC must be in, com, eu, com.au or jp (got "${dc}")`);
  return { accounts: `https://accounts.zoho.${dc}`, api: `https://www.zohoapis.${dc}` };
}

/** Which required settings are missing (so the job can say exactly what to add instead of failing on a 401). */
export function missingSettings(env) {
  return REQUIRED.filter((name) => !String(env[name] || '').trim());
}

/** The files to upload: regular files directly inside the folder, in a stable order, skipping hidden files. */
export async function filesToUpload(dir) {
  const names = (await readdir(dir)).filter((n) => !n.startsWith('.')).sort();
  const out = [];
  for (const name of names) {
    const full = path.join(dir, name);
    if ((await stat(full)).isFile()) out.push(full);
  }
  return out;
}

async function accessToken(env, hosts) {
  const url = new URL(`${hosts.accounts}/oauth/v2/token`);
  url.search = new URLSearchParams({
    refresh_token: env.WORKDRIVE_REFRESH_TOKEN, client_id: env.WORKDRIVE_CLIENT_ID,
    client_secret: env.WORKDRIVE_CLIENT_SECRET, grant_type: 'refresh_token',
  }).toString();
  const res = await fetch(url, { method: 'POST' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`Could not get a WorkDrive access token (${res.status}): ${body.error || 'no token in the answer'}`);
  return body.access_token;
}

async function upload(file, token, hosts, folderId) {
  const form = new FormData();
  form.set('parent_id', folderId);
  form.set('override-name-exist', 'true');
  form.set('content', new Blob([await readFile(file)]), path.basename(file));
  const res = await fetch(`${hosts.api}/workdrive/api/v1/upload`, { method: 'POST', headers: { Authorization: `Zoho-oauthtoken ${token}` }, body: form });
  const text = await res.text();
  if (!res.ok) throw new Error(`Upload of ${path.basename(file)} failed (${res.status}): ${text.slice(0, 300)}`);
  return text;
}

async function main() {
  const [dir, ...flags] = process.argv.slice(2);
  if (!dir) { console.error('usage: upload-workdrive.mjs <folder> [--dry-run]'); process.exit(2); }
  const dryRun = flags.includes('--dry-run');
  const missing = missingSettings(process.env);
  if (missing.length && !dryRun) { console.error(`Missing settings: ${missing.join(', ')}. See docs/building/06-workdrive.md.`); process.exit(2); }
  const files = await filesToUpload(dir);
  if (files.length === 0) { console.error(`No files in ${dir}`); process.exit(1); }
  if (dryRun) { for (const f of files) console.log(`would upload ${path.basename(f)} (${(await stat(f)).size} bytes)`); return; }

  const hosts = hostsFor(process.env.WORKDRIVE_DC || 'in');
  const token = await accessToken(process.env, hosts);
  for (const file of files) {
    process.stdout.write(`uploading ${path.basename(file)} ... `);
    await upload(file, token, hosts, process.env.WORKDRIVE_FOLDER_ID);
    console.log('done');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
