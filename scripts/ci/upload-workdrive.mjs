#!/usr/bin/env node
/**
 * Uploads the build files to Zoho WorkDrive, for the "Build desktop apps" workflow. Each platform's files go into that
 * platform's own subfolder of the WorkDrive folder (the folder holds subfolders called mac, linux and windows; the match is by
 * name, ignoring case, so "1. Mac" works). Uses WorkDrive's REST API with a refresh token, so no one has to sign in.
 *
 * Settings, as environment variables:
 *   WORKDRIVE_CLIENT_ID, WORKDRIVE_CLIENT_SECRET, WORKDRIVE_REFRESH_TOKEN   an OAuth "Self Client" (docs/building/06-workdrive.md)
 *   WORKDRIVE_FOLDER_ID           the PARENT folder (the one that contains mac, linux and windows)
 *   WORKDRIVE_FOLDER_ID_MAC, _LINUX, _WINDOWS   (optional) a subfolder's id, if you do not want it found by name
 *   WORKDRIVE_DC (optional)       "in" (default), "com", "eu", "com.au" or "jp": the data centre your account is on
 *
 * Usage: node scripts/ci/upload-workdrive.mjs <folder> [--dry-run]
 *   <folder> holds one directory per platform, named like the workflow's artifacts: "...-mac", "...-windows", "...-linux".
 * It only ever adds files. A file whose name already exists in its folder is replaced (names carry the version, so each run's
 * files are new). It never deletes anything.
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

export const PLATFORMS = ['mac', 'windows', 'linux'];

/** Which platform an artifact directory belongs to ("HitList-1.1.57-ab12cd3-mac" is mac), or null. */
export function platformOf(dirName) {
  const m = /-(mac|windows|linux)$/i.exec(dirName);
  return m ? m[1].toLowerCase() : null;
}

/** The id of the subfolder for a platform among a folder's children, matched by name ("1. Mac" matches mac). */
export function pickSubfolder(children, platform) {
  const re = new RegExp(`(^|[^a-z])${platform}([^a-z]|$)`, 'i');
  const folders = children.filter((c) => c.attributes && (c.attributes.type === 'folder' || c.attributes.is_folder === true || c.attributes.is_folder === 'true'));
  const hit = folders.find((c) => re.test(String(c.attributes.name || '')));
  return hit ? String(hit.id) : null;
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

async function listChildren(folderId, token, hosts) {
  const out = [];
  for (let offset = 0; offset < 1000; offset += 50) {
    const url = `${hosts.api}/workdrive/api/v1/files/${encodeURIComponent(folderId)}/files?page%5Blimit%5D=50&page%5Boffset%5D=${offset}`;
    const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
    if (!res.ok) throw new Error(`Could not list the WorkDrive folder (${res.status}): ${(await res.text()).slice(0, 300)}`);
    const page = (await res.json()).data || [];
    out.push(...page);
    if (page.length < 50) break;
  }
  return out;
}

async function main() {
  const [root, ...flags] = process.argv.slice(2);
  if (!root) { console.error('usage: upload-workdrive.mjs <folder> [--dry-run]'); process.exit(2); }
  const dryRun = flags.includes('--dry-run');
  const missing = missingSettings(process.env);
  if (missing.length && !dryRun) { console.error(`Missing settings: ${missing.join(', ')}. See docs/building/06-workdrive.md.`); process.exit(2); }

  const groups = [];
  for (const entry of (await readdir(root)).sort()) {
    const platform = platformOf(entry);
    if (platform && (await stat(path.join(root, entry))).isDirectory()) groups.push({ platform, dir: path.join(root, entry), files: await filesToUpload(path.join(root, entry)) });
  }
  if (groups.length === 0 || groups.every((g) => g.files.length === 0)) { console.error(`No platform folders with files in ${root} (expected names ending -mac, -windows, -linux)`); process.exit(1); }
  if (dryRun) {
    for (const g of groups) for (const f of g.files) console.log(`would upload ${path.basename(f)} (${(await stat(f)).size} bytes) to the ${g.platform} folder`);
    return;
  }

  const hosts = hostsFor(process.env.WORKDRIVE_DC || 'in');
  const token = await accessToken(process.env, hosts);
  const children = await listChildren(process.env.WORKDRIVE_FOLDER_ID, token, hosts);
  for (const g of groups) {
    const folderId = process.env[`WORKDRIVE_FOLDER_ID_${g.platform.toUpperCase()}`] || pickSubfolder(children, g.platform);
    if (!folderId) throw new Error(`No "${g.platform}" folder found inside the WorkDrive folder (set WORKDRIVE_FOLDER_ID_${g.platform.toUpperCase()} to its id, or create a folder with that name)`);
    for (const file of g.files) {
      process.stdout.write(`uploading ${path.basename(file)} to ${g.platform} ... `);
      await upload(file, token, hosts, folderId);
      console.log('done');
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
