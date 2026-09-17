/**
 * Constants the Electron main process, the LaunchAgent installer and the
 * standalone reminder-sweep runner all need to agree on. Kept in one place so
 * the app id used for packaging, the LaunchAgent's Label, and the database
 * path never drift from each other the way the schema used to (see the header
 * comment in server/catalyst/schema.ts for that history).
 */
import path from 'node:path';

/** Must match "appId" in electron-builder.yml. */
export const APP_ID = 'com.kaizen.hitlist';

/** Label for the background reminder-sweep LaunchAgent — see electron/launchAgent.ts. */
export const LAUNCH_AGENT_LABEL = `${APP_ID}.remindersweep`;

/** The database file, given the Electron app's userData directory. */
export function sqlitePathFor(userDataDir: string): string {
  return path.join(userDataDir, 'hitlist.sqlite');
}
