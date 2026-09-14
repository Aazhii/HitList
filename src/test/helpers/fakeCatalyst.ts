/**
 * An in-memory stand-in for Catalyst.
 *
 * Shared by every notification test, because the value of a fake here is that
 * it enforces what the real backend enforces — and three divergent copies of
 * "roughly Catalyst" would quietly stop testing that.
 *
 * What it reproduces, and why each one matters:
 *
 *   - a UNIQUE DedupeKey that throws `{ code: 'DUPLICATE_VALUE' }`, which is
 *     the idempotency the queue leans on rather than checking first
 *   - ZCQL's row-wrapped result shape (`{ TableName: { ...columns } }`), which
 *     is easy to forget and fails silently by returning undefined columns
 *   - every column read back as a string, as the datastore does, so code that
 *     assumes numbers survive a round trip is caught here rather than in
 *     production
 *
 * It is not a SQL engine. `executeZCQLQuery` pattern-matches the specific
 * predicates the notification code issues; a query it has not been taught is
 * silently over-broad, so a new query means a new clause here.
 */
import { expect } from 'vitest';
import type { CatalystApp } from '../../../server/notifications/types.ts';

export const QUEUE_TABLE = 'KaizenNotificationQueue';
export const INBOX_TABLE = 'KaizenNotifications';

export interface FakeOptions {
  /** Assert that only this table is ever touched. */
  onlyTable?: string;
  /** Make sendMail throw, as an unregistered sender does. */
  emailFails?: boolean;
  /** Make web push throw. */
  pushFails?: boolean;
}

export interface Fake {
  app: CatalystApp;
  tables: Record<string, Array<Record<string, string>>>;
  /** Rows in the queue table; the one most tests assert on. */
  rows: Array<Record<string, string>>;
  sentEmails: Array<{ to: string; subject: string }>;
  sentPush: Array<{ message: string; recipients: string[] }>;
}

export function fakeCatalyst(options: FakeOptions = {}): Fake {
  const tables: Record<string, Array<Record<string, string>>> = {
    [QUEUE_TABLE]: [],
    [INBOX_TABLE]: [],
  };
  const sentEmails: Array<{ to: string; subject: string }> = [];
  const sentPush: Array<{ message: string; recipients: string[] }> = [];
  let nextRowId = 1000;

  const app: CatalystApp = {
    datastore: () => ({
      table: (name: string) => {
        if (options.onlyTable) expect(name).toBe(options.onlyTable);
        tables[name] ??= [];
        const rows = tables[name];
        return {
          insertRow: async (row) => {
            if (name === QUEUE_TABLE) {
              const key = String(row.DedupeKey ?? '');
              // What Catalyst answers for a unique-constraint violation.
              if (rows.some((r) => r.DedupeKey === key)) {
                throw { code: 'DUPLICATE_VALUE', message: 'duplicate value for DedupeKey' };
              }
            }
            const stored: Record<string, string> = { ROWID: String(nextRowId++) };
            for (const [k, v] of Object.entries(row)) stored[k] = String(v ?? '');
            rows.push(stored);
            return stored;
          },
          updateRow: async (row) => {
            const found = rows.find((r) => r.ROWID === String(row.ROWID));
            if (!found) throw new Error('no such row');
            for (const [k, v] of Object.entries(row)) {
              if (k !== 'ROWID') found[k] = String(v ?? '');
            }
            return found;
          },
          deleteRow: async (rowId) => {
            const i = rows.findIndex((r) => r.ROWID === String(rowId));
            if (i >= 0) rows.splice(i, 1);
            return true;
          },
        };
      },
    }),

    zcql: () => ({
      executeZCQLQuery: async (query: string) => {
        const rows = tables[QUEUE_TABLE];

        const eq = (col: string): string | null =>
          query.match(new RegExp(`${col} = '([^']*)'`))?.[1] ?? null;
        const num = (col: string, op: string): number | null => {
          const m = query.match(new RegExp(`${col} ${op} (\\d+)`));
          return m ? Number(m[1]) : null;
        };
        const limit = Number(query.match(/LIMIT (\d+)/)?.[1] ?? Infinity);

        let out = rows.slice();

        const rowId = query.match(/ROWID = (\d+)/)?.[1];
        if (rowId) out = out.filter((r) => r.ROWID === rowId);

        for (const col of ['Status', 'SourceType', 'SourceId', 'OwnerId', 'DedupeKey'] as const) {
          const want = eq(col);
          if (want !== null) out = out.filter((r) => r[col] === want);
        }

        const fireAt = num('FireAt', '<=');
        if (fireAt !== null) out = out.filter((r) => Number(r.FireAt) <= fireAt);

        const sentBefore = num('SentAt', '<');
        if (sentBefore !== null) out = out.filter((r) => Number(r.SentAt) < sentBefore);
        if (/SentAt > 0/.test(query)) out = out.filter((r) => Number(r.SentAt) > 0);

        if (/ORDER BY FireAt ASC/.test(query)) {
          out.sort((a, b) => Number(a.FireAt) - Number(b.FireAt));
        }

        return out.slice(0, limit).map((r) => ({ [QUEUE_TABLE]: { ...r } }));
      },
    }),

    email: () => ({
      sendMail: async (mail) => {
        if (options.emailFails) throw { statusCode: 404, message: 'No such from_email' };
        sentEmails.push({ to: String(mail.to_email), subject: mail.subject });
        return true;
      },
    }),

    pushNotification: () => ({
      web: () => ({
        sendNotification: async (message: string, recipients: string[]) => {
          if (options.pushFails) throw new Error('push rejected');
          sentPush.push({ message, recipients });
          return true;
        },
      }),
    }),
  };

  return { app, tables, rows: tables[QUEUE_TABLE], sentEmails, sentPush };
}
