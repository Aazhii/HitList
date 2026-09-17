# Zoho Calendar integration — design plan (Phase 1: one-way sync)

Written 16 September 2026, from a live look at the Zoho Calendar API (via the
`zoho_calender` MCP connection, exercised directly against Arikaran's own
account) and this repo's existing Calendar page, data store schema, and
notification-scheduling code.

**Evidence convention**, following `docs/notion-parity-plan.md`:

- `[CODE]` — read in this repo, at the line/file cited.
- `[MCP-VERIFIED]` — observed by calling the Zoho Calendar MCP tools live in
  this session (test events were created and deleted afterward; nothing was
  left behind). Response shapes below are real, not inferred from docs.
- `[ZOHO-DOCS]` — Zoho's public Calendar API documentation.
- `[UNVERIFIED]` — asserted nowhere I could confirm. Flagged, not assumed.

**Scope, as agreed**: one-way sync, Zoho Calendar → HitList. Events added,
edited, or deleted in Zoho reflect on HitList's Calendar page as read-only
items. Nothing in HitList writes back to Zoho yet — that's a later phase (§8).
Change detection: webhook-first if Zoho actually offers it, with a polling
delta-sync job underneath regardless (§4 explains why the polling job isn't
optional even if webhooks ship).

---

## 0. The one correction to the brief

**This app's server cannot use the MCP connection.** The `zoho_calender` MCP
tools in this session are authenticated as Arikaran, for this chat, to let
Claude read/write his calendar directly. HitList's Express server is a
separate, unattended process serving every HitList user — it needs its own
Zoho OAuth client (registered once in the Zoho API console) and its own
per-user token storage, the same way `CATALYST_CLIENT_ID` /
`CATALYST_CLIENT_SECRET` / `CATALYST_REFRESH_TOKEN` already exist for
Catalyst `[CODE server/catalyst/init.ts:56-66]`. The MCP tools were used below
only as a fast, safe way to inspect how Zoho's real API behaves — the app will
talk to `https://calendar.zoho.com/api/v1` (or its regional equivalent)
directly over HTTP.

---

## 1. What HitList has today

`[CODE]` The Calendar page (`src/pages/CalendarPage.tsx`) shows one month
grid built from two sources it already owns: tasks by `dueDate`
(`src/lib/calendar.ts:tasksByDay`) and database records by whichever date
field a database has chosen (`recordsByDay`). Both load in one request,
`GET /api/calendar`, and render through `UnifiedCalendar`
(`src/components/calendar/UnifiedCalendar.tsx`) as `CalendarItem`s grouped
into `CalendarSource`s that can be toggled on/off in the sidebar. There is no
concept of an external calendar anywhere in the codebase — no OAuth-to-a-
third-party pattern, no "connection" entity, no webhook receiver, nothing in
`server/catalyst/schema.ts` for it.

The pieces worth reusing are the *shape* of `CalendarItem`/`CalendarSource`
(a third `kind` slots in cleanly) and the background-job machinery already
built for notifications: `server/notifications/scheduler.ts` runs an
in-process interval plus an hourly Catalyst-cron backstop, with idempotent
claiming so multiple AppSail instances never double-fire
`[CODE server/notifications/scheduler.ts:1-30]`. That's exactly the shape a
calendar-sync tick needs.

---

## 2. What the Zoho Calendar API actually offers

### 2.1 OAuth

`[ZOHO-DOCS]` Standard Zoho OAuth2, registered as a **server-based client** at
[api-console.zoho.com](https://api-console.zoho.com/) — the same console
Arikaran already has an account on for the Catalyst client. Authorization-code
flow, `Authorization: Zoho-oauthtoken {access_token}` header, access tokens
last **1 hour**, refresh tokens don't expire on their own. Scopes follow
`ZohoCalendar.<resource>.<OPERATION>`; confirmed by fetching the actual doc
pages for two endpoints:

- `ZohoCalendar.calendar.READ` / `.ALL` — list/read calendars
  `[ZOHO-DOCS get-calendar-list.html]`
- `ZohoCalendar.event.READ` / `.ALL` — list/read events
  `[ZOHO-DOCS get-events-list.html]`

For Phase 1 (read-only, one-way) the app only ever needs **READ** scopes —
`ZohoCalendar.calendar.READ` and `ZohoCalendar.event.READ`. No write scope
means a leaked token can't be used to alter anyone's real calendar, which
matters since these are other people's Zoho accounts.

Like Catalyst, Zoho accounts are regional: `accounts.zoho.com`, `.eu`, `.in`,
`.com.au`, `.jp`, `.ca`, `.sa` `[ZOHO-DOCS, matches the same list already in
server/catalyst/region.ts]`. A user's Zoho account can be in a different data
centre than wherever HitList's Catalyst project lives — Arikaran's own test
account is `.in` (see §3). The data centre has to be stored per connection,
not assumed from one env var.

### 2.2 Events API

`[ZOHO-DOCS]` Standard CRUD: get calendar list, get/list events, create,
update, move, delete, attachments, free/busy. Base URL
`https://calendar.zoho.com/api/v1`. Nothing unusual.

### 2.3 The sync primitive — verified live, not just from docs

This is the one piece **not** in Zoho's public documentation pages (I checked
the Events API and Introduction pages directly — no mention of sync, delta,
or "modified since"). It's only exposed through this MCP server's
`initial_and_delta_sync_events` tool. I called it for real against Arikaran's
calendar to confirm the actual contract, since building a sync job on
guessed-at behavior would be a mistake:

**Step 1 — initial sync.** `isInitialSync=true`, no `lastmodified`. Returns
every event plus a cursor:
```
{ "next_modified_time": "1789540039605",
  "has_more_events": false,
  "events": [ { "uid": "...@zoho.in", "estatus": "added", "title": "...",
                "dateandtime": {...}, "lastmodifiedtime": "...",
                "etag": "1789540039605", ... full event object ... } ] }
```
`[MCP-VERIFIED]`

**Step 2 — an event is created.** `add_event` returns the full event with
`"estatus": "added"`. `[MCP-VERIFIED]`

**Step 3 — an event is edited.** `update_event` returns the full event with
`"estatus": "updated"` and a new `etag`. `[MCP-VERIFIED]`

**Step 4 — delta sync since a cursor.** `isInitialSync=false`,
`lastmodified=<previous next_modified_time>`. Returns only what changed,
each tagged with `estatus`:
- `"added"` or `"updated"` — full event object, same shape as initial sync.
  (When both a create and an edit happened after the cursor, only one
  `"added"` entry comes back with the latest state — Zoho collapses to net
  effect, not a change log. So the app only ever needs two handling paths:
  upsert or delete.)
- `"deleted"` — a **minimal** object, confirmed live:
  ```
  { "uid": "a4d471137e8a41e185edcc71efa15440@zoho.in",
    "estatus": "deleted", "calid": "...", "caluid": "..." }
  ```
  No title, no dateandtime — just enough to identify which row to tombstone.
  `[MCP-VERIFIED]`

A fresh `next_modified_time` comes back on every call — that's the cursor to
persist and pass as `lastmodified` next time.

**What this means for the design**: polling this endpoint is not a fallback
approximation of "real sync" — it *is* Zoho's real sync mechanism, and it
correctly reports adds, edits, and deletes. The only thing polling can't give
you is low latency between the Zoho-side change and HitList noticing it.

`[UNVERIFIED]`: the exact pagination continuation parameter when
`has_more_events: true` and a `limit` is set — the MCP tool schema exposes
`mode`, `isInitialSync`, `lastmodified`, `limit`, `fields` but nothing named
like `cursor`/`page`. Likely `lastmodified` is simply re-issued with the
latest `next_modified_time` seen so far, treating each page as its own delta
step, but this needs confirming against the raw HTTP contract before the sync
job assumes it, since one user's calendar could plausibly return more events
in one window than `limit` allows.

### 2.4 Push notifications / webhooks — not found

I looked for this directly, since it's the mechanism asked for. Zoho
Calendar's own `/notification` endpoint (`[ZOHO-DOCS notification-api.html]`)
turned out to be about a user's *own* email/popup notification **preferences**
— not outbound webhooks. I could not find any documented channel-subscribe /
push-on-change mechanism for Zoho Calendar, unlike Zoho CRM, which does
publish a channel-based Notifications API with documented channel expiry.
`[UNVERIFIED, leaning towards "does not exist for Calendar"]` — before any
engineering time goes into a webhook receiver, this needs a direct check with
Zoho (support@zohocalendar.com, or a careful look at whatever scopes/toggles
appear once a real OAuth client is registered in the API console). If it
turns out Calendar has no such feature publicly, that's not a blocker — §2.3
already establishes polling is functionally complete, just not instant.

---

## 3. Data model additions

Two new Catalyst tables, following the existing `OwnerId`-scoped,
`varchar/text/int/bigint/boolean`-typed pattern in
`server/catalyst/schema.ts`.

### `KaizenZohoConnections` — one row per user's linked Zoho account

