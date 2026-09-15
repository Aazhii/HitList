/**
 * The notification outbox.
 *
 * Every delivery — a task reminder, an automation firing, a digest — becomes a
 * row here with an absolute `FireAt`, and a sweep drains whatever is due.
 *
 * Why a queue rather than a sweep that examines tasks directly: the scanning
 * design reads every candidate row on every tick, so its cost grows with the
 * size of the database rather than with the amount of work actually waiting. A
 * quiet tick here returns **no rows at all**, whatever the table holds. That is
 * what makes the tick cheap enough to run often, and it is the same property
 * that lets it scale.
 *
 * Two mechanisms carry the correctness, and both matter because AppSail
 * auto-scales to 1–5 instances (see docs/catalyst/05-appsail-deploy.md):
 *
 *   DedupeKey is unique, so the same logical delivery cannot be enqueued
 *   twice — by a retry, a double-save, or two instances racing.
 *
 *   Status moves PENDING → SENDING before anything is delivered, so an
 *   overlapping or replayed tick finds nothing left to claim.
 *
 * Both live in the database. In-memory state would be per-instance, and so
 * would be no protection at all.
 */
import type { CatalystApp } from './types.ts';
import { zcqlString, zcqlRowId, unwrapRows, str, num } from './zcql.ts';
import { QUEUE_TABLE } from '../catalyst/schema.ts';

// ── Status ────────────────────────────────────────────────────────────────────

export const QueueStatus = {
  /** Waiting for its FireAt to arrive. */
  PENDING: 'PENDING',
  /** Claimed by a sweep; delivery in progress. */
  SENDING: 'SENDING',
  SENT: 'SENT',
  /** Delivery failed and the retry budget is spent. */
  FAILED: 'FAILED',
  /** The thing it was reminding about changed or went away. */
  CANCELLED: 'CANCELLED',
} as const;

export type QueueStatusValue = typeof QueueStatus[keyof typeof QueueStatus];

/** Delivery attempts before a row is given up on. */
export const MAX_ATTEMPTS = 3;

/**
 * Most rows a single sweep will claim.
 *
 * Bounded so one tick cannot run long enough to overlap the next. Anything left
 * over is picked up by the following tick, because the query selects
 * `FireAt <= now` rather than an exact match — a backlog drains rather than
 * being stranded.
 */
export const SWEEP_LIMIT = 100;

// ── Shapes ────────────────────────────────────────────────────────────────────

export interface QueueEntry {
  ownerId: string;
  /** Absolute epoch ms — see notifications/schedule.ts. */
  fireAt: number;
  dedupeKey: string;
  kind: 'TASK_REMINDER' | 'AUTOMATION' | 'DIGEST';
  sourceType: 'TASK' | 'RULE';
  sourceId: string;
  channels: string[];
  title: string;
  body: string;
  payload?: Record<string, unknown>;
}

export interface QueueRow extends QueueEntry {
  /** Catalyst's internal row id, needed for updates. */
  rowId: string;
  queueId: string;
  status: QueueStatusValue;
  attemptCount: number;
  /** Identifies whichever sweep currently holds the row. See claim(). */
  claimToken: string;
}

// ── ZCQL helpers ─────────────────────────────────────────────────────────────

/** ZCQL returns rows keyed by table name rather than flat. */
function unwrap(results: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return unwrapRows(results, QUEUE_TABLE);
}

const SELECT_COLUMNS =
  'ROWID,QueueId,OwnerId,FireAt,Status,DedupeKey,Kind,SourceType,SourceId,' +
  'Channels,Title,Body,Payload,AttemptCount,SentAt,ClaimToken';

function toQueueRow(row: Record<string, unknown>): QueueRow {
  let payload: Record<string, unknown> | undefined;
  const rawPayload = str(row['Payload']);
  if (rawPayload) {
    // A row with unreadable payload should still deliver its title and body.
    try { payload = JSON.parse(rawPayload) as Record<string, unknown>; } catch { payload = undefined; }
  }

  return {
    rowId: str(row['ROWID']),
    claimToken: str(row['ClaimToken']),
    queueId: str(row['QueueId']),
    ownerId: str(row['OwnerId']),
    fireAt: num(row['FireAt']),
    status: str(row['Status']) as QueueStatusValue,
    dedupeKey: str(row['DedupeKey']),
    kind: str(row['Kind']) as QueueEntry['kind'],
    sourceType: str(row['SourceType']) as QueueEntry['sourceType'],
    sourceId: str(row['SourceId']),
    channels: str(row['Channels']).split(',').map((c) => c.trim()).filter(Boolean),
    title: str(row['Title']),
    body: str(row['Body']),
    payload,
    attemptCount: num(row['AttemptCount']),
  };
}

