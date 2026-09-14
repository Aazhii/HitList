# Data Store

Catalyst's relational database. Reachable three ways: the SDK's table API, ZCQL (a SQL-like
language), and REST.

`[VERIFIED]` observed here · `[DOCS]` official, untested · `[DOCS-WRONG]` docs disagree with
observation · `[UNKNOWN]` not established.

---

## Column types

`[DOCS]` The available types and their stated limits:

| Type | Limit |
|---|---|
| `varchar` | 255 characters |
| `text` | 10,000 characters |
| `int` | 10 digits |
| `bigint` | 19 digits — epoch milliseconds fit |
| `double` | 17 digits including decimals |
| `boolean` | true / false |
| `date` | `YYYY-MM-DD` |
| `datetime` | `YYYY-MM-DD HH:MM:SS` |
| `encrypted text` | 10,000 characters |
| `foreign key` | references another table's `ROWID` |

### varchar is silently clamped to 255

`[VERIFIED]` We declared `Title` as `varchar` with `max_length: 500`. Catalyst **accepted the
request without error** and created the column at 255:

```
TaskId           varchar   max_length=64
Title            varchar   max_length=255   ← we asked for 500
Status           varchar   max_length=16
Note             text      max_length=10000
TaskOrder        int       max_length=10
CompletedAt      bigint    max_length=19
ReminderEnabled  boolean   max_length=50
```

So the 255 limit is real and enforced, but over-declaring is **not** an error you will be told
about. Query the column list after creating a table if the length matters.

> This project has a live bug from exactly that: the server validates titles up to 500
> characters against a column that stores 255. Anything longer is silently truncated or
> rejected at write time.

### Every value comes back as a string

`[VERIFIED]` Regardless of column type, the SDK returns strings. `TaskOrder` stored as `int`
reads back as `"3"`. Types matter for storage, ordering and validation — not for the shape of
what you receive. Coerce on read, always.

### System columns

`[DOCS]` Every table gets `ROWID` (BigInt primary key), `CREATORID`, `CREATEDTIME`,
`MODIFIEDTIME`. `ROWID` and `CREATORID` cannot be set by you.

---

## Reserved column names

`[VERIFIED]` `Priority` is reserved. Creating it fails with:

```
403 {"error_code":"INVALID_OPERATION",
     "message":"You cannot perform this operation. Column name cannot contain reserved keywords"}
```

We store it as `TaskPriority` and keep `priority` as the API field name.

This one has history worth knowing: this repo previously had two Catalyst clients, one using
`TaskPriority` and one using `Priority`, and nobody knew why. The answer is that whoever wrote
the first one hit this error and worked around it on one side only. **A reserved name will
quietly fork your schema if you let it.**

`[UNKNOWN]` The full list of reserved words. We only ever hit `Priority`. If a column creation
fails with `INVALID_OPERATION`, suspect the name first.

---

## Table permissions

`[DOCS]` The **App User** role gets **SELECT only** by default. Every insert, update and delete
fails until you widen it: Console → Data Store → *table* → Permissions.

`[VERIFIED]` The resulting errors do not mention permissions, which makes this hard to
diagnose from the failure alone. Two ways out:

- Use `scope: 'admin'` for data operations (what this project does — see
  [02-node-sdk](02-node-sdk.md#scope)), or
- Grant the App User role INSERT/UPDATE/DELETE in the console.

`[DOCS]` Table **scopes** are Global, Org or User. User scope gives per-user row isolation
without a `WHERE` clause, which is worth considering instead of an owner column.

---

## ids are BigInt

`[VERIFIED]` **This will bite you, and the error will point somewhere else entirely.**

Catalyst ids exceed `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991) and arrive as bare JSON
numbers:

```
real table_id     69251000000063001
after JSON.parse  69251000000063000   ← silently rounded
```

Every subsequent call with the rounded id fails:

```
404 {"error_code":"INVALID_ID","message":"No such Table with the given id exists"}
```

which reads as *the table does not exist* when in fact it does. Quote long integer literals
before parsing:

```js
function parseJsonPreservingBigIds(text) {
  // Only values that are runs of 16+ digits — far above any count the API returns.
  const safe = text.replace(/([:[,]\s*)(\d{16,})(?=\s*[,}\]])/g, '$1"$2"');
  return JSON.parse(safe);
}
```

The same applies to `ROWID` anywhere you parse raw Catalyst JSON.

### The second way it bites: `Number()` on the way back out `[VERIFIED]`

Parsing is only half of it. A `ROWID` you already hold **as a string** is still unsafe the moment
you put it through `Number()` — including to build a query:

```js
// WRONG. Number('69251000000086009') is 69251000000086010.
`SELECT ClaimToken FROM MyTable WHERE ROWID = ${Number(rowId)}`
```

There is no error. The query is valid, it simply matches a different row or none at all, and
returns an empty result. Code asking "did my write land?" concludes *no* and takes the wrong
branch.

This cost a working delivery queue here. Every claim wrote its token, re-read with a rounded id,
found nothing, concluded another worker had won the row, and delivered nothing — leaving rows
stranded with no error recorded anywhere.

Pass the digits through untouched instead, and refuse anything that is not a row id rather than
coercing it:

```js
function zcqlRowId(rowId) {
  const digits = String(rowId).trim();
  if (!/^\d{1,25}$/.test(digits)) throw new Error(`Not a row id: ${rowId}`);
  return digits;                      // never Number()
}
```

**Watch for this in tests too.** A fake backend issuing small row ids (`1000`, `1001`) passes
happily while production fails — and so does one issuing a round id like `...086000`, which is
exactly representable as a double and round-trips unchanged. Use realistic ids that do *not*
round-trip.

---

## Creating tables

`[DOCS]` The Node SDK has no `createTable`. Use REST, or the console.

```bash
# create a table
curl -X POST "$BASE/table" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"table_name":"KaizenTasks","table_scope":"GLOBAL"}'

# add columns — a BARE ARRAY
curl -X POST "$BASE/table/$TABLE_ID/column" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '[{"column_name":"Title","data_type":"varchar","max_length":255,
        "is_mandatory":"true","is_unique":"false",
        "search_index_enabled":"false","audit_consent":"false"}]'
```

Booleans in that payload are **strings** (`"true"`), not JSON booleans.

`[VERIFIED]` **Column creation returns intermittent `500 INTERNAL_SERVER_ERROR` and succeeds on
retry.** It happened twice in a single run here. Retry 5xx and network errors; do **not** retry
4xx — those are real answers (a bad name, a reserved keyword) and retrying just repeats the
mistake.

Working implementation: [`scripts/catalyst-setup.ts`](../../scripts/catalyst-setup.ts), run with
`pnpm catalyst:setup` (`--dry-run` to preview).

---

## REST payload shapes

`[DOCS-WRONG]` **The documented shape for row writes is wrong.** Published examples show
`{"data": [...]}`. This API rejects that:

```
400 {"error_code":"INVALID_INPUT","message":"The input value is not readable. Please check your input"}
```

What actually works — verified by probing all the variants:

| Operation | Method | Path | Body |
|---|---|---|---|
| Insert rows | `POST` | `/table/{name}/row` | **bare array** of row objects |
| Update rows | `PATCH` | `/table/{name}/row` | **bare array**, each entry carrying its own `ROWID` |
| Delete rows | `DELETE` | `/table/{name}/row?ids=<id>,<id>` | — |
| ZCQL | `POST` | `/query` | `{"query": "SELECT …"}` |
| Create column | `POST` | `/table/{id}/column` | **bare array** |
| Create table | `POST` | `/table` | object |

```bash
# insert
curl -X POST "$BASE/table/KaizenLists/row" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '[{"ListId":"list-work","OwnerId":"692510000000640130","Name":"Work Focus"}]'

# update
curl -X PATCH "$BASE/table/KaizenTasks/row" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '[{"ROWID":"69251000000075005","OwnerId":"69251000000064013"}]'
```

`[VERIFIED]` `PUT /table/{name}/row/{rowId}` — the per-row URL the docs describe — is rejected
with `INVALID_REQUEST_METHOD`.

When in doubt, probe: send the same row three ways and see which returns 200. That is how these
were established, and it takes a minute.

---

## ZCQL

A SQL-like language over your tables.

```js
const rows = await app.zcql().executeZCQLQuery(
  "SELECT ROWID, Title FROM KaizenTasks WHERE OwnerId = '69251000000064013'"
);
```

### Results are wrapped in the table name

`[VERIFIED]` Not flat rows:

```js
[ { KaizenTasks: { ROWID: '…', Title: '…' } } ]

