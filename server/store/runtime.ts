import path from 'node:path';

export type StoreKind = 'catalyst' | 'sqlite' | 'json-file';

const STORE_ENV = 'KAIZEN_STORE';
const SQLITE_PATH_ENVS = ['KAIZEN_SQLITE_PATH', 'SQLITE_PATH'] as const;
const SQLITE_DEFAULT_PATH = path.join('.local', 'hitlist.sqlite');

function resolveSqlitePath(cwd: string, configuredPath: string): string {
  if (configuredPath === ':memory:' || configuredPath.startsWith('file:')) {
    return configuredPath;
  }
  return path.resolve(cwd, configuredPath || SQLITE_DEFAULT_PATH);
}

function normaliseStoreKind(raw: string): StoreKind | null {
  const value = raw.trim().toLowerCase();
  if (!value || value === 'auto') return null;
  if (value === 'catalyst') return 'catalyst';
  if (value === 'sqlite') return 'sqlite';
  if (value === 'json' || value === 'json-file' || value === 'jsonfile') return 'json-file';
  return null;
}

export interface StoreConfig {
  requestedKind: StoreKind | null;
  explicit: boolean;
  sqlitePath: string;
}

/**
 * Reads the storage preference for the server.
 *
 * Leave KAIZEN_STORE unset to keep the current behaviour:
 *   - hosted / credentialed runs default to Catalyst
 *   - local runs with no Catalyst credentials fall back to JSON files
 *
 * Opt into SQLite explicitly with KAIZEN_STORE=sqlite. Its file lives at
 * KAIZEN_SQLITE_PATH (or SQLITE_PATH) when set, else .local/hitlist.sqlite.
 */
export function readStoreConfig(cwd: string = process.cwd()): StoreConfig {
  const rawKind = (process.env[STORE_ENV] ?? '').trim();
  const requestedKind = normaliseStoreKind(rawKind);
  if (rawKind && rawKind.toLowerCase() !== 'auto' && requestedKind === null) {
    throw new Error(
      `${STORE_ENV} must be one of catalyst, sqlite, json-file, or blank for auto.`,
    );
  }

  const rawPath = SQLITE_PATH_ENVS
    .map((name) => (process.env[name] ?? '').trim())
    .find(Boolean);

  return {
    requestedKind,
    explicit: requestedKind !== null,
    sqlitePath: resolveSqlitePath(cwd, rawPath ?? ''),
  };
}

export function storeSupportsStructuredData(kind: StoreKind): boolean {
  return kind !== 'json-file';
}
