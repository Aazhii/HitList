/**
 * Borrows the Catalyst CLI's own login so local tooling needs no second set of
 * credentials.
 *
 * `catalyst login` stores an encrypted OAuth grant in the CLI's config
 * directory, not in a readable ~/.catalystrc — so reading that file (as an
 * earlier version of the setup script did) finds nothing. The CLI ships the
 * module that decrypts it and exchanges it for an access token; we call that
 * rather than reimplementing the crypto.
 *
 * This is best-effort by design: it reaches into another package's internals,
 * so it is wrapped and returns null on any change. Explicit CATALYST_*
 * credentials always take precedence, and the caller falls back to them.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

export interface CliCredentials {
  accessToken: string;
  dataCentre: string;
}

/** Where the CLI keeps its config, per platform. */
function configPaths(): string[] {
  const home = os.homedir();
  return [
    path.join(home, 'Library/Preferences/zcatalyst-cli-nodejs/zcatalyst-cli-v1.json'), // macOS
    path.join(home, '.config/zcatalyst-cli-nodejs/zcatalyst-cli-v1.json'),             // Linux
    path.join(process.env['APPDATA'] ?? '', 'zcatalyst-cli-nodejs/Config/zcatalyst-cli-v1.json'), // Windows
  ];
}

function globalNodeModules(): string | null {
  try {
    return execFileSync('npm', ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/**
 * Returns an access token from the CLI's stored login, or null if the CLI is
 * not installed, not logged in, or has changed shape.
 */
export async function accessTokenFromCli(): Promise<CliCredentials | null> {
  const configPath = configPaths().find((p) => p && fs.existsSync(p));
  if (!configPath) return null;

  let store: Record<string, unknown>;
  try {
    store = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }

  const dataCentre = String(store['active_dc'] ?? 'us');
  const encrypted = (store[dataCentre] as { credential?: string } | undefined)?.credential;
  if (!encrypted) return null;

  const root = globalNodeModules();
  if (!root) return null;

  const credentialModule = path.join(root, 'zcatalyst-cli/lib/authentication/credential.js');
  if (!fs.existsSync(credentialModule)) return null;

  try {
    const require_ = createRequire(import.meta.url);
    const mod = require_(credentialModule) as { default?: CredentialLike };
    const Credential = mod.default;
    if (!Credential?.init || !Credential?.getAccessToken) return null;

    Credential.init(encrypted);
    const token = await Credential.getAccessToken();
    if (!token || typeof token !== 'string') return null;
    return { accessToken: token, dataCentre };
  } catch {
    return null;
  }
}

interface CredentialLike {
  init(token: string): unknown;
  getAccessToken(): Promise<string>;
}

/** Project and org ids written by `catalyst init` into the project .catalystrc. */
export function readCatalystRc(cwd = process.cwd()): { projectId: string; orgId: string; projectName: string } | null {
  const rc = path.join(cwd, '.catalystrc');
  if (!fs.existsSync(rc)) return null;
  try {
    const d = JSON.parse(fs.readFileSync(rc, 'utf8')) as {
      projects?: Array<{ id?: string | number; name?: string; env?: Array<{ id?: string | number }> }>;
    };
    const project = d.projects?.[0];
    if (!project?.id) return null;
    return {
      projectId: String(project.id),
      orgId: String(project.env?.[0]?.id ?? ''),
      projectName: String(project.name ?? ''),
    };
  } catch {
    return null;
  }
}