| Column | Type | Notes |
|---|---|---|
| `ConnectionId` | varchar(64), unique | |
| `OwnerId` | varchar(64) | Catalyst user id, same as every other table |
| `ZohoAccountEmail` | varchar(255) | for the "Connected as ___" UI |
| `DataCentre` | varchar(8) | `com`\|`eu`\|`in`\|`com.au`\|`jp`\|`ca`\|`sa` — which `accounts.zoho.*` and `calendar.zoho.*` host to call |
| `RefreshTokenEnc` | text | AES-GCM encrypted at the app layer before storage — Catalyst has no native column encryption. Key from a new `ZOHO_TOKEN_ENCRYPTION_KEY` env var (not `CATALYST_`-prefixed, same reason `TICK_SECRET` isn't — see `.env.example`) |
| `Scope` | varchar(255) | granted scopes, for a visible audit trail |
| `SelectedCaluid` | varchar(64) | which Zoho calendar to mirror; empty until the user picks one after connecting |
| `SelectedCalName` | varchar(255) | denormalised for display without a round trip |
| `SyncCursor` | varchar(32) | `next_modified_time` from the last successful sync tick |
| `ConnStatus` | varchar(16) | `CONNECTED` \| `NEEDS_REAUTH` \| `DISCONNECTED` |
| `LastSyncedAt` | bigint | epoch ms |
| `LastSyncError` | text | surfaced in the settings panel rather than silently retried forever |
| `CreatedAt` / `UpdatedAt` | bigint | |

### `KaizenZohoEvents` — the read-only mirror the Calendar page renders from

| Column | Type | Notes |
|---|---|---|
| `MirrorId` | varchar(64), unique | hash of `ConnectionId` + Zoho `uid` |
| `OwnerId` | varchar(64) | |
| `ConnectionId` | varchar(64) | |
| `ZohoUid` | varchar(255) | Zoho's event uid, e.g. `a4d471...@zoho.in` — used to match delta updates |
| `Title` | varchar(255) | |
| `StartAt` / `EndAt` | bigint | epoch ms, normalised from Zoho's `yyyyMMddThhmmss+ZZZZ` |
| `IsAllDay` | boolean | |
| `Location` | varchar(255) | |
| `ViewEventURL` | varchar(500) | Zoho's own link — "open in Zoho Calendar" on the HitList side, since this is read-only |
| `LastModified` | bigint | from Zoho's `lastmodifiedtime`, for display/debugging only — `SyncCursor` above is the real drift-free cursor |
| `Deleted` | boolean | tombstone rather than hard delete on an `estatus: "deleted"` delta, so a late-arriving related event doesn't resurrect it and so "it disappeared" is debuggable |
| `CreatedAt` / `UpdatedAt` | bigint | |

Deliberately **not** storing the event description/attendees — this is a
read-only reflection for calendar-grid display, not a full mirror; storing
less of someone's calendar content is less to secure and less to keep in
sync. Add fields later only if the UI needs them.

---

## 4. OAuth connect / disconnect flow

New routes, following the existing `/api/<noun>` convention
(`[CODE server/notes-server.ts]` route list):

- `GET /api/integrations/zoho-calendar/status` — current user's connection
  row, or `{connected: false}`.
- `GET /api/integrations/zoho-calendar/connect` — builds the Zoho consent URL
  (`response_type=code&scope=ZohoCalendar.calendar.READ,ZohoCalendar.event.READ&access_type=offline&prompt=consent&redirect_uri=...`)
  and redirects the browser to it.
- `GET /api/integrations/zoho-calendar/callback` — the registered redirect
  URI. Exchanges the `code` for tokens, encrypts and stores the refresh
  token, redirects back into the app (`/?zoho=connected` or `?zoho=error`).
- `GET /api/integrations/zoho-calendar/calendars` — lists the connected
  account's calendars (`ZohoCalendar_get_calendars` equivalent), for the
  picker.
- `PUT /api/integrations/zoho-calendar/settings` — sets `SelectedCaluid`;
  triggers an initial full sync.
- `POST /api/integrations/zoho-calendar/disconnect` — deletes the connection
  row and its mirrored events. (Revoking the token at Zoho's end too, via
  their token-revoke endpoint, is the polite thing to do here — not just a
  local delete.)

Access-token refresh at call time follows the same TTL-cached pattern as
`accessTokenFromCli` (`[CODE server/catalyst/cliCredentials.ts:44-49]`): mint
once, cache comfortably inside the 1-hour lifetime, refresh on a 401.

---

## 5. The sync job

New `server/integrations/zohoCalendar/sync.ts`, structured like
`server/notifications/scheduler.ts` + `sweep.ts`: a bounded interval inside
the server process, with an hourly Catalyst-cron backstop for when an AppSail
instance has been idle and stopped
`[CODE server/notifications/scheduler.ts:14-27]`.

Each tick, for every `CONNECTED` row in `KaizenZohoConnections`:

1. Refresh the access token if needed.
2. If `SyncCursor` is empty: full `isInitialSync=true` pull, paginated,
   upsert every event into `KaizenZohoEvents`, set `SyncCursor` to the
   returned `next_modified_time`.
3. Otherwise: `isInitialSync=false&lastmodified=<SyncCursor>`. For each
   returned event: `estatus in {added, updated}` → upsert (match on
   `ZohoUid`); `estatus: deleted` → set `Deleted=true` on the matching row.
   Persist the new `next_modified_time` as `SyncCursor` **only after** every
   page in the batch has been written — same reasoning as the notification
   queue's claim-then-confirm pattern, so a crash mid-tick re-processes
   rather than silently skips.
4. On a 401 that survives one token refresh, or repeated failures: set
   `ConnStatus = NEEDS_REAUTH`, record `LastSyncError`, stop polling that
   connection until the user reconnects. (Never fail silently forever — the
   settings panel should show "reconnect needed.")

Interval: start at 5 minutes, matching `DEFAULT_INTERVAL_MS`
(`[CODE server/notifications/scheduler.ts:39]`) and Zoho's documented (if
vague) 429 throttling `[ZOHO-DOCS api-limits.html]` — a per-connection tick is
one cheap delta call, so this scales the same way the notification sweep
already argues it does.