const tasks = rows.map((r) => r.KaizenTasks);   // unwrap
```

A join returns one key per table in each element.

### Escaping

`[VERIFIED]` **ZCQL escapes a single quote by doubling it**, as SQL does — not with a
backslash. Backslash-escaping leaves the injected clause live:

```
value: a' OR '1'='1
wrong: 'a\' OR \'1\'=\'1'      ← the OR is still executable
right: 'a'' OR ''1''=''1'      ← inert literal
```

```ts
function zcqlString(value: string): string {
  const cleaned = value.replace(/[ -]/g, '');
  return `'${cleaned.replace(/'/g, "''")}'`;
}
```

Return the complete quoted literal, so a caller cannot forget the quotes. Validate identifiers
at the edge too — ours are UUIDs and Catalyst user ids, so `/^[A-Za-z0-9_-]{1,64}$/` rejects
anything that could reach a predicate.

`[UNKNOWN]` The full ZCQL grammar — supported operators, joins, `LIMIT`/`OFFSET` semantics, and
whether parameterised queries exist. We only ever used `SELECT … WHERE … LIMIT`. There is no
parameter binding that we found, which is why escaping matters.

`[DOCS]` `executeOLAPQuery()` for aggregations, `executeSearchQuery()` for full-text search
over columns with a search index.

---

## SDK table API

`[DOCS]` Signatures, from the official reference:

```js
const table = app.datastore().table('KaizenTasks');   // by name or numeric id; no network call

await table.insertRow({ Title: 'x' });                // → row with ROWID
await table.insertRows([{ … }, { … }]);
await table.getRow('69251000000075005');
await table.updateRow({ ROWID: '…', Title: 'y' });    // ROWID inside the object
await table.updateRows([{ ROWID: '…', … }]);
await table.deleteRow('69251000000075005');
await table.deleteRows(['…', '…']);                   // max 200
const { data, more_records, next_token } =
  await table.getPagedRows({ nextToken, maxRows: 100 });   // maxRows defaults to 200
```

`[DOCS]` `getAllRows()` is deprecated and caps at 200 — use `getPagedRows()`.

> **Note the asymmetry with REST.** The SDK carries `ROWID` *inside* the object for updates;
> the Web SDK v4 takes `updateRow(rowId, data)` with the id as a separate first argument. Code
> copied between them fails silently — this repo had exactly that drift.

`[DOCS]` Development environment caps at 5,000 rows per table and 25,000 per project. No limit
in production.

---

## This project's schema

Defined once in [`server/catalyst/schema.ts`](../../server/catalyst/schema.ts) and applied by
`pnpm catalyst:setup`.

| Table | Columns |
|---|---|
| `KaizenTasks` | `TaskId` varchar(64) unique · `OwnerId` varchar(64) · `Title` varchar · `Status` · `Quadrant` · `TaskPriority` · `Note` text · `DueDate` · `DueTime` · `Category` · `ListId` · `TaskOrder` int · `ReminderEnabled` bool · `ReminderMinutesBefore` int · `CompletedAt`/`CreatedAt`/`UpdatedAt` bigint |
| `KaizenLists` | `ListId` unique · `OwnerId` · `Name` · `Color` · `ListOrder` int · timestamps bigint |
| `KaizenNotes` | `NoteId` unique · `OwnerId` · `Title` · `BlocksJson` text · `Emoji` · `Pinned` bool · timestamps bigint |

`OwnerId` is mandatory on all three and carries the Catalyst `user_id`; every query filters on
it. `ROWID` stays internal — the API exposes `TaskId` / `ListId` / `NoteId`.

Two lessons embedded in that schema:

- **Keep it in one place.** It previously lived in three that had drifted apart.
- **Use real types.** An earlier version typed everything `text`, so `TaskOrder` sorted
  lexically — `"10"` before `"9"` — and epoch timestamps were compared as strings.