// ── Writing ───────────────────────────────────────────────────────────────────

/**
 * Adds an entry, or does nothing if one with the same DedupeKey already exists.
 *
 * Returns true when a row was created. Callers can treat a false as success —
 * it means the delivery was already scheduled, which is the point of the key.
 *
 * The duplicate is caught rather than pre-checked: a SELECT-then-INSERT has a
 * race between the two statements, and with several AppSail instances that race
 * is real. The unique constraint is the only check that cannot be interleaved.
 */
export async function enqueue(app: CatalystApp, entry: QueueEntry): Promise<boolean> {
  const now = Date.now();
  const table = app.datastore().table(QUEUE_TABLE);

  try {
    await table.insertRow({
      QueueId: crypto.randomUUID(),
      OwnerId: entry.ownerId,
      FireAt: String(entry.fireAt),
      Status: QueueStatus.PENDING,
      DedupeKey: entry.dedupeKey,
      Kind: entry.kind,
      SourceType: entry.sourceType,
      SourceId: entry.sourceId,
      Channels: entry.channels.join(','),
      ClaimToken: '',
      Title: entry.title.slice(0, 255),
      Body: entry.body,
      Payload: entry.payload ? JSON.stringify(entry.payload) : '',
      AttemptCount: '0',
      SentAt: '0',
      CreatedAt: String(now),
      UpdatedAt: String(now),
    });
    return true;
  } catch (e) {
    if (isDuplicateKey(e)) return false;
    throw e;
  }
}

/** A unique-constraint rejection, as opposed to a real failure. */
function isDuplicateKey(e: unknown): boolean {
  const text = describe(e).toLowerCase();
  return text.includes('duplicate')
    || text.includes('already exists')
    || text.includes('unique');
}

/** The SDK throws plain objects, so String(e) gives "[object Object]". */
function describe(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    const parts = [o['name'], o['code'], o['statusCode'], o['message']]
      .filter((v) => v !== undefined && v !== null)
      .map(String);
    if (parts.length) return parts.join(' | ');
    try { return JSON.stringify(e); } catch { /* fall through */ }
  }
  return String(e);
}

// ── Reading ───────────────────────────────────────────────────────────────────

/**
 * Entries that are due.
 *
 * `FireAt <= now`, not `== now`: a sweep that missed its slot — a redeploy, a
 * paused cron, an instance restart — must still deliver what it skipped. This
 * single comparison is what makes the system self-healing.
 */
export async function findDue(
  app: CatalystApp,
  now: number,
  limit: number = SWEEP_LIMIT,
): Promise<QueueRow[]> {
  const results = await app.zcql().executeZCQLQuery(
    `SELECT ${SELECT_COLUMNS} FROM ${QUEUE_TABLE} ` +
    `WHERE Status = ${zcqlString(QueueStatus.PENDING)} AND FireAt <= ${Number(now)} ` +
    `ORDER BY FireAt ASC LIMIT ${Number(limit)}`,
  );
  return unwrap(results).map(toQueueRow);
}

/**
 * How long a row may sit in SENDING before another sweep may take it back.
 *
 * A claim is only ever held for the length of one delivery, so anything still
 * SENDING after this was abandoned — the instance died mid-delivery, or the
 * request was cut off. Generous enough that a slow-but-live delivery is never
 * stolen from underneath itself.
 */
