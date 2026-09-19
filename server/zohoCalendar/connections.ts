/** Owner-scoped persistence for encrypted Zoho Calendar OAuth credentials. */
import { createHash } from 'node:crypto';
import type { CatalystApp } from '../notifications/types.ts';
import { zcqlString, unwrapRows, str, num } from '../notifications/zcql.ts';
import { ZOHO_CALENDAR_CONNECTIONS_TABLE } from '../catalyst/schema.ts';

const PROVIDER = 'zoho-calendar';

export interface ZohoCalendarConnection {
  connectionId: string;
  ownerId: string;
  /** Encrypted at rest; never send this object to the browser. */
  refreshTokenEncrypted: string;
  apiDomain: string;
  accountId: string;
  scopes: string;
  connectedAt: number;
  updatedAt: number;
}

interface ZohoCalendarConnectionRow extends ZohoCalendarConnection {
  rowId: string;
}

/** Stable, opaque key that guarantees one connection per owner and provider. */
export function connectionIdFor(ownerId: string): string {
  return createHash('sha256').update(`${PROVIDER}:${ownerId}`).digest('hex');
}

function toConnection(row: Record<string, unknown>): ZohoCalendarConnectionRow {
  return {
    rowId: str(row['ROWID']),
    connectionId: str(row['ConnectionId']),
    ownerId: str(row['OwnerId']),
    refreshTokenEncrypted: str(row['RefreshTokenEncrypted']),
    apiDomain: str(row['ApiDomain']),
    accountId: str(row['AccountId']),
    scopes: str(row['Scopes']),
    connectedAt: num(row['ConnectedAt']),
    updatedAt: num(row['UpdatedAt']),
  };
}

function toRow(connection: ZohoCalendarConnection): Record<string, string> {
  return {
    ConnectionId: connection.connectionId,
    OwnerId: connection.ownerId,
    Provider: PROVIDER,
    RefreshTokenEncrypted: connection.refreshTokenEncrypted,
    ApiDomain: connection.apiDomain,
    AccountId: connection.accountId,
    Scopes: connection.scopes,
    ConnectedAt: String(connection.connectedAt),
    UpdatedAt: String(connection.updatedAt),
  };
}

/** Returns only the active owner's grant; encrypted fields stay server-only. */
export async function getZohoCalendarConnection(
  app: CatalystApp, ownerId: string,
): Promise<ZohoCalendarConnectionRow | null> {
  const results = await app.zcql().executeZCQLQuery(
    `SELECT ROWID,ConnectionId,OwnerId,RefreshTokenEncrypted,ApiDomain,AccountId,Scopes,ConnectedAt,UpdatedAt ` +
    `FROM ${ZOHO_CALENDAR_CONNECTIONS_TABLE} WHERE OwnerId = ${zcqlString(ownerId)} ` +
    `AND Provider = ${zcqlString(PROVIDER)} LIMIT 1`,
  );
  const rows = unwrapRows(results, ZOHO_CALENDAR_CONNECTIONS_TABLE);
  return rows.length ? toConnection(rows[0]) : null;
}

/** Inserts the first grant or replaces the encrypted credentials after reconnecting. */
export async function saveZohoCalendarConnection(
  app: CatalystApp,
  connection: ZohoCalendarConnection,
): Promise<void> {
  const existing = await getZohoCalendarConnection(app, connection.ownerId);
  const row = toRow(connection);
  if (existing) {
    await app.datastore().table(ZOHO_CALENDAR_CONNECTIONS_TABLE).updateRow({ ROWID: existing.rowId, ...row });
  } else {
    await app.datastore().table(ZOHO_CALENDAR_CONNECTIONS_TABLE).insertRow(row);
  }
}

/** Deletes only the active owner's credential. */
export async function deleteZohoCalendarConnection(app: CatalystApp, ownerId: string): Promise<boolean> {
  const existing = await getZohoCalendarConnection(app, ownerId);
  if (!existing) return false;
  await app.datastore().table(ZOHO_CALENDAR_CONNECTIONS_TABLE).deleteRow(existing.rowId);
  return true;
}