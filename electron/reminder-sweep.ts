/**
 * The standalone reminder sweep — what the LaunchAgent runs while the app is
 * closed (see electron/launchAgent.ts).
 *
 * Deliberately minimal: opens the same SQLite file the running app uses, runs
 * exactly one sweep tick, fires a best-effort native banner for anything it
 * delivers, and exits. No HTTP server, no Electron APIs, no window — this
 * runs under `ELECTRON_RUN_AS_NODE=1`, i.e. as plain Node, so nothing here
 * may import the `electron` module.
 *
 * Known gap, documented rather than papered over (see docs/desktop-app.md):
 * on the SQLite backend, email and web-push channels are unavailable (see
 * server/store/sqlite.ts's `app.email()`/`app.pushNotification()`), so a
 * closed-app sweep can only deliver in-app (written to KaizenNotifications,
 * shown next time the app opens) plus this local `osascript` banner. There is
 * no cross-device delivery and no click-to-open action on the banner.
 */
import { execFile } from 'node:child_process';
import { createSqliteStore } from '../server/store/sqlite.ts';
import { runSweep, describeSweep } from '../server/notifications/sweep.ts';
import type { QueueRow } from '../server/notifications/queue.ts';

function sqlitePathFromEnv(): string {
  const raw = (process.env['KAIZEN_SQLITE_PATH'] ?? '').trim();
  if (!raw) {
    throw new Error(
      'KAIZEN_SQLITE_PATH is required. This script is meant to be run by the ' +
      'LaunchAgent installed from the app (Enable Background Reminders…), which ' +
      'always sets it — see electron/launchAgent.ts.',
    );
  }
  return raw;
}

/**
 * AppleScript string-literal escaping for the -e argument to `osascript`.
 *
 * `execFile` passes ['-e', script] as an argv array with no shell involved,
 * so there is no shell-injection surface; this escaping exists only so a
 * title/body containing a quote or backslash cannot break out of the
 * AppleScript string it sits inside.
 */
function appleScriptString(value: string): string {
  // Deliberately stripping raw control bytes (not just \n) so a title/body
  // can't smuggle unusual characters into the AppleScript source passed to
  // osascript.
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f]/g, ' ');
  return `"${cleaned.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Best-effort native banner. This is a bonus, not the delivery mechanism —
 * the KaizenNotifications row written by the `inapp` channel is what the bell
 * shows once the app is next opened. Any failure here (osascript missing,
 * notifications disabled in System Settings, non-macOS) is swallowed.
 */
function showNativeNotification(row: QueueRow): void {
  if (process.platform !== 'darwin') return;
  const title = row.title || 'HitList';
  const body = row.body || 'You have a reminder.';
  const script = `display notification ${appleScriptString(body)} with title ${appleScriptString(title)}`;
  try {
    execFile('osascript', ['-e', script], () => { /* best-effort; ignore outcome */ });
  } catch {
    // osascript unavailable or blocked — the in-app row still exists.
  }
}

async function main(): Promise<void> {
  const sqlitePath = sqlitePathFromEnv();
  const store = createSqliteStore(sqlitePath);
  try {
    const report = await runSweep(store.app, { onDelivered: showNativeNotification });
    console.log(`[reminder-sweep] ${describeSweep(report)}`);
  } finally {
    store.close();
  }
}

main().catch((error) => {
  console.error('[reminder-sweep] failed:', error);
  process.exitCode = 1;
});
