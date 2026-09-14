/**
 * The in-app inbox — what the bell reads.
 *
 * Rows arrive here only from the `inapp` delivery channel, which means every
 * entry corresponds to something that was actually scheduled and actually
 * fired. That is the whole point of replacing what came before: the bell was
 * seeded with fabricated records and then recomputed "upcoming" and "missed"
 * from the task list on every poll, so it displayed a plausible-looking
 * notification for something that had never been delivered anywhere.
 *
 * Read-mostly and small. A user's unread count is a handful of rows, so this
 * queries with a LIMIT and sorts newest-first rather than paginating — a
 * notification nobody read in the last two hundred entries is not one the bell
 * needs to show.
 */
import type { CatalystApp } from './types.ts';
import { INBOX_TABLE } from '../catalyst/schema.ts';
import { zcqlString, unwrapRows, str, num } from './zcql.ts';

/**
 * How many entries the bell can show.
 *
 * Bounded so a long-running account cannot turn opening the bell into a large
 * query. Older entries stay in the table for the audit trail; they are simply
 * not displayed.
 */
export const INBOX_LIMIT = 200;

export interface InboxEntry {
  id: string;
  title: string;
  body: string;
  kind: string;
  sourceType: string;
  sourceId: string;
  /** Epoch ms it was read, or 0 while unread. */
  readAt: number;
  createdAt: number;
  payload?: Record<string, unknown>;
}

const SELECT_COLUMNS =
  'ROWID,NotificationId,OwnerId,Title,Body,Kind,SourceType,SourceId,Payload,ReadAt,CreatedAt';

function toEntry(row: Record<string, unknown>): InboxEntry {
  let payload: Record<string, unknown> | undefined;
  const raw = str(row['Payload']);
  if (raw) {
    // An unreadable payload costs the deep link, not the notification.
    try { payload = JSON.parse(raw) as Record<string, unknown>; } catch { payload = undefined; }
  }

  return {
    id: str(row['NotificationId']),
    title: str(row['Title']),
    body: str(row['Body']),
    kind: str(row['Kind']),
    sourceType: str(row['SourceType']),
    sourceId: str(row['SourceId']),
    readAt: num(row['ReadAt']),
    createdAt: num(row['CreatedAt']),
    payload,
  };
}

/** Newest first, capped at INBOX_LIMIT. */
export async function listInbox(
  app: CatalystApp,
  ownerId: string,
  limit = INBOX_LIMIT,
): Promise<InboxEntry[]> {
  const results = await app.zcql().executeZCQLQuery(
    `SELECT ${SELECT_COLUMNS} FROM ${INBOX_TABLE} ` +
    `WHERE OwnerId = ${zcqlString(ownerId)} ` +
    `ORDER BY CreatedAt DESC LIMIT ${Math.max(1, Math.min(limit, INBOX_LIMIT))}`,
  );
  return unwrapRows(results, INBOX_TABLE).map(toEntry);
}

/**
 * Finds one entry's internal row id, scoped to its owner.
 *
 * The owner predicate is not decoration: without it, a caller who guessed or
 * observed another user's NotificationId could mark their notifications read.
 */
async function findRowId(
  app: CatalystApp,
  ownerId: string,
  notificationId: string,
): Promise<string | null> {
  const results = await app.zcql().executeZCQLQuery(
    `SELECT ROWID FROM ${INBOX_TABLE} ` +
    `WHERE NotificationId = ${zcqlString(notificationId)} ` +
    `AND OwnerId = ${zcqlString(ownerId)} LIMIT 1`,
  );
  const rows = unwrapRows(results, INBOX_TABLE);
  return rows.length ? str(rows[0]['ROWID']) : null;
}

/**
 * Marks one entry read. Returns false when it does not exist for this owner.
 *
 * Idempotent, and deliberately does not preserve the first read time: a second
 * call simply rewrites the timestamp. Nothing depends on when it was first
 * read, and refusing the write would mean a failed request for an action the
 * user experiences as already done.
 */
export async function markRead(
  app: CatalystApp,
  ownerId: string,
  notificationId: string,
  now = Date.now(),
): Promise<boolean> {
  const rowId = await findRowId(app, ownerId, notificationId);
  if (!rowId) return false;

  await app.datastore().table(INBOX_TABLE).updateRow({
    ROWID: rowId,
    ReadAt: String(now),
  });
  return true;
}

/**
 * Marks every unread entry read. Returns how many changed.
 *
 * One row at a time, because Catalyst has no conditional UPDATE — see
 * docs/catalyst/03-datastore.md. Bounded by INBOX_LIMIT, which is also what
 * the bell can display, so this cannot become an unbounded write.
 */
export async function markAllRead(
  app: CatalystApp,
  ownerId: string,
  now = Date.now(),
): Promise<number> {
  const results = await app.zcql().executeZCQLQuery(
    `SELECT ROWID FROM ${INBOX_TABLE} ` +
    `WHERE OwnerId = ${zcqlString(ownerId)} AND ReadAt = 0 ` +
    `LIMIT ${INBOX_LIMIT}`,
  );
  const rows = unwrapRows(results, INBOX_TABLE);

  const table = app.datastore().table(INBOX_TABLE);
  for (const row of rows) {
    await table.updateRow({ ROWID: str(row['ROWID']), ReadAt: String(now) });
  }
  return rows.length;
}

/**
 * Removes one entry for good.
 *
 * Dismissing a notification is the one place a hard delete is right: an inbox
 * the user has cleared should be empty, not full of hidden rows that a later
 * change to the read filter would resurrect.
 */
export async function removeEntry(
  app: CatalystApp,
  ownerId: string,
  notificationId: string,
): Promise<boolean> {
  const rowId = await findRowId(app, ownerId, notificationId);
  if (!rowId) return false;

  await app.datastore().table(INBOX_TABLE).deleteRow(rowId);
  return true;
}
