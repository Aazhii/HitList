/**
 * catalystClient.ts — Typed wrappers around the Catalyst Web SDK global
 *
 * The Catalyst Web SDK is loaded via static parser-blocking <script> tags in
 * index.html and sets window.catalyst before React boots. All access must
 * happen inside callbacks/effects — never at module evaluation time.
 *
 * SDK reference: https://docs.catalyst.zoho.com/en/sdk/web/v4/overview/
 *
 * Initialization notes:
 *  - catalystWebSDK.js (CDN) sets window.catalyst with SDK methods
 *  - /__catalyst/sdk/init.js (Catalyst hosting) populates project credentials
 *    (ZAID, project ID). Both are static <script> tags so they execute
 *    synchronously (parser-blocking) before React boots.
 *  - isCatalystHosting() checks the hostname to detect Catalyst hosting.
 *    Supported domains: *.catalystserverless.in, *.catalystapps.com,
 *    *.catalystserverless.com, *.omcloud.ai (Zoho OM Cloud deployments)
 */

// ── Global type declaration ───────────────────────────────────────────────────

export interface CatalystUser {
  user_id: string;
  user_type: string;
  user_type_id: number;
  is_confirmed: boolean;
  email_id: string;
  first_name: string;
  last_name: string;
  created_time: string;
  org_id: string;
  project_id: string;
  time_zone: string;
  role_details: {
    role_id: string;
    role_name: string;
  };
}

export interface CatalystRowResponse {
  content: Record<string, unknown>;
  status: number;
}

export interface CatalystRowsResponse {
  content: Record<string, unknown>[];
  status: number;
  more_records?: boolean;
  next_token?: string;
}

export interface CatalystTable {
  insertRow(data: Record<string, unknown>): Promise<CatalystRowResponse>;
  /**
   * SDK v4: updateRow takes rowId as the FIRST argument and the column data
   * (WITHOUT ROWID/system columns) as the SECOND argument.
   * Passing ROWID inside the data object is incorrect and causes silent failures.
   */
  updateRow(rowId: string | number, data: Record<string, unknown>): Promise<CatalystRowResponse>;
  getRow(rowId: string | number): Promise<CatalystRowResponse>;
  deleteRow(rowId: string | number): Promise<CatalystRowResponse>;
  getPagedRows(options?: { nextToken?: string; maxRows?: number }): Promise<CatalystRowsResponse>;
}

export interface CatalystDatastore {
  table(name: string): CatalystTable;
  tableId(id: string | number): CatalystTable;
}

export interface CatalystAuth {
  /**
   * Resolves with the response object (status 200, content: user data) if
   * authenticated. Rejects with a server error (status 401) if not authenticated.
   * SDK v4 source: calls getProjectUserDetails() internally.
   * The resolved content contains the user fields (user_id, email_id, etc.).
   */
  isUserAuthenticated(): Promise<{ status: number; content: Record<string, unknown> }>;
  /**
   * Shows the Catalyst login iframe inside the element with the given id.
   * If the user IS already authenticated, redirects to the signin-redirect URL.
   * Use window.location.href = '/__catalyst/auth/login' for redirect-based login.
   */
  signIn(elementId?: string, options?: Record<string, unknown>): void;
  signOut(redirectUrl?: string): void;
}

export interface CatalystSDK {
  auth: CatalystAuth;
  datastore(): CatalystDatastore;
}

declare global {
  interface Window {
    catalyst?: CatalystSDK;
    /**
     * Set to true by the init.js onload handler in index.html.
     * Signals that Catalyst project credentials (ZAID, project ID) have been
     * populated and DataStore calls can proceed.
     * On local dev (no init.js) this remains undefined/false.
     */
    __catalystInitReady?: boolean;
  }
}

// ── Accessors ─────────────────────────────────────────────────────────────────

/**
 * Returns true when the app is running on Catalyst hosting infrastructure.
 *
 * Supported Catalyst deployment domains:
 *   *.catalystserverless.in  — standard Catalyst environments
 *   *.catalystapps.com       — older / alternate domain
 *   *.catalystserverless.com — alternate domain
 *   *.omcloud.ai             — Zoho OM Cloud / Slate AI deployments
 *
 * Falls back to checking window.catalyst presence when hostname doesn't match
 * any known pattern (e.g. custom domains with Catalyst backend).
 */
export function isCatalystHosting(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return (
    host.endsWith('.catalystserverless.in') ||
    host.endsWith('.catalystapps.com') ||
    host.endsWith('.catalystserverless.com') ||
    host.endsWith('.omcloud.ai')
  );
}

