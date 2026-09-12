/**
 * userService.ts — KaizenUsers table integration layer.
 *
 * Provides upsertCurrentUser(authUser) which:
 *   1. Queries the KaizenUsers table for a row matching the Catalyst user_id.
 *   2. If found, returns the existing row (including its ROWID).
 *   3. If not found, inserts a new row and returns it.
 *
 * The returned UserRow.rowId is stored in CatalystUserContext so all
 * downstream DataStore writes (tasks, lists) can include it as UserRowId,
 * enabling per-user data scoping beyond CREATORID.
 *
 * Table: KaizenUsers
 *   Columns (exact labels as in Catalyst console):
 *     CatalystUserId  — string, the Catalyst user_id (unique per user)
 *     Email           — string
 *     FirstName       — string
 *     LastName        — string
 *     CreatedAt       — string (ISO-8601)
 *     UpdatedAt       — string (ISO-8601)
 *   System columns (auto-populated by Catalyst):
 *     ROWID, CREATORID, CREATEDTIME, MODIFIEDTIME
 *
 * ZCQL note: column names in WHERE clauses must match the exact label
 * defined in the Catalyst console (case-sensitive). If the column is
 * named differently, the WHERE clause silently returns 0 rows.
 *
 * SDK-ready guard: all DataStore calls are wrapped in try/catch.
 * If the SDK is not ready, the error propagates to the caller
 * (CatalystAuthGate) which handles it gracefully.
 */

