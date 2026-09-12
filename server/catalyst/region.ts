/**
 * Points the Catalyst SDK at the right data centre.
 *
 * MUST be imported before zcatalyst-sdk-node. The SDK resolves its API host
 * once, at module load, from X_ZOHO_CATALYST_CONSOLE_URL (defaulting to the US
 * endpoint), so setting that variable later has no effect.
 *
 * This is not optional detail. Catalyst is partitioned by region and a token
 * minted in one data centre is rejected by another — with
 * `401 Authentication failed`, which reads like a credential problem rather
 * than a routing one. This project lives in `in`.
 *
 * Note that passing `project_domain` to initializeApp does NOT control the
 * request host; it is used for JWT exchange only. The env var is the only lever.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { endpointsFor, isDataCentre } from './dc.ts';

/** The data centre `catalyst login` last used, if the CLI is installed. */
function dataCentreFromCli(): string | null {
  const candidates = [
    path.join(os.homedir(), 'Library/Preferences/zcatalyst-cli-nodejs/zcatalyst-cli-v1.json'),
    path.join(os.homedir(), '.config/zcatalyst-cli-nodejs/zcatalyst-cli-v1.json'),
    path.join(process.env['APPDATA'] ?? '', 'zcatalyst-cli-nodejs/Config/zcatalyst-cli-v1.json'),
  ];
  for (const p of candidates) {
    if (!p || !fs.existsSync(p)) continue;
    try {
      const dc = String((JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>)['active_dc'] ?? '');
      if (isDataCentre(dc)) return dc;
    } catch { /* fall through */ }
  }
  return null;
}

export function applyRegion(): { dataCentre: string; consoleUrl: string } {
  // An explicit override always wins — it is how you pin a region in CI or in
  // a deployment that has no CLI.
  const explicit = process.env['X_ZOHO_CATALYST_CONSOLE_URL'];
  const dc = (process.env['CATALYST_DC'] ?? '').trim() || dataCentreFromCli() || 'us';
  const { console: consoleUrl, accounts } = endpointsFor(dc);

  if (!explicit) process.env['X_ZOHO_CATALYST_CONSOLE_URL'] = consoleUrl;
  if (!process.env['X_ZOHO_CATALYST_ACCOUNTS_URL']) process.env['X_ZOHO_CATALYST_ACCOUNTS_URL'] = accounts;

  return { dataCentre: dc, consoleUrl: process.env['X_ZOHO_CATALYST_CONSOLE_URL'] as string };
}

// Applied on import, before the SDK is loaded.
export const REGION = applyRegion();
