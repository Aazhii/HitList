import { describe, expect, it } from 'vitest';
import {
  connectionIdFor, deleteZohoCalendarConnection, getZohoCalendarConnection, saveZohoCalendarConnection,
  type ZohoCalendarConnection,
} from '../../server/zohoCalendar/connections.ts';
import { fakeCatalyst } from './helpers/fakeCatalyst.ts';

const connection = (over: Partial<ZohoCalendarConnection> = {}): ZohoCalendarConnection => ({
  connectionId: connectionIdFor('user-1'),
  ownerId: 'user-1',
  refreshTokenEncrypted: 'ciphertext',
  apiDomain: 'https://calendar.zoho.in',
  accountId: 'account-1',
  scopes: 'ZohoCalendar.calendar.READ',
  connectedAt: 1,
  updatedAt: 1,
  ...over,
});

describe('Zoho Calendar connection storage', () => {
  it('uses an opaque, stable connection key', () => {
    expect(connectionIdFor('user-1')).toMatch(/^[a-f0-9]{64}$/);
    expect(connectionIdFor('user-1')).toBe(connectionIdFor('user-1'));
    expect(connectionIdFor('user-1')).not.toBe(connectionIdFor('user-2'));
  });

  it('stores and retrieves only the matching owner connection', async () => {
    const fake = fakeCatalyst();
    await saveZohoCalendarConnection(fake.app, connection());
    await saveZohoCalendarConnection(fake.app, connection({
      connectionId: connectionIdFor('user-2'), ownerId: 'user-2', refreshTokenEncrypted: 'other-secret',
    }));

    const stored = await getZohoCalendarConnection(fake.app, 'user-1');
    expect(stored).toMatchObject({ ownerId: 'user-1', refreshTokenEncrypted: 'ciphertext' });
    expect(await getZohoCalendarConnection(fake.app, 'nobody')).toBeNull();
  });

  it('reconnects by replacing credentials instead of creating a second grant', async () => {
    const fake = fakeCatalyst();
    await saveZohoCalendarConnection(fake.app, connection());
    await saveZohoCalendarConnection(fake.app, connection({ refreshTokenEncrypted: 'replacement', updatedAt: 2 }));

    expect(fake.tables['KaizenZohoCalendarConnections']).toHaveLength(1);
    expect((await getZohoCalendarConnection(fake.app, 'user-1'))?.refreshTokenEncrypted).toBe('replacement');
  });

  it('disconnects only the active owner', async () => {
    const fake = fakeCatalyst();
    await saveZohoCalendarConnection(fake.app, connection());
    await saveZohoCalendarConnection(fake.app, connection({
      connectionId: connectionIdFor('user-2'), ownerId: 'user-2', refreshTokenEncrypted: 'other-secret',
    }));

    expect(await deleteZohoCalendarConnection(fake.app, 'user-1')).toBe(true);
    expect(await getZohoCalendarConnection(fake.app, 'user-1')).toBeNull();
    expect((await getZohoCalendarConnection(fake.app, 'user-2'))?.refreshTokenEncrypted).toBe('other-secret');
  });
});