export const CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Rows abandoned mid-delivery, returned to PENDING.
 *
 * Without this, a sweep that dies after claiming leaves the row SENDING
 * forever: findDue only selects PENDING, so nothing ever looks at it again and
 * the notification is silently lost. That is the one outcome the whole design
 * is meant to prevent, and it is invisible — no error, no retry, no record.
 *
 * Found the hard way. A row-id rounding bug made every claim's verification
 * fail, and every swept row ended up stranded in SENDING with no error
 * recorded. The rounding is fixed; this is the backstop for every other way a
 * delivery can be interrupted.
 *
 * Reclaiming risks delivering twice if the original delivery did in fact
 * complete after the timeout. That is the right trade at ten minutes: a
 * duplicate is an annoyance, a silently dropped reminder is the bug.
 */
export async function reclaimStale(
  app: CatalystApp,
  now: number,
  limit: number = SWEEP_LIMIT,
): Promise<number> {
  const cutoff = now - CLAIM_TIMEOUT_MS;
  const results = await app.zcql().executeZCQLQuery(
    `SELECT ROWID, AttemptCount FROM ${QUEUE_TABLE} ` +
    `WHERE Status = ${zcqlString(QueueStatus.SENDING)} AND UpdatedAt <= ${Math.floor(cutoff)} ` +
    `LIMIT ${Number(limit)}`,
  );

  const rows = unwrap(results);
  let reclaimed = 0;
  for (const row of rows) {
    const attempts = num(row['AttemptCount']);
    // The attempt was already counted when the row was claimed, so a stranded
    // row must not get an unlimited number of second chances.
    const exhausted = attempts >= MAX_ATTEMPTS;
    await setStatus(app, str(row['ROWID']), {
      Status: exhausted ? QueueStatus.FAILED : QueueStatus.PENDING,
      ClaimToken: '',
      LastError: exhausted
        ? 'abandoned mid-delivery, and out of attempts'
        : 'abandoned mid-delivery; returned to the queue',
    });
    reclaimed++;
  }
  return reclaimed;
}

/** Pending entries for a source, used when cancelling. */
export async function findPendingForSource(
  app: CatalystApp,
  sourceType: QueueEntry['sourceType'],
  sourceId: string,
): Promise<QueueRow[]> {
  const results = await app.zcql().executeZCQLQuery(
    `SELECT ${SELECT_COLUMNS} FROM ${QUEUE_TABLE} ` +
    `WHERE SourceType = ${zcqlString(sourceType)} AND SourceId = ${zcqlString(sourceId)} ` +
    `AND Status = ${zcqlString(QueueStatus.PENDING)}`,
  );
  return unwrap(results).map(toQueueRow);
}

// ── State transitions ─────────────────────────────────────────────────────────

async function setStatus(
  app: CatalystApp,
  rowId: string,
  fields: Record<string, string | number>,
): Promise<void> {
  await app.datastore().table(QUEUE_TABLE).updateRow({
    ROWID: rowId,
    UpdatedAt: String(Date.now()),
    ...fields,
  });
}

/**
 * Takes ownership of an entry before delivering it.
 *
 * Returns true only for the caller that actually won the row.
 *
 * This has to be an optimistic lock rather than a conditional write. Catalyst
 * offers no `UPDATE … WHERE Status = 'PENDING'` and reports no affected-row
 * count, so "did my update apply?" cannot be answered directly. Instead the
 * claimer writes a token of its own and reads the row back: if the token that
 * stuck is not ours, another sweep got there first and we must not deliver.
 *
 * Without this, two sweeps that both saw the row PENDING would both write
 * SENDING and both deliver — which is exactly what happens when a retried cron
 * overlaps a slow tick. A message sent twice cannot be recalled, so the claim
 * always happens BEFORE any channel is touched; a row left in SENDING can be
 * recovered later, a duplicate email cannot.
 */
export async function claim(app: CatalystApp, row: QueueRow): Promise<boolean> {
  const token = crypto.randomUUID();

  await setStatus(app, row.rowId, {
    Status: QueueStatus.SENDING,
    ClaimToken: token,
    AttemptCount: String(row.attemptCount + 1),
  });

  const results = await app.zcql().executeZCQLQuery(
    `SELECT ClaimToken FROM ${QUEUE_TABLE} WHERE ROWID = ${zcqlRowId(row.rowId)}`,
  );
  const current = unwrap(results)[0];
  return current !== undefined && String(current['ClaimToken'] ?? '') === token;
}