/**
 * Returns true if the Catalyst SDK is present AND we are on Catalyst hosting
 * (meaning init.js has run and project credentials are populated).
 * Use this to gate Catalyst-specific code paths.
 *
 * Also returns true if window.catalyst is present even on an unrecognized
 * hostname — this handles custom domains where init.js was loaded manually.
 */
export function isCatalystAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  // Primary: known Catalyst hosting domain + SDK loaded
  if (isCatalystHosting() && !!window.catalyst) return true;
  // Fallback: SDK present on any host (custom domain with manual init.js)
  // Only trust this if we're NOT on localhost/127.0.0.1 (local dev)
  const host = window.location.hostname;
  const isLocalDev = host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.');
  if (!isLocalDev && !!window.catalyst) return true;
  return false;
}

/**
 * Returns the Catalyst SDK instance.
 * Throws if the SDK is not loaded (i.e. not running on Catalyst hosting).
 */
export function getCatalyst(): CatalystSDK {
  if (!window.catalyst) {
    throw new Error('Catalyst SDK not available — app must be deployed to Catalyst hosting');
  }
  return window.catalyst;
}

/**
 * Waits for the Catalyst SDK AND init.js credentials to be ready.
 *
 * init.js is loaded dynamically (async) in index.html and sets
 * window.__catalystInitReady = true in its onload callback.
 * catalystWebSDK.js is a static parser-blocking script so window.catalyst
 * is always present on Catalyst hosting before React boots.
 *
 * We poll __catalystInitReady up to timeoutMs. If it never becomes true
 * (e.g. init.js 404'd on local dev), we resolve false so callers can
 * fall back to mock mode.
 */
export function waitForCatalystReady(timeoutMs = 6000): Promise<boolean> {
  // If already ready, resolve immediately
  if (window.__catalystInitReady && window.catalyst) return Promise.resolve(true);
  // If no SDK at all, resolve false immediately (local dev without CDN script)
  if (!window.catalyst) return Promise.resolve(false);

  return new Promise((resolve) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (window.__catalystInitReady) {
        clearInterval(interval);
        resolve(true);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        clearInterval(interval);
        // Timed out — SDK present but init.js never fired.
        // Resolve true anyway so auth check can proceed (it will fail gracefully).
        resolve(!!window.catalyst);
      }
    }, 50);
  });
}

/**
 * Returns the authenticated Catalyst user, or null if not authenticated.
 * Never throws — returns null on any error.
 *
 * SDK v4 ACTUAL behavior (confirmed from minified source):
 *   auth.isUserAuthenticated() calls getProjectUserDetails() internally.
 *   It resolves with { status, content } when the session cookie is present.
 *   It REJECTS (throws) with status 401 when not authenticated.
 *   It may also RESOLVE with status 400 ("User does not exist") when the
 *   authenticated Zoho account is not registered in this Catalyst project.
 *
 *   Status mapping:
 *     200 → authenticated, content has user fields
 *     400 → account not in project → treat as unauthenticated (redirect to login)
 *     401 → not authenticated (thrown as error in SDK v4)
 *     any other → treat as unauthenticated
 *
 * NOTE: auth.getSessionUser() does NOT exist in SDK v4. The user data
 * is returned directly in the isUserAuthenticated() resolved content.
 */
export async function getSessionUser(): Promise<CatalystUser | null> {
  try {
    const sdk = getCatalyst();
    const res = await sdk.auth.isUserAuthenticated();
    if (res && res.status === 200 && res.content) {
      // content contains the user fields directly
      const c = res.content;
      return {
        user_id: String(c['user_id'] ?? c['userId'] ?? ''),
        user_type: String(c['user_type'] ?? ''),
        user_type_id: Number(c['user_type_id'] ?? 0),
        is_confirmed: Boolean(c['is_confirmed'] ?? true),
        email_id: String(c['email_id'] ?? c['email'] ?? ''),
        first_name: String(c['first_name'] ?? ''),
        last_name: String(c['last_name'] ?? ''),
        created_time: String(c['created_time'] ?? ''),
        org_id: String(c['org_id'] ?? ''),
        project_id: String(c['project_id'] ?? ''),
        time_zone: String(c['time_zone'] ?? ''),
        role_details: (c['role_details'] as CatalystUser['role_details']) ?? { role_id: '', role_name: '' },
      };
    }
    // status 400 ("User does not exist") or any non-200 → not authenticated
    return null;
  } catch (err) {
    // SDK v4 throws on 401 (not authenticated) — treat as null
    const status = (err as Record<string, unknown>)?.['status'];
    if (status !== 401) {
      console.warn('[catalystClient] getSessionUser unexpected error (status:', status, '):', err);
    }
    return null;
  }
}

