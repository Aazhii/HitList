import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readStoreConfig } from '../../server/store/runtime.ts';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('readStoreConfig', () => {
  it('defaults to automatic selection and a durable local SQLite path', () => {
    const config = readStoreConfig('/workspace/hitlist');
    expect(config.requestedKind).toBeNull();
    expect(config.explicit).toBe(false);
    expect(config.sqlitePath).toBe(path.resolve('/workspace/hitlist', '.local/hitlist.sqlite'));
  });

  it('treats KAIZEN_STORE=auto as automatic selection', () => {
    vi.stubEnv('KAIZEN_STORE', 'auto');
    const config = readStoreConfig('/workspace/hitlist');
    expect(config.requestedKind).toBeNull();
    expect(config.explicit).toBe(false);
  });

  it('reads an explicit SQLite selection and custom path', () => {
    vi.stubEnv('KAIZEN_STORE', 'sqlite');
    vi.stubEnv('KAIZEN_SQLITE_PATH', 'data/local.sqlite');

    const config = readStoreConfig('/workspace/hitlist');
    expect(config.requestedKind).toBe('sqlite');
    expect(config.explicit).toBe(true);
    expect(config.sqlitePath).toBe(path.resolve('/workspace/hitlist', 'data/local.sqlite'));
  });

  it('preserves SQLite special paths', () => {
    vi.stubEnv('KAIZEN_STORE', 'sqlite');
    vi.stubEnv('KAIZEN_SQLITE_PATH', ':memory:');
    expect(readStoreConfig('/workspace/hitlist').sqlitePath).toBe(':memory:');

    vi.stubEnv('KAIZEN_SQLITE_PATH', 'file:hitlist?mode=memory&cache=shared');
    expect(readStoreConfig('/workspace/hitlist').sqlitePath)
      .toBe('file:hitlist?mode=memory&cache=shared');
  });

  it('rejects an unknown backend name', () => {
    vi.stubEnv('KAIZEN_STORE', 'postgres');
    expect(() => readStoreConfig('/workspace/hitlist')).toThrow(/KAIZEN_STORE/);
  });
});
