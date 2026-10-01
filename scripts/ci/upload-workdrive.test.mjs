import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { filesToUpload, hostsFor, missingSettings } from './upload-workdrive.mjs';

test('picks the right Zoho hosts for each data centre, and refuses anything else', () => {
  assert.deepEqual(hostsFor('in'), { accounts: 'https://accounts.zoho.in', api: 'https://www.zohoapis.in' });
  assert.equal(hostsFor('com').api, 'https://www.zohoapis.com');
  assert.equal(hostsFor('com.au').accounts, 'https://accounts.zoho.com.au');
  assert.throws(() => hostsFor('evil.example/'), /WORKDRIVE_DC/);
});

test('names exactly which settings are missing', () => {
  assert.deepEqual(missingSettings({}), ['WORKDRIVE_CLIENT_ID', 'WORKDRIVE_CLIENT_SECRET', 'WORKDRIVE_REFRESH_TOKEN', 'WORKDRIVE_FOLDER_ID']);
  assert.deepEqual(missingSettings({ WORKDRIVE_CLIENT_ID: 'a', WORKDRIVE_CLIENT_SECRET: ' ', WORKDRIVE_REFRESH_TOKEN: 'c', WORKDRIVE_FOLDER_ID: 'd' }), ['WORKDRIVE_CLIENT_SECRET']);
  assert.deepEqual(missingSettings({ WORKDRIVE_CLIENT_ID: 'a', WORKDRIVE_CLIENT_SECRET: 'b', WORKDRIVE_REFRESH_TOKEN: 'c', WORKDRIVE_FOLDER_ID: 'd' }), []);
});

test('uploads only regular files from the folder, sorted, never hidden ones or folders', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wd-'));
  await writeFile(path.join(dir, 'b.exe'), 'x'); await writeFile(path.join(dir, 'a.dmg'), 'x'); await writeFile(path.join(dir, '.hidden'), 'x');
  await mkdir(path.join(dir, 'sub'));
  assert.deepEqual((await filesToUpload(dir)).map((f) => path.basename(f)), ['a.dmg', 'b.exe']);
});

test('a dry run lists what it would upload and needs no settings', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wd-'));
  await writeFile(path.join(dir, 'HitList-1.1.5-x64.AppImage'), '12345');
  const out = execFileSync('node', [new URL('./upload-workdrive.mjs', import.meta.url).pathname, dir, '--dry-run'], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
  assert.match(out, /would upload HitList-1\.1\.5-x64\.AppImage \(5 bytes\)/);
});

test('without settings a real run stops and says what to add', () => {
  assert.throws(() => execFileSync('node', [new URL('./upload-workdrive.mjs', import.meta.url).pathname, os.tmpdir()], { env: { PATH: process.env.PATH }, stdio: 'pipe' }), (e) => /Missing settings: WORKDRIVE_CLIENT_ID/.test(String(e.stderr)));
});
