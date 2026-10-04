'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { winScript, linuxScript } = require('./installer');

async function waitForFile(file) {
  const deadline = Date.now() + 5_000;
  while (!fs.existsSync(file)) {
    if (Date.now() > deadline) throw new Error('Update helper did not relaunch the app');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test('Windows executes its helper with spaces and exclamation marks and passes the install directory', { skip: process.platform !== 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hitlist update ! path-'));
  try {
    const installer = path.join(dir, 'Setup.cmd');
    const app = path.join(dir, 'HitList.cmd');
    const args = path.join(dir, 'arguments.txt');
    const marker = path.join(dir, 'launched.txt');
    fs.writeFileSync(installer, `@echo off\r\nsetlocal disabledelayedexpansion\r\necho %*>"${args}"\r\nexit 0\r\n`);
    fs.writeFileSync(app, `@echo off\r\nsetlocal disabledelayedexpansion\r\necho launched>"${marker}"\r\nexit 0\r\n`);
    const helper = path.join(dir, 'swap.cmd');
    fs.writeFileSync(helper, winScript({ pid: 99999999, installer, app }));
    execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${helper}"`], { windowsVerbatimArguments: true, timeout: 15_000, stdio: 'pipe' });
    await waitForFile(marker);
    assert.equal(fs.readFileSync(args, 'utf8').trim(), `/S /D=${dir}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Linux executes its replacement helper and relaunches the new file', { skip: process.platform !== 'linux' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hitlist update path-'));
  try {
    const appImage = path.join(dir, 'HitList.AppImage');
    const staged = path.join(dir, '.HitList.AppImage.new');
    const marker = path.join(dir, 'launched.txt');
    fs.writeFileSync(appImage, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    fs.writeFileSync(staged, `#!/bin/sh\nprintf new > '${marker}'\n`, { mode: 0o700 });
    const helper = path.join(dir, 'swap.sh');
    fs.writeFileSync(helper, linuxScript({ pid: 99999999, appImage, staged }));
    execFileSync('/bin/sh', [helper], { timeout: 15_000, stdio: 'pipe' });
    await waitForFile(marker);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'new');
    assert.ok(!fs.existsSync(staged));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});