If Zoho's push-notification story checks out (§2.3), a webhook receiver
becomes an *addition*, not a replacement: `POST
/api/internal/zoho-calendar/webhook` would simply trigger an out-of-schedule
run of step 3 above for the affected connection, rather than trusting the
webhook payload's own content. That keeps correctness anchored to the
verified delta endpoint regardless of whether the push mechanism is real,
well-documented, or reliable.

---

## 6. Surfacing it in the Calendar page

`[CODE]` `CalendarItem` currently has `kind: 'task' | 'record'`
(`src/pages/CalendarPage.tsx:63-77`). Add a third: `kind: 'zoho-event'`,
read-only — no `onMove` handler wired for it, since Phase 1 doesn't write
back. `calendarApi.load()` (`src/lib/api.ts:694-698`) gains a third array,
`zohoEvents`, sourced from `GET /api/calendar` joining in
`KaizenZohoEvents WHERE Deleted = false`. Each connected calendar becomes one
more `CalendarSource` in the existing toggle list, exactly like a database
already does (`src/pages/CalendarPage.tsx:82-93`) — nothing new to build in
`UnifiedCalendar` itself beyond rendering the third kind and, since it's
read-only, opening `ViewEventURL` in a new tab instead of the task/record
detail panel.

A small settings panel, modeled on `RemindersSettingsPanel.tsx`: "Connect
Zoho Calendar" button → redirect → calendar picker once connected → shows
`ZohoAccountEmail`, last-synced time, a disconnect button, and — if
`ConnStatus = NEEDS_REAUTH` — a reconnect prompt.

---

## 7. Security notes

- Store only the refresh token, encrypted; never the access token (1-hour
  lifetime, minted on demand).
- Read-only scopes only, for Phase 1 — no `ZohoCalendar.event.ALL` until
  write-back is actually being built.
- The webhook receiver, if built, must verify the request is genuinely from
  Zoho before triggering a sync — exact verification mechanism is one more
  thing to confirm once/if the feature itself is confirmed to exist.
- Disconnect should revoke the token at Zoho, not just forget it locally.

---

## 8. Explicitly out of scope for now — two-way sync

Noted per your answer, for whenever this comes up next: writing HitList
tasks back to Zoho as events needs a mapping table (`TaskId` ↔ `ZohoUid`), a
conflict rule (likely last-`UpdatedAt`-wins, both sides already have one), and
loop prevention — a delta-sync tick must recognise "this event's `ZohoUid` is
one we just wrote" and not re-import it as if it were an external change.
None of Phase 1's tables need to change shape to support this later; the
mapping table is additive.

---

## 9. Open questions before building

1. **Webhook support** — confirm with Zoho directly (§2.3) before any receiver
   code is written; otherwise the 5-minute poll is what ships and that's fine.
2. **Which calendars sync** — Phase 1 assumes one selected calendar per
   connection (simplest UI). Confirm that's right, versus syncing all of a
   user's calendars at once.
3. **Multi-page delta responses** — confirm the real pagination contract
   (§2.3) before trusting `limit` + repeated `lastmodified` calls to be
   lossless on a busy calendar.
4. Worth a small UX bridge even while sync stays one-way: a "Turn into task"
   button on a mirrored Zoho event? Doesn't require write-back, since it just
   creates a new independent HitList task.

## 10. Suggested build order

1. Zoho API console app registration (Arikaran, self-service) + schema
   migration for the two new tables + `ZOHO_TOKEN_ENCRYPTION_KEY`.
2. OAuth connect/disconnect + calendar picker UI. No event data flowing yet —
   this phase is entirely about proving the token lifecycle works.
3. Initial full pull + the polling delta-sync tick + `KaizenZohoEvents` +
   Calendar page rendering the third source, read-only.
4. Webhook verification and, if real, the receiver — latency improvement
   only, not a correctness dependency.
5. (Later) two-way sync, per §8.
