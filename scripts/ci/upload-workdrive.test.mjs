import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { filesToUpload, hostsFor, missingSettings, pickSubfolder, platformOf } from './upload-workdrive.mjs';

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

test('knows which platform an artifact directory is for', () => {
  assert.equal(platformOf('HitList-1.1.57-ab12cd3-mac'), 'mac');
  assert.equal(platformOf('HitList-1.1.57-ab12cd3-WINDOWS'), 'windows');
  assert.equal(platformOf('HitList-1.1.57-ab12cd3-linux'), 'linux');
  assert.equal(platformOf('hitlist-jar'), null);
  assert.equal(platformOf('HitList-1.1.57-ab12cd3-macos'), null);
});

test('finds each platform folder by name, ignoring case and a number prefix, and never picks a file', () => {
  const kids = [
    { id: '1', attributes: { name: '1. Mac', type: 'folder' } },
    { id: '2', attributes: { name: 'Linux', type: 'folder' } },
    { id: '3', attributes: { name: 'windows builds', is_folder: true } },
    { id: '4', attributes: { name: 'mac-notes.txt', type: 'file' } },
    { id: '5', attributes: { name: 'Machines', type: 'folder' } },
  ];
  assert.equal(pickSubfolder(kids, 'mac'), '1');
  assert.equal(pickSubfolder(kids, 'linux'), '2');
  assert.equal(pickSubfolder(kids, 'windows'), '3');
  assert.equal(pickSubfolder([{ id: '9', attributes: { name: 'mac', type: 'file' } }], 'mac'), null);
  assert.equal(pickSubfolder([], 'mac'), null);
});

test('a dry run says which folder each file would go to, and needs no settings', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wd-'));
  for (const [dir, file] of [['HitList-1.1.5-aaa1111-mac', 'HitList-1.1.5-arm64.dmg'], ['HitList-1.1.5-aaa1111-linux', 'HitList-1.1.5-x64.AppImage'], ['hitlist-jar', 'hitlist.jar']]) {
    await mkdir(path.join(root, dir)); await writeFile(path.join(root, dir, file), '12345');
  }
  const out = execFileSync('node', [new URL('./upload-workdrive.mjs', import.meta.url).pathname, root, '--dry-run'], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
  assert.match(out, /would upload HitList-1\.1\.5-arm64\.dmg \(5 bytes\) to the mac folder/);
  assert.match(out, /would upload HitList-1\.1\.5-x64\.AppImage \(5 bytes\) to the linux folder/);
  assert.doesNotMatch(out, /hitlist\.jar/);
});

test('without settings a real run stops and says what to add', () => {
  assert.throws(() => execFileSync('node', [new URL('./upload-workdrive.mjs', import.meta.url).pathname, os.tmpdir()], { env: { PATH: process.env.PATH }, stdio: 'pipe' }), (e) => /Missing settings: WORKDRIVE_CLIENT_ID/.test(String(e.stderr)));
});