export async function markSent(app: CatalystApp, row: QueueRow): Promise<void> {
  await setStatus(app, row.rowId, {
    Status: QueueStatus.SENT,
    SentAt: String(Date.now()),
    ClaimToken: '',
    LastError: '',
  });
}

/**
 * Records a failure, returning the row to PENDING while attempts remain.
 *
 * Retries are bounded: a channel that is misconfigured rather than briefly
 * unavailable would otherwise be retried on every tick forever.
 */
export async function markFailed(
  app: CatalystApp,
  row: QueueRow,
  error: unknown,
): Promise<void> {
  const attempts = row.attemptCount + 1;
  const exhausted = attempts >= MAX_ATTEMPTS;

  await setStatus(app, row.rowId, {
    Status: exhausted ? QueueStatus.FAILED : QueueStatus.PENDING,
    ClaimToken: '',
    LastError: describe(error).slice(0, 500),
  });
}

/**
 * Fails an entry outright, without spending the retry budget.
 *
 * For failures that retrying cannot fix — every channel disabled, no sender
 * configured, an unknown channel name. These are configuration, not transient
 * faults, and returning the row to PENDING would have it fail identically on
 * every tick until its attempts ran out.
 */
export async function markUndeliverable(
  app: CatalystApp,
  row: QueueRow,
  reason: string,
): Promise<void> {
  await setStatus(app, row.rowId, {
    Status: QueueStatus.FAILED,
    ClaimToken: '',
    LastError: reason.slice(0, 500),
  });
}

/**
 * Cancels everything still pending for a source.
 *
 * Called when a task is completed, deleted, or has its reminder turned off.
 * Cancelling rather than deleting keeps the history intact and makes it
 * possible to see why an expected reminder never arrived.
 */
export async function cancelPendingFor(
  app: CatalystApp,
  sourceType: QueueEntry['sourceType'],
  sourceId: string,
): Promise<number> {
  const rows = await findPendingForSource(app, sourceType, sourceId);
  for (const row of rows) {
    await setStatus(app, row.rowId, { Status: QueueStatus.CANCELLED });
  }
  return rows.length;
}

/**
 * Cancels pending entries for a source EXCEPT the one we are keeping.
 *
 * The re-scheduling case: a task's due date moves, so the new reminder has a
 * different DedupeKey and the old row must not also fire. Passing the key to
 * keep makes this safe to call unconditionally on every task write — if
 * nothing changed, the key matches and nothing is cancelled.
 */
export async function cancelSupersededFor(
  app: CatalystApp,
  sourceType: QueueEntry['sourceType'],
  sourceId: string,
  // A list, not one key: a rule fires at several steps, and each one's pending
  // row is a sibling of the others rather than something they supersede.
  // Keeping only the current key here would have each step cancel the rest.
  keepDedupeKeys: readonly string[],
): Promise<number> {
  const keep = new Set(keepDedupeKeys);
  const rows = await findPendingForSource(app, sourceType, sourceId);
  let cancelled = 0;
  for (const row of rows) {
    if (keep.has(row.dedupeKey)) continue;
    await setStatus(app, row.rowId, { Status: QueueStatus.CANCELLED });
    cancelled++;
  }
  return cancelled;
}

// ── Housekeeping ──────────────────────────────────────────────────────────────

/** How long delivered rows are kept before the sweep clears them. */
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Deletes delivered entries past the retention window.
 *
 * Without this the queue only grows, and the table that was chosen for being
 * cheap to query slowly becomes the next scaling problem.
 */
export async function purgeOldEntries(
  app: CatalystApp,
  now: number,
  limit = 200,
): Promise<number> {
  const cutoff = now - RETENTION_MS;
  const results = await app.zcql().executeZCQLQuery(
    `SELECT ROWID FROM ${QUEUE_TABLE} ` +
    `WHERE Status = ${zcqlString(QueueStatus.SENT)} AND SentAt < ${Number(cutoff)} ` +
    `AND SentAt > 0 LIMIT ${Number(limit)}`,
  );

  const rows = unwrap(results);
  const table = app.datastore().table(QUEUE_TABLE);
  for (const row of rows) {
    await table.deleteRow(String(row['ROWID']));
  }
  return rows.length;
}
