/** Server-side OAuth and encryption primitives for Zoho Calendar. */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const ZOHO_CALENDAR_READ_SCOPE = 'ZohoCalendar.calendar.READ,ZohoCalendar.event.READ';

export interface ZohoCalendarOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: Buffer;
  accountsDomain: string;
  calendarApiDomain: string;
}

export interface ZohoTokenResponse {
  accessToken: string;
  refreshToken?: string;
  apiDomain: string;
  expiresIn: number;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface OAuthStatePayload {
  ownerId: string;
  nonce: string;
  expiresAt: number;
}

/** Reads complete config only. Partial OAuth configuration must fail closed. */
export function readZohoCalendarConfig(env: NodeJS.ProcessEnv = process.env): ZohoCalendarOAuthConfig | null {
  const get = (name: string) => (env[name] ?? '').trim();
  const clientId = get('ZOHO_CALENDAR_CLIENT_ID');
  const clientSecret = get('ZOHO_CALENDAR_CLIENT_SECRET');
  const redirectUri = get('ZOHO_CALENDAR_REDIRECT_URI');
  const encodedKey = get('ZOHO_CALENDAR_ENCRYPTION_KEY');
  const supplied = [clientId, clientSecret, redirectUri, encodedKey].filter(Boolean).length;
  if (supplied === 0) return null;
  if (supplied !== 4) {
    throw new Error('Zoho Calendar OAuth configuration is incomplete. Set ZOHO_CALENDAR_CLIENT_ID, ZOHO_CALENDAR_CLIENT_SECRET, ZOHO_CALENDAR_REDIRECT_URI, and ZOHO_CALENDAR_ENCRYPTION_KEY.');
  }

  let encryptionKey: Buffer;
  try { encryptionKey = Buffer.from(encodedKey, 'base64'); } catch { encryptionKey = Buffer.alloc(0); }
  if (encryptionKey.length !== 32) {
    throw new Error('ZOHO_CALENDAR_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }
  if (!/^https?:\/\/[^\s]+$/i.test(redirectUri)) {
    throw new Error('ZOHO_CALENDAR_REDIRECT_URI must be an absolute http or https URL.');
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    encryptionKey,
    accountsDomain: get('ZOHO_CALENDAR_ACCOUNTS_DOMAIN') || 'https://accounts.zoho.in',
    calendarApiDomain: get('ZOHO_CALENDAR_API_DOMAIN') || 'https://calendar.zoho.in/api/v1',
  };
}

/** AES-256-GCM envelope; token plaintext never leaves this module. */
export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptSecret(envelope: string, key: Buffer): string {
  const [version, ivEncoded, tagEncoded, ciphertextEncoded, extra] = envelope.split('.');
  if (version !== 'v1' || !ivEncoded || !tagEncoded || !ciphertextEncoded || extra) {
    throw new Error('Invalid encrypted Zoho Calendar credential.');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivEncoded, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextEncoded, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Unable to decrypt the Zoho Calendar credential.');
  }
}

/** Creates an opaque, short-lived state bound to the current HitList owner. */
export function createOAuthState(ownerId: string, key: Buffer, now = Date.now()): string {
  const payload: OAuthStatePayload = { ownerId, nonce: randomBytes(16).toString('base64url'), expiresAt: now + 10 * 60_000 };
  return encryptSecret(JSON.stringify(payload), key);
}

/** Rejects malformed, expired, or cross-user OAuth callback state. */
export function verifyOAuthState(state: string, ownerId: string, key: Buffer, now = Date.now()): boolean {
  try {
    const raw = JSON.parse(decryptSecret(state, key)) as Partial<OAuthStatePayload>;
    return raw.ownerId === ownerId && typeof raw.nonce === 'string' && raw.nonce.length > 0
      && typeof raw.expiresAt === 'number' && raw.expiresAt >= now;
  } catch {
    return false;
  }
}

export function authorizationUrl(config: ZohoCalendarOAuthConfig, state: string): string {
  const url = new URL('/oauth/v2/auth', config.accountsDomain);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: ZOHO_CALENDAR_READ_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  }).toString();
  return url.toString();
}

function tokenUrl(config: ZohoCalendarOAuthConfig): string {
  return new URL('/oauth/v2/token', config.accountsDomain).toString();
}

function asTokenResponse(raw: unknown): ZohoTokenResponse {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const accessToken = typeof body['access_token'] === 'string' ? body['access_token'] : '';
  const refreshToken = typeof body['refresh_token'] === 'string' ? body['refresh_token'] : undefined;
  const apiDomain = typeof body['api_domain'] === 'string' ? body['api_domain'] : '';
  const expiresIn = Number(body['expires_in'] ?? 0);
  if (!accessToken || !apiDomain || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error('Zoho returned an invalid token response.');
  }
  return { accessToken, refreshToken, apiDomain, expiresIn };
}

async function postToken(
  config: ZohoCalendarOAuthConfig, fields: Record<string, string>, fetcher: FetchLike = fetch,
): Promise<ZohoTokenResponse> {
  const response = await fetcher(tokenUrl(config), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...fields,
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error('Zoho Calendar authorization failed.');
  return asTokenResponse(body);
}

export function exchangeAuthorizationCode(
  config: ZohoCalendarOAuthConfig, code: string, fetcher?: FetchLike,
): Promise<ZohoTokenResponse> {
  return postToken(config, { grant_type: 'authorization_code', code, redirect_uri: config.redirectUri }, fetcher);
}

export function refreshAccessToken(
  config: ZohoCalendarOAuthConfig, refreshToken: string, fetcher?: FetchLike,
): Promise<ZohoTokenResponse> {
  return postToken(config, { grant_type: 'refresh_token', refresh_token: refreshToken }, fetcher);
}