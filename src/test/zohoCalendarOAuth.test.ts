import { describe, expect, it, vi } from 'vitest';
import {
  authorizationUrl, createOAuthState, decryptSecret, encryptSecret, exchangeAuthorizationCode, readZohoCalendarConfig,
  refreshAccessToken, ZOHO_CALENDAR_READ_SCOPE,
  verifyOAuthState,
} from '../../server/zohoCalendar/oauth.ts';

const env = {
  ZOHO_CALENDAR_CLIENT_ID: 'client-id',
  ZOHO_CALENDAR_CLIENT_SECRET: 'client-secret',
  ZOHO_CALENDAR_REDIRECT_URI: 'https://hitlist.example.com/api/zoho-calendar/callback',
  ZOHO_CALENDAR_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

describe('Zoho Calendar OAuth', () => {
  it('requires a complete secure configuration', () => {
    expect(readZohoCalendarConfig({})).toBeNull();
    expect(() => readZohoCalendarConfig({ ZOHO_CALENDAR_CLIENT_ID: 'only-one' })).toThrow('incomplete');
    expect(() => readZohoCalendarConfig({ ...env, ZOHO_CALENDAR_ENCRYPTION_KEY: 'wrong' })).toThrow('32-byte');
  });

  it('encrypts credentials with authenticated encryption', () => {
    const config = readZohoCalendarConfig(env)!;
    const encrypted = encryptSecret('refresh-token', config.encryptionKey);
    expect(encrypted).not.toContain('refresh-token');
    expect(decryptSecret(encrypted, config.encryptionKey)).toBe('refresh-token');
    expect(() => decryptSecret(`${encrypted}x`, config.encryptionKey)).toThrow('decrypt');
  });

  it('creates a least-privilege offline authorization URL', () => {
    const config = readZohoCalendarConfig(env)!;
    const url = new URL(authorizationUrl(config, 'state-value'));
    expect(url.origin).toBe('https://accounts.zoho.in');
    expect(url.pathname).toBe('/oauth/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(env.ZOHO_CALENDAR_REDIRECT_URI);
    expect(url.searchParams.get('scope')).toBe(ZOHO_CALENDAR_READ_SCOPE);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBe('state-value');
  });

  it('binds callback state to one user for a short time', () => {
    const config = readZohoCalendarConfig(env)!;
    const state = createOAuthState('user-1', config.encryptionKey, 1_000);
    expect(state).not.toContain('user-1');
    expect(verifyOAuthState(state, 'user-1', config.encryptionKey, 600_999)).toBe(true);
    expect(verifyOAuthState(state, 'user-2', config.encryptionKey, 2_000)).toBe(false);
    expect(verifyOAuthState(state, 'user-1', config.encryptionKey, 601_001)).toBe(false);
  });

  it('exchanges codes and refreshes tokens only through the server request', async () => {
    const config = readZohoCalendarConfig(env)!;
    const fetcher = vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response(JSON.stringify({
      access_token: 'access-token', refresh_token: 'refresh-token', api_domain: 'https://calendar.zoho.in', expires_in: 3600,
    }), { status: 200 }));

    expect((await exchangeAuthorizationCode(config, 'code', fetcher)).refreshToken).toBe('refresh-token');
    expect((await refreshAccessToken(config, 'refresh-token', fetcher)).accessToken).toBe('access-token');
    const [, firstInit] = fetcher.mock.calls[0]!;
    const firstBody = String(firstInit?.body);
    expect(firstBody).toContain('client_secret=client-secret');
    expect(firstBody).toContain('grant_type=authorization_code');
    expect(firstBody).toContain('redirect_uri=');
  });
});