/**
 * Checks if the current user is authenticated.
 * Returns true if authenticated, false if not (or on any error).
 *
 * SDK v4 actual behavior:
 *   - Resolves with { status: 200, content: user } when authenticated.
 *   - Resolves with { status: 400, content: error } when the Zoho account
 *     is not registered in this Catalyst project ("User does not exist").
 *   - Throws (rejects) with status 401 when no session cookie is present.
 *
 * All non-200 outcomes → return false (unauthenticated).
 */
export async function checkIsAuthenticated(): Promise<boolean> {
  try {
    const sdk = getCatalyst();
    const res = await sdk.auth.isUserAuthenticated();
    return res?.status === 200;
  } catch {
    // SDK v4 throws on 401 (no session) — treat as not authenticated
    return false;
  }
}

/**
 * Returns a typed DataStore table reference by name.
 * Uses the correct SDK v4 API: catalyst.datastore().table(name)
 */
export function getTable(name: string): CatalystTable {
  return getCatalyst().datastore().table(name);
}

/**
 * Unwraps a single DataStore row from the SDK response envelope.
 *
 * Catalyst Web SDK v4 wraps each row under the table name key:
 *   { KaizenTasks: { ROWID: "123", Title: "...", ... } }
 *
 * getPagedRows returns an array of these wrapped objects.
 * insertRow / updateRow return a single wrapped object in content.
 *
 * This helper normalises all shapes to a flat row object.
 */
export function unwrapRow(
  raw: Record<string, unknown>,
  tableName?: string,
): Record<string, unknown> {
  // If ROWID is already at the top level, it's already flat
  if ('ROWID' in raw) return raw;

  // Try the table-name key first (most common SDK v4 shape)
  if (tableName && tableName in raw) {
    const inner = raw[tableName];
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      return inner as Record<string, unknown>;
    }
  }

  // Try any single key whose value is an object with ROWID (table name may differ in casing)
  const keys = Object.keys(raw);
  if (keys.length === 1) {
    const inner = raw[keys[0]];
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      const innerObj = inner as Record<string, unknown>;
      if ('ROWID' in innerObj) return innerObj;
    }
  }

  // Fallback: return as-is
  return raw;
}

/**
 * Fetches ALL rows from a table using cursor-based pagination.
 * Handles the 200-row default page limit transparently.
 *
 * SDK v4 DataStore getPagedRows returns:
 *   { content: Row[], more_records: boolean, next_token: string }
 *
 * Each element in content[] may be wrapped under the table name key:
 *   { KaizenTasks: { ROWID, Title, ... } }
 * We unwrap all shapes defensively.
 */
export async function getAllRows(tableName: string): Promise<Record<string, unknown>[]> {
  const table = getTable(tableName);
  const rows: Record<string, unknown>[] = [];
  let nextToken: string | undefined;
  let pageCount = 0;
  const MAX_PAGES = 50; // safety limit

  do {
    const opts: Record<string, unknown> = {};
    if (nextToken) opts['nextToken'] = nextToken; // SDK v4 uses camelCase

    const res = await table.getPagedRows(opts as Parameters<typeof table.getPagedRows>[0]);

    // Normalise content to a flat array of raw items
    const content = res.content;
    let rawItems: Record<string, unknown>[] = [];

    if (Array.isArray(content)) {
      rawItems = content as Record<string, unknown>[];
    } else if (content && typeof content === 'object') {
      // Some SDK versions wrap rows under content.data
      const data = (content as Record<string, unknown>)['data'];
      if (Array.isArray(data)) {
        rawItems = data as Record<string, unknown>[];
      }
    }

    // Unwrap each row from its table-name envelope
    for (const raw of rawItems) {
      rows.push(unwrapRow(raw, tableName));
    }

    // Pagination: SDK returns more_records=true and next_token when there are more pages.
    // Guard: treat empty-string next_token as terminal (some SDK versions emit "" on last page).
    const rawToken = res.more_records ? res.next_token : undefined;
    nextToken = rawToken && rawToken.length > 0 ? rawToken : undefined;
    pageCount++;
  } while (nextToken && pageCount < MAX_PAGES);

  console.debug(`[getAllRows] ${tableName}: fetched ${rows.length} rows in ${pageCount} page(s)`);
  return rows;
}
