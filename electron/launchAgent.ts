/**
 * The macOS LaunchAgent that runs the reminder sweep while the app is closed.
 *
 * A LaunchAgent, not a LaunchDaemon: it must run as the signed-in user with
 * access to the same ~/Library/Application Support directory the app itself
 * writes to. A LaunchDaemon runs as root, before any user session exists, and
 * cannot see a per-user path at all.
 *
 * The agent's ProgramArguments invoke the packaged app's own executable with
 * ELECTRON_RUN_AS_NODE=1, so it needs no separate Node.js install on the
 * user's machine — the same binary that runs the GUI runs
 * electron/reminder-sweep.ts as plain Node here, with no window and no HTTP
 * server. See docs/desktop-app.md for the full design and its limits.
 *
 * Every path fed into the plist and every argument passed to `launchctl`
 * comes from this process's own on-disk locations (app.getPath, __dirname) —
 * never from user-supplied text — and `execFile` passes them as an argv
 * array, never through a shell, so there is no argument- or path-injection
 * surface here.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LAUNCH_AGENT_LABEL } from './shared.ts';

const execFileAsync = promisify(execFile);

function agentsDir(): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents');
}

function plistPath(): string {
  return path.join(agentsDir(), `${LAUNCH_AGENT_LABEL}.plist`);
}

function logDir(): string {
  return path.join(os.homedir(), 'Library', 'Logs', 'HitList');
}

/** `launchctl`'s per-user GUI domain — what a LaunchAgent bootstraps into. */
function guiDomain(): string {
  const uid = process.getuid?.() ?? os.userInfo().uid;
  return `gui/${uid}`;
}

export interface LaunchAgentConfig {
  /** Absolute path to the packaged app's own executable (process.execPath). */
  executablePath: string;
  /** Absolute path to the unpacked electron/dist/reminder-sweep.cjs. */
  scriptPath: string;
  /** Absolute path to the SQLite database — must match the running app's. */
  sqlitePath: string;
  /** Seconds between sweeps. Matches DEFAULT_INTERVAL_MS in notifications/scheduler.ts. */
  intervalSeconds?: number;
}

/** Escapes a value for inclusion in plist XML. Defence in depth: every value here is a filesystem path, not user text, but a stray "&" would otherwise produce an invalid plist. */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function renderPlist(config: LaunchAgentConfig): string {
  const interval = Math.max(60, Math.floor(config.intervalSeconds ?? 300));
  const stdout = path.join(logDir(), 'reminder-sweep.log');
  const stderr = path.join(logDir(), 'reminder-sweep.err.log');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(LAUNCH_AGENT_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(config.executablePath)}</string>
    <string>${xmlEscape(config.scriptPath)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ELECTRON_RUN_AS_NODE</key>
    <string>1</string>
    <key>KAIZEN_STORE</key>
    <string>sqlite</string>
    <key>KAIZEN_SQLITE_PATH</key>
    <string>${xmlEscape(config.sqlitePath)}</string>
  </dict>
  <key>StartInterval</key>
  <integer>${interval}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(stdout)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(stderr)}</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`;
}

/** Unloads the agent if loaded. Never throws — "not loaded" is the common case, not an error. */
async function safeUnload(): Promise<void> {
  try {
    await execFileAsync('launchctl', ['bootout', `${guiDomain()}/${LAUNCH_AGENT_LABEL}`]);
  } catch {
    // Not loaded — nothing to unload.
  }
}

/**
 * Writes the plist and loads it with `launchctl bootstrap`.
 *
 * Safe to call when already installed: the previous copy is unloaded first,
 * so re-running this after an app update refreshes the executable/script
 * paths rather than leaving a stale agent pointed at a deleted app bundle.
 */
export async function installLaunchAgent(config: LaunchAgentConfig): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('Background reminders use a macOS LaunchAgent and are unavailable on this platform.');
  }
  if (!fs.existsSync(config.executablePath)) {
    throw new Error(`App executable not found at ${config.executablePath}`);
  }
  if (!fs.existsSync(config.scriptPath)) {
    throw new Error(`Reminder-sweep script not found at ${config.scriptPath}`);
  }

  fs.mkdirSync(agentsDir(), { recursive: true });
  fs.mkdirSync(logDir(), { recursive: true });
  fs.writeFileSync(plistPath(), renderPlist(config), { mode: 0o644 });

  await safeUnload();
  await execFileAsync('launchctl', ['bootstrap', guiDomain(), plistPath()]);
}

/** Unloads the agent and removes its plist. Safe to call when never installed. */
export async function uninstallLaunchAgent(): Promise<void> {
  if (process.platform !== 'darwin') return;
  await safeUnload();
  try {
    fs.rmSync(plistPath(), { force: true });
  } catch {
    // Already gone.
  }
}

/** Whether the plist is currently on disk. Does not confirm launchd has it loaded — see launchAgentLoaded. */
export function launchAgentInstalled(): boolean {
  return fs.existsSync(plistPath());
}

/** Asks launchd directly whether the agent is loaded right now. */
export async function launchAgentLoaded(): Promise<boolean> {
  try {
    await execFileAsync('launchctl', ['print', `${guiDomain()}/${LAUNCH_AGENT_LABEL}`]);
    return true;
  } catch {
    return false;
  }
}
