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
 * It is not a SQL engine. `executeZCQLQuery` reads the table out of the FROM
 * clause and applies whatever equality and numeric comparisons the query
 * names, which covers everything this code issues without needing a clause per
 * query. What it does NOT understand — OR, joins, LIKE, parenthesised groups —
 * it silently ignores, so a test relying on one would pass for the wrong
 * reason.
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
  /** Every ZCQL query issued, in order. */
  queries: string[];
}

export function fakeCatalyst(options: FakeOptions = {}): Fake {
  const tables: Record<string, Array<Record<string, string>>> = {
    [QUEUE_TABLE]: [],
    [INBOX_TABLE]: [],
  };
  /** Every ZCQL query issued, so a test can assert on the query count. */
  const queries: string[] = [];
  const sentEmails: Array<{ to: string; subject: string }> = [];
  const sentPush: Array<{ message: string; recipients: string[] }> = [];
  // Catalyst row ids are BigInt and exceed Number.MAX_SAFE_INTEGER
  // (9007199254740991). Using realistic ones is not cosmetic: small ids let
  // code that coerces an id through Number() pass here and fail in
  // production, which is exactly what happened.
  //
  // The start value ends in 9 on purpose. A round number like ...086000 is
  // exactly representable as a double and round-trips through Number()
  // unchanged, so it would hide the very bug these ids exist to expose.
  let nextRowId = 69251000000086009n;

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
        queries.push(query);
        // Route by the table the query names. Answering everything from the
        // queue table was fine while only the queue issued queries; once the
        // sweep also plans rules, it silently hands rule code a queue row.
        const table = query.match(/FROM\s+(\w+)/i)?.[1] ?? QUEUE_TABLE;
        tables[table] ??= [];
        let out = tables[table].slice();

        // IN lists, before plain equality: the quoted values inside an IN
        // would otherwise be invisible, and the clause silently ignored.
        const inClauses = new Set<string>();
        for (const [whole, col, list] of query.matchAll(/(\w+)\s+IN\s*\(([^)]*)\)/gi)) {
          inClauses.add(whole);
          const allowed = new Set(
            [...list.matchAll(/'([^']*)'/g)].map((m) => m[1]),
          );
          out = out.filter((r) => allowed.has(r[col] ?? ''));
        }
        // Equality must not re-read the values inside an IN list as its own.
        let rest = query;
        for (const clause of inClauses) rest = rest.replace(clause, '');

        // Generic predicates, applied to whatever columns the query names, so
        // a new query does not need a new clause here.
        for (const [, col, value] of rest.matchAll(/(\w+)\s*=\s*'([^']*)'/g)) {
          out = out.filter((r) => (r[col] ?? '') === value);
        }
        // Unquoted equality, which is how ROWID and the bigint columns are
        // compared. Without this the predicate is silently ignored and a query
        // meant to select one row returns every row.
        //
        // Compared as digit strings first, then numerically. A ROWID exceeds
        // Number.MAX_SAFE_INTEGER, so comparing through Number() makes two
        // adjacent rows indistinguishable — the very bug realistic ids exist
        // here to catch.
        for (const [, col, value] of query.matchAll(/(\w+)\s*=\s*(-?\d+)(?!\d)/g)) {
          out = out.filter((r) => {
            const stored = String(r[col] ?? '');
            if (stored === value) return true;
            const a = Number(stored);
            const b = Number(value);
            return Number.isSafeInteger(a) && Number.isSafeInteger(b) && a === b;
          });
        }
        for (const [, col, op, value] of query.matchAll(/(\w+)\s*(<=|>=|<|>)\s*(-?\d+)/g)) {
          const n = Number(value);
          out = out.filter((r) => {
            const v = Number(r[col] ?? 0);
            return op === '<=' ? v <= n : op === '>=' ? v >= n : op === '<' ? v < n : v > n;
          });
        }

        const order = query.match(/ORDER BY (\w+) (ASC|DESC)/i);
        if (order) {
          const [, col, dir] = order;
          out.sort((a, b) => {
            const d = Number(a[col] ?? 0) - Number(b[col] ?? 0);
            return dir.toUpperCase() === 'DESC' ? -d : d;
          });
        }

        const limit = Number(query.match(/LIMIT (\d+)/)?.[1] ?? Infinity);
        return out.slice(0, limit).map((r) => ({ [table]: { ...r } }));
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

  return { app, tables, rows: tables[QUEUE_TABLE], sentEmails, sentPush, queries };
}