import { getTable, unwrapRow, getAllRows } from './catalystClient';
import type { CatalystUser } from './catalystClient';
import { validateUserId, validateEmail, ValidationError } from './validation';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UserRow {
  /** DataStore ROWID — used as the foreign key in KaizenTasks / KaizenLists */
  rowId: string;
  /** Catalyst platform user_id (from auth.isUserAuthenticated) */
  catalystUserId: string;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: string;
  updatedAt: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const TABLE = 'KaizenUsers';

function rowToUserRow(row: Record<string, unknown>): UserRow {
  const now = new Date().toISOString();
  return {
    rowId: String(row['ROWID'] ?? ''),
    catalystUserId: String(row['CatalystUserId'] ?? ''),
    email: String(row['Email'] ?? ''),
    firstName: String(row['FirstName'] ?? ''),
    lastName: String(row['LastName'] ?? ''),
    createdAt: String(row['CreatedAt'] ?? now),
    updatedAt: String(row['UpdatedAt'] ?? now),
  };
}

/**
 * Finds an existing KaizenUsers row by CatalystUserId.
 * Returns null if not found or on any error.
 *
 * Strategy: fetch all rows and filter client-side.
 * This avoids ZCQL column-name case-sensitivity issues and works
 * reliably regardless of how the column was named in the console.
 * For a users table this is always a small result set (1 row per user).
 */
async function findUserRow(catalystUserId: string): Promise<UserRow | null> {
  try {
    const rows = await getAllRows(TABLE);
    const match = rows.find(
      (r) =>
        String(r['CatalystUserId']) === catalystUserId ||
        // Fallback: some older rows may have used CREATORID as the key
        String(r['CREATORID']) === catalystUserId,
    );
    if (!match) return null;
    const userRow = rowToUserRow(match);
    if (!userRow.rowId) {
      console.warn('[UserService] Found user row but ROWID is missing:', match);
      return null;
    }
    return userRow;
  } catch (e) {
    console.error('[UserService] findUserRow failed:', e);
    return null;
  }
}

/**
 * Inserts a new KaizenUsers row for the given Catalyst user.
 * Returns the created UserRow (with ROWID from the server response).
 * Throws on insert failure.
 */
async function insertUserRow(authUser: CatalystUser): Promise<UserRow> {
  const now = new Date().toISOString();
  const table = getTable(TABLE);
  const data: Record<string, unknown> = {
    CatalystUserId: authUser.user_id,
    Email: authUser.email_id,
    FirstName: authUser.first_name,
    LastName: authUser.last_name,
    CreatedAt: now,
    UpdatedAt: now,
  };

  const res = await table.insertRow(data);
  const row = unwrapRow(res.content as Record<string, unknown>, TABLE);

  console.debug('[UserService] insertRow (user) response row:', row);

  if (!row['ROWID']) {
    throw new Error(
      '[UserService] insertRow succeeded but ROWID was not returned. ' +
        'Check that the KaizenUsers table exists in the Catalyst console.',
    );
  }

  return rowToUserRow(row);
}

/**
 * Updates the UpdatedAt (and profile fields) on an existing user row.
 * Non-critical — failures are logged but do not propagate.
 */
async function touchUserRow(rowId: string, authUser: CatalystUser): Promise<void> {
  try {
    const table = getTable(TABLE);
    await table.updateRow(rowId, {
      Email: authUser.email_id,
      FirstName: authUser.first_name,
      LastName: authUser.last_name,
      UpdatedAt: new Date().toISOString(),
    });
  } catch (e) {
    // Non-critical — log and continue
    console.warn('[UserService] touchUserRow failed (non-critical):', e);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Upserts the current authenticated user into the KaizenUsers table.
 *
 * - If a row already exists for this Catalyst user_id, returns it
 *   (and silently updates profile fields in the background).
 * - If no row exists, inserts one and returns the new row.
 *
 * The returned UserRow.rowId is the DataStore ROWID used as a foreign
 * key in KaizenTasks and KaizenLists for per-user data scoping.
 *
 * @param authUser  The CatalystUser from isUserAuthenticated()
 * @returns         The UserRow (existing or newly created)
 * @throws          ValidationError if authUser fields are invalid
 * @throws          Error if the DataStore insert fails
 */
/**
 * Upserts the current authenticated user into the KaizenUsers table.
 *
 * This function is ALWAYS non-throwing — all errors are caught and logged.
 * Returns null on any failure so callers can safely fire-and-forget.
 *
 * The KaizenUsers table is optional infrastructure — the app works via
 * CREATORID scoping even if this table doesn't exist or the upsert fails.
 */
export async function upsertCurrentUser(authUser: CatalystUser): Promise<UserRow | null> {
  try {
    // Validate inputs before any DataStore call
    validateUserId(authUser.user_id);
    validateEmail(authUser.email_id);
  } catch (validationErr) {
    console.warn('[UserService] upsertCurrentUser — invalid user fields (non-fatal):', validationErr);
    return null;
  }

  console.info('[UserService] upsertCurrentUser — looking up user_id:', authUser.user_id);

  try {
    // 1. Try to find existing row
    const existing = await findUserRow(authUser.user_id);

    if (existing) {
      console.info('[UserService] Found existing user row:', {
        rowId: existing.rowId,
        email: existing.email,
      });
      // Touch in background (update profile fields + UpdatedAt) — non-blocking
      void touchUserRow(existing.rowId, authUser);
      return existing;
    }

    // 2. No existing row — insert new one
    console.info('[UserService] No existing user row — inserting new row for:', authUser.email_id);
    try {
      const created = await insertUserRow(authUser);
      console.info('[UserService] Created user row:', {
        rowId: created.rowId,
        email: created.email,
      });
      return created;
    } catch (insertErr) {
      // Race condition: two tabs opened simultaneously — retry find
      console.warn('[UserService] insertUserRow failed — retrying findUserRow (possible race):', insertErr);
      const retry = await findUserRow(authUser.user_id);
      if (retry) return retry;
      // Insert failed and no row found — KaizenUsers table may not exist
      console.warn('[UserService] upsertCurrentUser — KaizenUsers table may not exist. App continues without UserRow.');
      return null;
    }
  } catch (e) {
    // Catch-all: DataStore unavailable, network error, etc.
    console.warn('[UserService] upsertCurrentUser failed (non-fatal):', e);
    return null;
  }
}
