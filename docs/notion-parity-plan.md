# HitList vs Notion — data model, gap analysis, and a build plan

Written 15 September 2026. Four phases, as briefed, plus corrections to the brief itself.

**Evidence convention**, because it matters more than usual here:

- `[CODE]` — read in this repo, at the line cited. Assertions are quoted.
- `[CAT-DOCS]` — Zoho Catalyst's official documentation, linked.
- `[REPO-DOCS]` — this repo's `docs/catalyst/` notes, which carry their own
  `[VERIFIED]` / `[DOCS]` / `[UNKNOWN]` marks. Those marks are preserved below.
- `[NOTION]` — Notion's own help centre / developer docs, linked.
- `[UNVERIFIED]` — not established. Not filled in from assumption.

Anything not marked is my argument, not a fact.

---

## 0. Corrections to the brief — read this first

Four things in the brief are contradicted by the code or by Catalyst's own
documentation. Two of them change the design; one is a live bug.

### 0.1 "ZCQL is not full SQL: no joins" — wrong. ZCQL has joins.

`[CAT-DOCS]` [JOIN Clause](https://docs.catalyst.zoho.com/en/cloud-scale/help/zcql/joins/):

- `INNER JOIN` and `LEFT JOIN` are supported. (`RIGHT`/`FULL OUTER` are not mentioned.)
- **"You can combine a maximum of four joins in a single ZCQL query."**
- Columns must be fully qualified as `table_name.column_name` in a joined query.
- **"You can only write one JOIN condition for each join clause."**

This repo's own notes never claimed otherwise — `docs/catalyst/11-unknowns.md:27`
lists "Supported operators, **joins**, subqueries, `LIMIT`/`OFFSET` semantics" as
**`[UNKNOWN]`**, and `docs/catalyst/07-other-services.md:124` says to choose Data
Store "when you need ZCQL, **joins**, or a fixed relational" schema. So "no joins"
was an assumption that hardened into a constraint. It is the single most
consequential correction here: a side table for typed task properties is
queryable in one round trip rather than N+1, which is what makes §4's property
model affordable at all.

`[UNVERIFIED]` — whether joins work against *this* project's tables, and how they
interact with the row cap below. Verify before building on them (§7.1).

### 0.2 The real ceiling is not joins. It is 300 rows and 20 columns per SELECT.

`[CAT-DOCS]` [General Syntax of SELECT](https://docs.catalyst.zoho.com/en/cloud-scale/help/zcql/select/):

> "You can fetch a maximum of 20 columns and a maximum of 300 rows in one SELECT query."
> "`SELECT *` allows you to fetch a maximum of 300 rows in one query."

`[CAT-DOCS]` [LIMIT Clause](https://docs.catalyst.zoho.com/en/cloud-scale/help/zcql/limit/) —
pagination is `LIMIT offset, value`, MySQL-style, offset optional. So `OFFSET`
*does* exist, which `docs/catalyst/11-unknowns.md` also marks `[UNKNOWN]`.

Set against what the code actually does `[CODE]`:

| Query | Columns | LIMIT? |
|---|---|---|
| `GET /api/tasks` → `catalystGetOwnerRows` (`notes-server.ts:870`) | 17, or **19** once `SourceNoteId`/`SourceBlockId` are probed in | **none** |
| `GET /api/notes` (`notes-server.ts:2728`) | 8 | **none** |
| `catalystFindNote` (`notes-server.ts:2697`) | 9 with `ROWID` | **none** |
| `listRules` (`automations/rules.ts:194`) | **24**, or **25** with `OffsetSteps` | **none** |
| `findTaskRules` (`automations/taskTriggers.ts:45`) | 24–25 | **none** |
| `findPendingForSource` (`notifications/queue.ts:257`) | 16 | **none** |
| queue `findDue` / `reclaimStale` / `purge` | 16 | yes (100/100/200) |
| `inbox` list | 11 | yes (200) |

Two conclusions, both actionable today:

1. **Every unbounded list read silently truncates at 300 rows.** No error, no
   warning, no `has_more`. A user past 300 tasks loses tasks from the matrix;
   past 300 notes, loses notes. The server compounds this by fetching every
   owner row and filtering **in Node** (`notes-server.ts:2060`), so `?search=`
   searches a silently-truncated set. This is a correctness bug, not a
   scaling concern, and it is the reason §4's first two items are not features.

2. **`KaizenTasks` is at 19 of 20 permitted columns.** One more column on that
   table breaks every task read. This single number drives most of the schema
   design below: **new task fields go in side tables, not on `KaizenTasks`.**

3. **`listRules` selects 24–25 columns against a documented maximum of 20.**
   `[UNVERIFIED]` whether Catalyst enforces this by erroring or by silently
   dropping columns. Escalation demonstrably works in production, so it is
   probably not hard-enforced — but this needs a five-minute check before
   anything else is built (§7.1), because if it *is* enforced by truncation,
   rule fields are being read as empty and the compatibility shims in
   `steps.ts` would mask it.

### 0.3 A live bug: `SourceId` is `varchar(64)` and receives 73 characters

`[CODE]` `server/catalyst/schema.ts` — `KaizenNotificationQueue`:

```ts
{ name: 'SourceId', type: 'varchar', maxLength: 64 },
```

`[CODE]` `server/automations/taskTriggers.ts`, `applyRuleToTask`:

```ts
sourceId: `${rule.id}:${task.id}`,
```

Both ids are `randomUUID()` = 36 characters, so 36 + 1 + 36 = **73 > 64**.
`queue.ts:enqueue` writes `SourceId` with no `slice`, unlike `Title`, which is
sliced to 255. Either outcome is bad:

- **Catalyst rejects the insert.** `enqueue` swallows only duplicate-key errors,
  so the throw reaches `syncTaskRules`'s catch → `console.warn` and nothing
  else. Every `due-date` / `overdue` / `status-change` rule then **silently
  never queues**, while the task write still succeeds by design.
- **Catalyst truncates to 64.** Then every later
  `findPendingForSource(… SourceId = '<73 chars>')` matches nothing, so
  `cancelSupersededFor` and `cancelPendingFor` become no-ops and stale firings
  are never withdrawn.

`src/test/helpers/fakeCatalyst.ts` enforces no column lengths, so the suite
passes either way. **Check this against the live project before building
anything on task-driven rules.** Related: `DELETE /api/automation-rules/:id`
calls `cancelPendingFor(catalyst, 'RULE', req.params.id)` with the *bare* rule
id, so even when the composite works, deleting a rule leaves its per-task
firings `PENDING` and they deliver from a rule that no longer exists.

### 0.4 The Notion inventory could not be done from your workspace

Your workspace contains two databases, both stock template content created at
09:55 IST on 15 September 2026:

- **"Todo List"** (inline in a page "To Do List") — 7 rows, every one the
  template's own instructions (*"Click the blue New button to add a task"*).
  Properties: `Task name` (title), `Status` (status), `Due date` (date),
  `Assignee` (person). Two list views, "To Do" and "Done", the latter filtered
  `Status is group Complete`.
- **"New database"** — 1 empty row, one `Name` title property, one table view,
  inside the untouched "Welcome to Notion" page.

No relations, rollups, formulas, multi-selects, boards, calendars or timelines.
So **Phase 2 as briefed — "which property types do I use constantly, rarely,
never" — has no answer**, and the Phase 3 instruction to rank "against how I
actually use Notion" has no evidence base. Per your instruction, §2 is therefore
Notion's *real* feature set researched from Notion's own documentation, and §3
ranks against **how HitList is actually built and what personal task execution
needs** — not against your Notion habits, which don't exist yet. Everywhere that
substitution changes a judgement, I say so.

One genuine benefit: your workspace's own API responses verified the
database/data-source/view model in §2.1 first-hand rather than from documentation.

---

## 1. Phase 1 — HitList's actual data model

### 1.1 Seven tables, not three

`[CODE]` `server/catalyst/schema.ts` is the single source of truth (it says so,
and records that the schema previously lived in three places that had drifted).

| Table | Purpose | Cols |
|---|---|---|
| `KaizenTasks` | tasks | 19 |
| `KaizenLists` | colour-coded lists | 7 |
| `KaizenNotes` | notes; blocks as one JSON string | 8 |
| `KaizenNotificationQueue` | the outbox — every delivery becomes a row | 19 |
| `KaizenAutomationRules` | user rules; `NextTriggerAt` is the planning index | 27 |
| `KaizenNotifications` | what the in-app bell reads | 11 |
| `KaizenAutomationRuns` | audit trail | 9 |

Every row is scoped by `OwnerId varchar(64) mandatory` — "every query filters on
this". `ROWID` stays internal; the API exposes `TaskId` / `ListId` / `NoteId`.

### 1.2 Where the brief's description of tasks is incomplete

The brief lists "quadrant, list, due date + time, reminder, status, category,
manual order". Also present `[CODE]`:

- **`TaskPriority varchar(16)`** — `LOW | MEDIUM | HIGH`. Named that because
  **`Priority` is a reserved column name in Catalyst** and creating it fails
  `403 INVALID_OPERATION` (`docs/catalyst/03-datastore.md`, `[VERIFIED]`). See
  §1.5 — it is dead.
- **`Note text`** — per-task long note, validated to 10,000, distinct from a Note.
- **`SourceNoteId` / `SourceBlockId`** — added post-launch, probed before use via
  `ensureTaskLinkColumns`, because "selecting a column that does not exist fails
  the WHOLE query".
- **`CompletedAt bigint`**, `0` = not completed; drives streak and momentum.

### 1.3 Notes — the shape is exactly as briefed, and that is the problem

`[CODE]` `src/types/notes.ts`: 12 block types (`paragraph`, `heading1-3`,
`bullet`, `numbered`, `todo`, `quote`, `divider`, `code`, `table`, `callout`),
one flat `NoteBlock[]`, no nesting. The table block is confirmed dumb:

```ts
export interface TableData {
  rows: string[][];          // [rowIndex][colIndex] = cell content
  hasHeader: boolean;
  colWidths?: number[];
  colAligns?: ColumnAlign[];
}
```

A whole note is `JSON.stringify(note.blocks)` into `BlocksJson text` (10,000).

**The 10,000-character limit is not enforced anywhere.** `[CODE]` `MAX_NOTE_LEN =
10_000` exists at `notes-server.ts:966` but is used only for a *task's* `note`
field (`:1144`, `:2221`). `POST /api/notes` is `blocksJson: body.blocksJson ??
null` with no check; `PUT /api/notes/:id` is a raw
`{...found.note, ...body, …}` spread. Client-side `useNotes.ts` does
`JSON.stringify(note.blocks)` blindly. The only ceiling is
`express.json({ limit: '4mb' })`. `blockMetrics.ts`, despite the name, is a
typography scale — it counts nothing.

So an oversized note fails with an opaque `400 datastore_rejected` naming no
field, and `notesSyncService` retries the same payload forever while localStorage
diverges from the server. Table blocks serialise `rows[][]` inline, so tables are
the fastest route to that wall — which is precisely why §3 argues against putting
more into them.

### 1.4 Two data paths, and only one of them syncs

This is the most important architectural fact and the brief doesn't mention it.

- **Tasks / lists / stats** — server-first with optimistic local updates and
  explicit rollback per mutation. `useCatalystSync` picks `REAL` or `MOCK`
  **once at mount** by health check; only a *network* error falls back (a 4xx is
  treated as a real answer). Once it flips to `MOCK` there is **no promotion
  back**. No ETags, no versions: last PUT wins.
- **Notes** — local-first and **push-only**. `useNotes.ts` says it outright:
  *"localStorage is ALWAYS the source of truth for reads."* The server is
  **never read**. `GET /api/notes` exists and no client calls it. The product
  surfaces the consequence as a toast: *"That note isn't on this device."*
  The server does enforce last-write-wins on `updatedAt` — and the client
  discards the returned winner.

### 1.5 Three things the code contradicts outright

1. **`TaskPriority` is dead.** Column, `ApiTask.priority`, validator
   (`optEnum(… PRIORITIES …)`), a `?priority=` filter (`:2086`) and a sort
   comparator (`:2129`) are all live and correct. **Nothing writes it.** All
   three `createTask`/`updateTask` call sites enumerate fields explicitly and
   omit it; `src/types/todo.ts`'s `Todo` interface has **no `priority` field**;
   `mockApi.ts` says `// priority is not stored on the local Todo type`; every
   row in `server/tasks-db.json` is `"priority": ""`. The filter UI is mounted
   and does nothing. Adding a priority control is a pure-frontend change — or
   delete it (§6.6).

2. **The whole advanced filter bar is inert.** `[CODE]` `App.tsx:310` holds
   `filterState`, passes it in:

   ```ts
   const server = useCatalystSync(appState.activeListId, filtersToParams(filterState));
   ```

   and `src/hooks/useCatalystSync.ts:47` is:

   ```ts
   export function useCatalystSync(activeListId?: string, _filters?: …TaskListParams): ServerSyncState {
   ```

   `_filters` **is never referenced in the body.** Both fetch paths call
   `api.task.list()` with no arguments. The only narrowing before render is
   `todos.filter((t) => t.listId === activeListId)`.

   So search, status, priority, quadrant, date range, sortBy and sortDir change
   **nothing on screen**. The only observable effects are the active-filter
   badge and the "Drag to reorder is off while filters are active" hint. Yet the
   full param set is implemented **three times**: `api.ts` serialises all nine,
   `notes-server.ts:2060` implements all of them server-side including
   comma-separated multi-values, and `mockApi.ts` implements them for offline.
   `useServerSync.ts` (466 lines) *does* consume them and **nothing imports it.**
   This is the cheapest large feature in the codebase (§4, Now-1).

3. **Filter state is ephemeral and there is no saved-view concept.** Plain
   `useState`, not localStorage, not the URL, and actively reset to
   `DEFAULT_FILTERS` on list switch. There is also **no router** — no URL, no
   deep links; reload always lands on Tasks.

### 1.6 What is genuinely well built

Worth stating, because §3 recommends protecting it rather than extending it.

- **Materialise what is due, don't scan what might be.** The queue is driven by
  `WHERE Status='PENDING' AND FireAt <= now ORDER BY FireAt ASC LIMIT 100`. A
  quiet tick returns zero rows however large the table. `<=` rather than `=` is
  the self-healing property: a missed slot is a late reminder, not a lost one.
- **Claim tokens.** Catalyst has no conditional `UPDATE` and reports no
  affected-row count, so `claim()` writes a UUID and re-reads to confirm it won.
  `zcqlRowId()` passes digits through verbatim and *throws* rather than
  coercing, because `Number('69251000000086009')` is `…010` — a rounding bug
  that once stranded every row in `SENDING` with no error recorded anywhere.
- **Dedupe keys carry the firing instant.** Editing a title recomputes the same
  key and enqueues nothing; moving a due date yields a different key so the
  stale one can be cancelled unambiguously. Enforced by a unique constraint and
  caught, not pre-checked, because "a SELECT-then-INSERT has a race".
- **Enqueue before advancing `NextTriggerAt`.** Advance-then-crash loses a
  firing; enqueue-then-crash recomputes the same key and the duplicate is
  refused. "Late and correct beats early and missing."
- **DST handled properly.** `zonedToEpoch` is a deliberate two-pass conversion
  because the offset itself differs across a transition, and returns `null`
  never `NaN`, "because `NaN` propagates silently".

That is a better scheduling engine than Notion exposes to users at any price
tier (§3.3). It is the asset.

---

## 2. Phase 2 — Notion's real feature set, and the question you actually asked

Researched from Notion's help centre and developer docs, September 2026. Your
own workspace verified §2.1 directly; the rest is documentation.

### 2.1 Database vs table vs data source vs view — the direct answer

**Your question: "in Notion, what exactly is the difference between a 'database'
and a 'table'? Is a table just a view of a database?"**

Short answer: **no, and the question has three different answers because Notion
uses "table" for three different things.** Also, the model changed under you —
if your mental model predates September 2025 it is now wrong.

**The current hierarchy** `[NOTION]` (verified against your workspace's API
responses, which returned `<data-sources>` and `<views>` as separate collections
with distinct URLs):

```
page
 └── database                 a BLOCK; a container. Owns title, icon, permissions.
       ├── data source A      NOT a block. Owns the `properties` schema.
       │     ├── page         a row — which is itself a full page with a body
       │     └── page
       ├── data source B      its own, independent schema
       └── view               bound to exactly ONE data source
```

- **Database** = container. *"A database becomes a container for one or more
  data sources."* *"Every database is made up of at least one data source."*
  ([upgrade FAQs](https://developers.notion.com/docs/upgrade-faqs-2025-09-03))
- **Data source** = the thing with a schema. The parent of pages. In developer
  docs, literally *"a table of pages under a Notion database"*. What a SQL
  person means by "table".
- **View** = a saved layout + filters + sorts + grouping, *"scoped to a single
  data source"*. Cannot span data sources — **except** the new dashboard view,
  which is a container of widgets that each reference their own data source.
- **Page** = a row. Its `parent` is now a `data_source_id`, **not** a
  `database_id`. Every row is a full document with body, comments and backlinks.

Shipped in API version `2025-09-03` (announced 26 Aug 2025). Each data source's
schema is independent: *"Changes to one data source's properties doesn't affect
the schema for other data source, even if they share a common database."*
Permissions live at the **database** level — *"Access permissions cannot differ
by source within a database."* A database must always have ≥ 1 view; deleting
the last returns `validation_error`.

**"Table" means one of three things** `[NOTION]`:

1. **Table *view*** — a layout type (rows = pages, columns = properties). This
   is the sense in which "a table is a view of a database" is *true* — but it is
   a view of a **data source**, not of a database, and it is one of ten layouts.
2. **Simple table** — a plain, non-database table **block** (`table` +
   `table_row`, with `has_column_header` / `has_row_header`). No properties, no
   filters, no pages, no queries. **This is what HitList's note table block is.**
3. **"Table" as a synonym for data source** — the API changelog says
   `2025-09-03` "separates databases (containers) from data sources (**tables**)".
   Developer docs only; never the product UI.

So: **database = container, data source = schema-owning table, table = either a
view layout or a dumb block.** Notion has not cleaned this up, and its own help
centre still uses "database" loosely to mean "data source" in many articles.
`[UNVERIFIED]`: the maximum number of data sources per database — no documented
figure anywhere.

**Why this matters for HitList:** the useful decomposition is not
database-vs-table, it is **schema / records / view**. HitList already has all
three. It just doesn't name them, and it has exactly one saved view (none) per
layout (two).

### 2.2 The property types — 25 of them

`[NOTION]` Title (exactly one per data source, mandatory) · Text · Number
(`number`, `number_with_commas`, `percent`, long currency list; UI also does
Bar/Ring progress) · Select · Multi-select · Status (options **plus groups** —
that's the difference from select) · Date (single, or range; optional time;
optional timezone; optional reminder) · Person · Files & media · Checkbox · URL ·
Email · Phone · Formula · Relation (one-way `single_property` or two-way
`dual_property`; cardinality 1-page or unlimited; self-relations allowed) ·
Rollup · Created time · Created by · Last edited time · Last edited by ·
ID (auto-increment, optional prefix) · Button · Place (powers map view; **no
distance calculation**) · Verification · Sub-item / Parent item (hierarchy
inside one data source) · Dependencies (Blocking / Blocked by, with auto
date-shift and optional avoid-weekends).

**Rollup aggregations, full set:** `average`, `checked`, `count`,
`count_values`, `date_range`, `earliest_date`, `empty`, `latest_date`, `max`,
`median`, `min`, `not_empty`, `percent_checked`, `percent_empty`,
`percent_not_empty`, `percent_unchecked`, `range`, `show_original`,
`show_unique`, `sum`, `unchecked`, `unique`.

**The constraints that matter:**

- **Rollups cannot roll up rollups.** Flat refusal — *"this could create
  unintended loops"*.
- **Relation ceiling:** once page X in DB A has been referenced 10,000 times
  from DB B, further references **stop reflecting back into A**.
- **Duplicating a relational database silently downgrades two-way relations to
  one-way.**
- 500 properties max per database. Per-page property payload 2.5 MB. Total
  property size per database: help centre says 1.5 MB, API docs say 50 KB
  recommended — **Notion's own docs contradict each other**.
- Since 5 Aug 2026, formula and rollup properties can return the type
  **`unsupported`** when they "depend on too many related pages or nested
  formulas". Notion has formalised computation failure as a return value.

### 2.3 View types — ten, plus one that isn't in the API

`[NOTION]` API-recognised: `table`, `board`, `list`, `calendar`, `timeline`,
`gallery`, `form`, `chart`, `map`, `dashboard`. **Feed** view exists in the
product (Notion 2.52, Jul 2025) but is absent from the documented Views API type
list — `[UNVERIFIED]` whether that's a docs gap or a real one.

Notable: **board requires grouping**; **chart** offers vertical/horizontal bar,
line, donut, number, and **cannot** use rollups, buttons, unique IDs, files or
formulas on an axis, rendering max 200 groups / 50 subgroups (1 chart per
workspace on Free); **form** is Business-gated for conditional logic, can only
be added to the database that *owns* the data source, and **cannot be exported**;
**map** shows **max 100 items**; **dashboard** is Business/Enterprise, max 12
widgets / 4 per row, no nesting, and is the only surface whose widgets may pull
from different databases. Views became first-class API objects only on
19 Mar 2026.

**View-level vs source-level** is the distinction worth stealing:

| Source-level (shared) | View-level (independent) |
|---|---|
| property schema, formula expressions | layout type |
| relation & rollup definitions | property visibility + order |
| sub-item / dependency enablement | filters, sorts, group, sub-group |
| database templates | footer calculations |
| permissions | card size/preview, load limit, quick filters |

### 2.4 Filtering, sorting, grouping

Full operator set per type `[NOTION]`; the shape that matters is:
`is_empty`/`is_not_empty` on everything; `contains`/`does_not_contain` on
multi-select, people, relation; `starts_with`/`ends_with` on text;
`greater_than_or_equal_to` etc. on number and ID; and a rich relative-date
vocabulary — `today`, `tomorrow`, `yesterday`, `one_week_ago`,
`one_week_from_now`, `one_month_ago`, `one_month_from_now`, plus `past_week`,
`this_week`, `next_month`, and so on. `people` accepts the literal **`"me"`**.

Nested AND/OR groups: **3 layers in the UI, 2 in the API** — Notion's docs
disagree with themselves. Multi-level sorts, drag-reorderable;
select/multi-select/status sort by **user-defined option order**, not
alphabetically. Group plus one sub-group level, with "hide empty groups".
Footer calculations per column. Filters can be saved for everyone or kept
personal. Querying a saved view via API runs it **as configured** — you cannot
stack extra filters on top.

### 2.5 Formulas 2.0, blocks, automations — briefly

**Formulas:** lists, pages and people are first-class values; `let`/`lets` for
locals; dot-notation chaining; lambdas via an implicit `current`; direct
traversal into related pages without a rollup (the big 2.0 win); regex via
`match`/`test`; `style()`/`link()` so results render as rich text. **No
user-defined functions, no objects/maps, no self-reference.**

**Blocks:** ~30 types. Beyond HitList's 12: `heading_4`, toggleable headings,
`toggle`, `column_list`/`column`, **`tab`**, `synced_block`, `template`,
`equation` (KaTeX), `breadcrumb`, `table_of_contents`, `image`/`video`/`audio`/
`file`/`pdf`, `bookmark`, `embed`, `link_preview`, `link_to_page`, `mention`,
`child_database`, `child_page`, `meeting_notes`. Synced-block gotcha: **past 10
copies, deleting the original or "Unsync all" removes every copy and undo will
not restore them.**

**Automations — three triggers only:** page added; property edited; every
{frequency}. **There is no "a date arrived" trigger.** Actions: edit property,
add page, edit pages, notify ≤ 20 members, send mail, send webhook, Slack
notification, define variables. Hard limits: *"Database automations can't be
triggered by other automations"*; formulas work in actions but **never in
triggers**; no branching, no conditionals, no loops, no retries you control;
automations **silently fail** on pages whose access is restricted or which a
view filters out. Anything more needs Custom Agents (Business/Enterprise) or
Notion Workers.

**Search:** global search indexes titles and page content and **excludes
property values** (*"select and multi-select tags are not included in search
results"*), comments, `@mentions` of pages and people, and archived pages.
Database-scoped search matches titles and property values and **excludes page
body**. So **Notion's global search cannot find a task by its assignee, status
or tag.** Enterprise Search fixes it, on Business/Enterprise only.

**Offline** (shipped Aug 2025): **desktop and mobile only, never web**;
downloading a database brings **the first 50 rows of its first view**; subpages
do **not** cascade; it is **per-device**; and forms, buttons, embeds and AI are
all dead offline.

### 2.6 Where Notion is genuinely bad — its own documentation, mostly

The strongest items are the ones Notion documents against itself, on a page
titled *Optimize Notion database performance*: max **250,000** rows per
database; max **500** properties; **2.5 MB** property data per page; the 10,000
relation-reference ceiling; and its own list of what makes databases slow —
*"If your database has a sort or filter on properties like title, text, formula,
or rollup, the logic behind it can make load times longer."* Its mitigations are
workarounds for an architectural limit: hide unused properties, avoid nested
formulas, filter on simple properties, delete old pages. Plus: *"When a database
contains more than 1,000 items, new pages may appear in the middle of the
collection instead of at the end."*

**And the one that matters most to you** — from Notion's own reminders page:

- **No recurring reminders.** *"Recurring tasks and recurring reminders are on
  the roadmap."* Still, in September 2026.
- **No snooze** — absent from the documentation entirely.
- Mobile push arrives *"within five minutes"* of the scheduled time, not at it.
- Email fires **only if Notion isn't open** at reminder time.
- One undifferentiated Inbox. No per-channel routing, no escalation, no digests.
- Automations cannot be triggered by a date arriving.

There is a visible cottage industry of paid third-party products that exist
purely to patch this. **People pay money to fix Notion's reminders.**

### 2.7 So: (a) typed columns on the note table block, or (b) a database concept?

**Neither, as stated. The third option: promote what you already have.**

Argue it properly.

**Against (a) — typed columns on the note table block.** Three reasons, in
order of severity:

1. **It walks into the 10,000-character wall with no guard rail.** A note is one
   `text` column and a table already serialises `rows: string[][]` inline. Add
   per-column types, filter state, sort state and per-cell typed values and you
   multiply the payload of the one block type that is already the heaviest. And
   §1.3 established there is **no size check anywhere** — the failure is an
   opaque `400 datastore_rejected` that `notesSyncService` retries forever.
   You would be adding weight to the exact spot with no scale, no warning and no
   recovery.
2. **It builds a second schema system that can never be executed against.**
   Blocks are opaque JSON to the server — *"The server never parses
   `BlocksJson`."* A typed column inside a note cannot be queried by ZCQL,
   filtered server-side, sorted at scale, reminded on, escalated, or counted in
   momentum. HitList's entire reason to exist is the escalation engine in §1.6.
   **A table in a note can never be a thing an automation fires on.** You'd have
   built the half of Notion that Notion is already good at, and wired it to none
   of the half where you win.
3. **Notes don't sync.** §1.4 — notes are local-first and push-only, the server
   is never read. Typed data in a note is typed data on one device.

**Against a general database concept.** Catalyst cannot back it. Notion's model
needs per-data-source **dynamic** schemas; Catalyst tables are statically
provisioned over REST with *intermittent `500`s that succeed on retry*
`[REPO-DOCS: VERIFIED]`, `varchar` silently clamped to 255, **20 columns and 300
rows per SELECT**, `Priority` reserved with the full reserved list unknown, no
conditional `UPDATE`, and no affected-row count. Letting users create databases
with their own columns means either creating real Catalyst tables at runtime —
unworkable, and you would hit the 20-column SELECT cap and the dev-environment
5,000-row cap almost immediately — or an EAV key/value table, which is the right
idea but only for a **bounded** property set.

**What to do instead: HitList already has a database, and doesn't know it.**

`KaizenTasks` is a typed, server-queryable, filterable, sortable collection of
records with a schema. That is a **data source**. The Eisenhower matrix is a
**board view grouped by quadrant**. `TaskListView` is a **list view**.
`AdvancedFilterBar` is a **view configuration** — fully implemented on three
layers and connected to nothing (§1.5). The note table block is Notion's
**simple table**, meaning #2, and should stay exactly that dumb.

So the third option, in three moves:

1. **Make the view layer first-class over the records you already have.** Saved
   views: name, layout, filter, sort, group, scope. This is where Notion's real
   power lives — §2.3's view-level/source-level split — and it costs you a new
   table plus wiring a hook argument that is already being passed.
2. **Add typed *properties* to tasks, not arbitrary databases.** A narrow side
   table gives you select, multi-select, number, date, checkbox and text on the
   records you actually execute against. `LEFT JOIN` (§0.1) makes this one round
   trip. Deliberately **no** relation, rollup, formula, person, files or place.
3. **Let a note embed a saved view of tasks.** This is option (b) done at 5% of
   the cost — Notion's *linked view of a database*. The note references a view;
   it does not own a schema. One new optional field on a block, no new note
   payload of consequence, and the embedded rows are real tasks that reminders
   and escalation already work on.

**What this costs you, honestly:**

- **A table inside a note stays dumb forever.** No sorting, no filtering, no
  totals, no column types. If you want structure you promote it to tasks with
  properties, or you embed a view. Some people will want a quick sortable table
  in a document and will not get one. I think that is the right trade: it is the
  feature that would cost the 10k wall, and the embed covers the case that
  actually matters.
- **Properties are a bounded set, chosen by you, not an open schema.** No
  user-invented types. No formulas over them.
- **The join fan-out is a real sequencing constraint.** A `LEFT JOIN` onto an
  EAV table returns one row per task **per property**. With the 300-row cap, a
  task carrying 5 properties means **300 rows ≈ 60 tasks**. So pagination is
  not optional and **must land before properties** — see §4 and §5.

---

## 3. Phase 3 — Gap analysis, ranked

Ranked by value to **personal task execution with escalation**, which is the
substitute criterion §0.4 explains. Where the ranking would plausibly differ if
your Notion habits were known, the Why column says so.

### 3.1 The ranked table

| # | Capability | How Notion does it | HitList today | Build? | Why |
|---|---|---|---|---|---|
| 1 | **Filters / sorts actually applying** | View-level filters, 3-deep AND/OR, multi-sort, per-type operators | **Fully implemented on 3 of 4 layers and wired to nothing** — `_filters` unused in `useCatalystSync` | **yes, now** | The cheapest real feature you will ever ship. Server, API client and mock all take the full param set. It is currently a visibly broken control: the badge counts, nothing filters. Everything in rows 4–6 sits on it. |
| 2 | **Reading more than 300 records** | 250k rows/db, paginated cursors | **No LIMIT on any list read → silent truncation at 300** (§0.2) | **yes, now** | Not a feature — a correctness bug. Also blocks row 5 outright because of join fan-out. Today a 301st task vanishes with no error. |
| 3 | **Recurring tasks** | Repeating database templates (daily/weekly/monthly/yearly). **Notion has no recurring *reminders* at all** | Recurring *rules* exist and fire; recurring *tasks* do not | **yes, now** | Biggest genuine win available. `recurrence.ts` already does the hard part correctly, DST included. Notion documents this as roadmap; the third-party market proves demand. |
| 4 | **Saved, named views** | Unlimited views per data source; view-level config; personal vs shared | None. Filter state is `useState`, reset on list switch. No router, no URL state | **yes, now** | This is what "database" actually buys a solo user. "Overdue at work", "This week, Do First" as one click. Depends on row 1. |
| 5 | **Typed task properties** | 25 property types | `category` (5 hardcoded), `TaskPriority` (dead), free-text `note` | **yes, next** | Select / multi-select / number / date / checkbox covers the realistic 90%. **Blocked on row 2.** Deliberately omits relation, rollup, formula, person, files, place. |
| 6 | **Calendar + board layouts** | 10 view types | 2 (matrix, list), toggled by a localStorage string | **yes, next** | A due-date app with no calendar is a real hole. Pure frontend over data you already have, once rows 1 and 4 exist. |
| 7 | **Sub-tasks** | Sub-item / Parent item hierarchy within a data source | None. Blocks don't nest either | **yes, next** | The commonest reason a "task" stalls is that it is three tasks. One self-referential column, and it earns a count rollup (row 12). |
| 8 | **Notes that sync and are searchable** | Server-side search over titles + body (but **not** property values) | Push-only; server never read; search matches title + **first block only**, capped at 120 chars | **yes, next** | Body text past block 1 is unsearchable and table cells never are. `GET /api/notes` already exists and no client calls it. `executeSearchQuery` exists and is unused. |
| 9 | **A note-size guard** | n/a — Notion has no equivalent limit | Nothing counts. Opaque 400, retried forever (§1.3) | **yes, now** | Tiny. Prevents silent divergence between localStorage and server. Do it *with* row 3, not after. |
| 10 | **Task ↔ note linking both ways** | Relations; `@page` mentions create automatic backlinks | `@` creates a linked task; `SourceNoteId`/`SourceBlockId` exist; "Open in Tasks" / "Open source note" work | **mostly done** | Already better than it looks. Missing: a note can't show "tasks that came from me" as a list. Row 11 covers it. |
| 11 | **Embedded view of tasks in a note** | Linked view of a database (inline or full-page) | No | **next** | §2.7's option (b) at 5% of the cost. One optional block field. The rows are real tasks, so escalation already works on them. |
| 12 | **Rollups, narrowly** | 22 aggregation functions, but **cannot roll up rollups** | None | **later, and only 3 of them** | `count`, `percent_checked`, `latest_date` over sub-tasks. Footer calculations on a view. Nothing recursive. Notion's own `unsupported` return type is the warning. |
| 13 | **Templates** | Database templates, ≤3 nesting levels, `@now`/`@today`/`@me` | None | **later** | Real value for a solo user (a weekly-review task with a fixed checklist), but recurring tasks (row 3) covers most of the same need first. |
| 14 | **Import / export** | CSV/MD/HTML/PDF in, CSV/MD/HTML/PDF out. Relations export as plain text with **no re-import path** | None | **later** | Matters for trust — "can I get my data out" — more than for daily use. Cheap as a JSON dump of the 7 tables. |
| 15 | **Relations between arbitrary records** | Two-way synced relations; 10k back-reference ceiling; duplication silently downgrades to one-way | `ListId`, `SourceNoteId` — fixed, purpose-built links | **no** | With ≤4 joins per query and a 300-row cap, a general relation graph is unaffordable. Purpose-built links are also *better* UX for one person. |
| 16 | **Formulas** | Formulas 2.0: lists, pages, `let`, lambdas, regex | None | **no** | See §3.2. This is the single item I would most firmly refuse. |
| 17 | **Permissions, teamspaces, sharing, comments** | 6 permission levels, teamspaces, guests, page-level row permissions, suggested edits, version history | `OwnerId` isolation and nothing else | **no** | You are one person. Every line of this is cost with no user. |
| 18 | **Timeline / gallery / chart / map / feed / form / dashboard** | 7 more layouts, each with its own config surface | No | **no** | Chart, maybe, eventually, for streaks. The rest have no personal-execution use. Notion's own caps (map 100 items, chart 200 groups, dashboard 12 widgets) show the diminishing returns. |
| 19 | **AI agents, autofill, meeting notes** | Custom Agents, Workers, autofill, transcription, MCP | No | **no** | Business/Enterprise-gated even at Notion. Nothing here beats "the reminder arrived and escalated". |

### 3.2 What HitList should deliberately NOT copy

**Formulas.** The most seductive and the most wrong. A formula language is a
type system, an evaluator, an editor with live type-checking, a dependency
graph, and a cycle detector — and then a *migration story* every time you change
it, which Notion needed a whole guide for. Notion's own endgame is instructive:
since Aug 2026 formulas can return **`unsupported`** when they get too deep.
Notion shipped a computation-failure return value rather than fix the
performance. On Catalyst, with everything computed in Node after fetching rows,
you would hit that wall far sooner and have to invent the same escape hatch. And
for one person executing tasks, essentially every real formula need is served by
three fixed aggregates (row 12) and a due-date comparison you already do.

**General relations and rollups.** Rollups cannot roll up rollups even at
Notion — that is not an oversight, it is loop prevention they could not solve
cheaply. Four joins per query and 300 rows per SELECT means a relation graph
degrades into N+1 reads exactly when a user has enough data to want it.

**Generality itself, which is the actual lesson.** Notion's documented slowness
is not bad engineering, it is the *price of generality*: arbitrary schemas,
arbitrary formulas and arbitrary nesting mean nothing can be specialised, which
is why its own advice is "hide unused properties" and "avoid nested formulas".
HitList's quadrant is a fixed `varchar(16)` enum, so bucketing four ways is a
single pass over one indexed column. Keep that.

**Ten view types.** Each one is a config surface, an empty state, a mobile
layout and a permanent maintenance cost. Notion needs ten because it serves
every use case. You serve one.

**Notion's notification model, specifically.** One inbox, a red badge, no
routing, no escalation, no snooze, push "within five minutes", email only if the
app is closed. It is the thing to beat, not to copy.

**Permissions and collaboration.** Not "later" — **no**. The moment a second
permission level exists, every query, every mutation and every test grows a
dimension. `OwnerId` isolation is the correct and complete answer for one user.

### 3.3 Where HitList already wins

Say this plainly, because it should shape what gets protected:

1. **Escalation exists.** A single rule fires at `-60, -5, 0, +30`. Notion cannot
   express this at any price. It has no recurring reminders, no snooze, and no
   "a date arrived" trigger — its *only* time-based trigger is a blunt
   daily/weekly/monthly schedule.
2. **The delivery engine is more correct than it needs to be.** Dedupe keys
   carrying the firing instant, claim tokens compensating for Catalyst's missing
   conditional update, enqueue-before-advance, two-pass DST conversion,
   `<=` sweeps that self-heal after a missed tick. That is genuinely
   well-engineered infrastructure and it is the moat.
3. **It has an opinion.** Four quadrants, one triage decision. Notion's core
   philosophy is to supply structure and no opinion — which is exactly why
   reviewers report "blank page syndrome" and information "scattered across
   pages and databases". An opinionated app can do things Notion structurally
   cannot, including §6.3 and §6.4.
4. **Multi-channel delivery already works** — in-app, web push, email, with a
   kill switch, per-rule channel selection, and a `SKIPPED`-vs-`FAILED`
   distinction so configuration problems don't burn retry budget.
5. **Offline is real on the tasks path.** `mockApi` is a genuine localStorage
   write path, not a read-only cache. Notion's offline mode gives you the first
   50 rows of one view, per device, and never on the web.

---

## 4. Phase 4 — Build plan

Every column below is checked against: `varchar` ≤ 255 (silently clamped, so
never declare more), `text` ≤ 10,000, `int` 10 digits, `bigint` 19 digits,
**20 columns per SELECT**, **300 rows per SELECT**, `Priority` reserved.

Column counts include `ROWID` where the query selects it.

**One prerequisite for anything using `date` or `double`:** `ColumnSpec.type` in
`server/catalyst/schema.ts` is currently
`'varchar' | 'text' | 'int' | 'bigint' | 'boolean'`. Catalyst also supports
`double`, `date`, `datetime`, `encrypted text` and `foreign key`
`[CAT-DOCS]`. Widening that union is sufficient — `scripts/catalyst-setup.ts`
forwards the type verbatim (`data_type: col.type`), so it needs no change.

### NOW

---

#### N1 · Make the filter bar work, then give it saved views

**What it does.** Today when you set a filter, the badge counts it and the
screen doesn't change. After this, filters filter — and you can name a
combination ("Overdue at work", "This week, Do First"), keep it, and pick it
from the Lists column in one click.

**Data model.** Stage 1: **none**. Stage 2 adds one table.

`KaizenViews` — 13 columns, 14 with `ROWID`:

| Column | Type | Notes |
|---|---|---|
| `ViewId` | varchar(64) | mandatory, unique |
| `OwnerId` | varchar(64) | mandatory |
| `Name` | varchar(255) | mandatory. **Slice to 255 on write** — do not repeat the `Title` bug (§0.3) |
| `Layout` | varchar(16) | `LIST` \| `MATRIX` \| `CALENDAR` \| `BOARD` |
| `ScopeListId` | varchar(64) | empty = all lists |
| `FilterJson` | text | the existing `FilterState` shape, ~200 chars. 10k is ample |
| `GroupBy` | varchar(32) | `QUADRANT` \| `LIST` \| `CATEGORY` \| `DUE` \| `NONE` |
| `SortBy` | varchar(24) | the six existing keys |
| `SortDir` | varchar(4) | `asc` \| `desc` |
| `ViewOrder` | int | |
| `IsDefault` | boolean | |
| `CreatedAt` / `UpdatedAt` | bigint | |

**Migration.** Purely a new table. No existing row changes. Nothing to backfill —
absence of rows is the correct initial state (ephemeral filters, as today).

**UI.** Stage 1 is invisible: the existing `AdvancedFilterBar` starts working.
Stage 2 adds a `ContextSectionHeader({label: 'Views', action})` section to the
Lists column in `ViewLayout`'s `context` slot, above `ListSidebar`, using the
existing `contextRowClass(active)` primitive. "Save this view" goes in the
filter popover next to "Clear done".

**Effort: small.** Stage 1 is one line plus a refetch dependency. Stage 2 is a
CRUD table and one context section.

**Depends on.** Nothing.

**Stages.**
1. Consume `_filters` in `useCatalystSync`, pass to `api.task.list(params)`,
   refetch when they change. Keep the `listTodos` client-side list narrowing as
   a belt-and-braces filter. **Ship. This alone is a visible fix.**
2. `KaizenViews` + `pnpm catalyst:setup` + read-only view list.
3. Create / rename / delete / reorder / set-default.

**What breaks if deployed in the wrong order.** Severe, and specific to this
codebase. Adding a table to `SCHEMA` and deploying before `pnpm catalyst:setup`
has created it puts `probeCatalystTables` (`notes-server.ts:390`) on this path:

```ts
const msg = String(e);
if (/not found|does not exist|invalid table|no such table/i.test(msg)) {
  missing.push(table.name);
} else {
  // Something other than absence — a credential or connectivity problem.
  // String(e) on an SDK error yields "[object Object]", which hides the
  // one detail that matters (an expired token reads as 401).
  console.error(`[kaizen] Probing ${table.name} failed: ${describeError(e)}`);
  return false;
}
```

Note what that comment says, and what the code then does: it **acknowledges**
that `String(e)` on an SDK error is `[object Object]` — and uses
`describeError(e)` only for the *log line*, while the **match still runs against
`String(e)`**. So when the SDK throws that shape, a genuinely missing table
fails the regex, takes the `else` branch, returns `false`, and **the entire
process downgrades to JSON-file storage** — tasks, notes and the whole
scheduler. The `missing.length` branch below it, with its helpful *"Run
`pnpm catalyst:setup`"* message, never runs. `GET /api/setup` (`:2037`) has the
same construction and reports `'error'` where it means `'missing'`.

`[UNVERIFIED]` — whether Catalyst's missing-table error actually arrives in that
shape or as a plain `Error` whose message contains "not found". The comment says
the former; nobody has confirmed it for this error specifically.

**So, before any new table in this plan:** change `const msg = String(e)` to
`const msg = describeError(e)` in both places, and run setup before deploying.
It is a one-word fix in two lines and it is load-bearing for everything in §4.

---

#### N2 · Stop losing rows past 300

**What it does.** Nothing visible, until you have 300 tasks — at which point it
is the difference between an app that works and one that silently forgets. Right
now the 301st task does not appear, no error is raised anywhere, and `?search=`
searches the truncated set.

**Data model.** No schema change.

**Migration.** None.

**UI.** None, except removing the "Drag to reorder is off while filters are
active" hint once sorting is genuinely server-side.

**Effort: medium** — small mechanically, medium because it touches every read
path and the tie-breaking is easy to get subtly wrong.

**Depends on.** Nothing. **Everything in NEXT depends on it.**

**Stages.**
1. **Verify the cap** (§7.1) — insert 350 rows in a scratch table and count what
   comes back. Five minutes, and it decides how much of this is needed.
2. **Page every unbounded read.** Add `LIMIT <offset>,300` and loop until a page
   returns < 300. Correct immediately, still O(all rows) per request. Applies to
   `catalystGetOwnerRows`, `GET /api/notes`, `listRules`, `findTaskRules`,
   `findPendingForSource`, `catalystGetRowId`.
3. **Trim `listRules` to ≤ 20 columns** if step 1 shows the cap is enforced. It
   selects 24–25 today (§0.2).
4. **Push predicates into ZCQL.** Move `status`, `quadrant`, `listId` and the
   due-date range into `WHERE`, and `sortBy` into `ORDER BY`. Keep `search` in
   Node for now, or move it to `executeSearchQuery` (§N5).

**What breaks if deployed in the wrong order.** Step 4 before step 2 is the trap:
a `WHERE`-filtered query still caps at 300, so you would make the truncation
*less* visible rather than fixing it. And when sorting moves into `ORDER BY`,
the in-process `compareTasks` ("done last, then `a.order - b.order`") must
remain the final tiebreak — otherwise manual drag order jumps around, because
ZCQL's tie ordering is unspecified `[UNVERIFIED]`.

---

#### N3 · Recurring tasks

**What it does.** "Weekly review, every Monday 09:00, Do First." A real task
appears each Monday morning, with all your existing reminders and escalation
attached, and completing it doesn't stop next week's. This is the thing Notion
has been promising and has not shipped.

**Data model.** Two new tables. **Nothing on `KaizenTasks`** — it is at 19 of 20
permitted columns and one more field breaks every task read.

`KaizenRecurringTasks` — 16 columns, 17 with `ROWID`:

| Column | Type | Notes |
|---|---|---|
| `RecurrenceId` | varchar(64) | mandatory, unique |
| `OwnerId` | varchar(64) | mandatory |
| `Title` | varchar(255) | mandatory, **sliced on write** |
| `Quadrant` | varchar(16) | the spawned task's quadrant |
| `ListId` | varchar(64) | |
| `Category` | varchar(100) | |
| `DueTime` | varchar(5) | `HH:MM`; empty → `23:59`, matching `END_OF_DAY` |
| `Freq` | varchar(16) | `daily`\|`weekdays`\|`weekly`\|`monthly` — the **same vocabulary** as `RecurrenceFreq` so `recurrence.ts` is reused unchanged |
| `DayOfWeek` | int | 0=Sun…6=Sat |
| `DayOfMonth` | int | 1–31, clamped not skipped, as `nextRecurrence` already does |
| `OwnerTimezone` | varchar(64) | IANA. Captured from `x-timezone` at write, exactly as rules do |
| `RecurStatus` | varchar(16) | `active`\|`paused`. **Not `Status`** — same reasoning as `RuleStatus` |
| `NextSpawnAt` | bigint | the planning index |
| `LastSpawnedAt` | bigint | |
| `CreatedAt` / `UpdatedAt` | bigint | |

`KaizenRecurrenceSpawns` — 6 columns, the idempotency ledger:

| Column | Type | Notes |
|---|---|---|
| `SpawnId` | varchar(64) | mandatory, unique |
| `OwnerId` | varchar(64) | |
| `RecurrenceId` | varchar(64) | |
| `SpawnKey` | varchar(200) | **mandatory, unique.** `recur:<recurrenceId>:at:<epoch>` ≈ 60 chars |
| `TaskId` | varchar(64) | what it created |
| `SpawnedAt` | bigint | |

The ledger is not optional. A retried tick must not double-spawn, and the
unique constraint is the only check that cannot be interleaved — the same
argument `queue.ts` already makes for `DedupeKey`. Duplicate *tasks* are far
more irritating than duplicate notifications. It also gives the UI an honest
"created 14 tasks so far" history.

**Migration.** Two new tables, no existing row touched. `pnpm catalyst:setup`
first, then deploy.

**UI.** A "Repeats" section in `TaskDetailPanel`, plus a `Recurring` section in
the Automations page's context column — recurrence is conceptually a rule and
`AutomationsPage` already has the right frame.

**Effort: medium.** The hard part — correct, DST-safe recurrence — already
exists. `nextRecurrence`, `zonedToEpoch` and its two-pass offset fix are reused
verbatim.

**Depends on.** N2 conceptually (a spawner reading a truncated rule list under-
spawns), but it can ship in parallel since its own reads are `LIMIT`ed by design.

**Stages.**
1. Tables + CRUD + UI, `RecurStatus='paused'` only. Nothing spawns. Ship.
2. `spawnDueRecurrences()` as a **fifth sweep phase**, between PLAN and PURGE,
   with `WHERE RecurStatus='active' AND NextSpawnAt>0 AND NextSpawnAt<=now
   ORDER BY NextSpawnAt ASC LIMIT 100`. **Insert the ledger row and the task
   before advancing `NextSpawnAt`** — the enqueue-before-advance discipline
   `planRule` already uses.
3. Allow `active`. Ship to yourself for two weeks before anyone else.

**What breaks if deployed in the wrong order.** The sharpest hazard in this
plan: **if the new sweep phase throws and is not individually wrapped, the whole
tick dies and every reminder stops.** `sweep.ts` already wraps RECLAIM and PURGE
independently for exactly this reason — *"housekeeping can never fail a tick
that delivered"*. Wrap SPAWN the same way. And if stage 2 ships before the
tables exist, that throw happens on **every tick**, so reminders stop silently
until someone notices.

---

#### N4 · Guard the 10,000-character note limit

**What it does.** Tells you a note is getting too big *before* it stops saving.
Today it fails with an opaque `400` that names no field, and
`notesSyncService` retries the same oversized payload forever while localStorage
quietly diverges from the server.

**Data model.** None.

**Effort: small.** An afternoon.

**Stages.**
1. **Server:** validate `blocksJson` at 10,000 and `title` at 255 in
   `POST`/`PUT /api/notes`, returning the existing `FieldErrors` shape so the
   client gets a named field. While there, whitelist the note patch the way
   `parseTaskPatch` does — `PUT` is currently a raw
   `{...found.note, ...body, …}` spread, so `createdAt`, `pinned`, `emoji` and
   the `updatedAt` that *decides last-write-wins* are all client-forgeable.
2. **Client:** count `JSON.stringify(note.blocks).length` in
   `useNotes.noteToPayload` — the single chokepoint — and show a quiet
   indicator past ~8,000 and a real warning past 9,500.
3. **Then** decide whether to raise the ceiling (a `BlocksOverflow text`
   continuation column, or per-block rows). Do not build that yet; measure first.

**What breaks if deployed in the wrong order.** Server validation before the
client counter means a user with an already-oversized note starts getting a
named 400 instead of an opaque one — better, but still a failure. Ship the
client counter in the same release.

### NEXT

---

#### X1 · Typed task properties

**What it does.** Add your own fields to tasks — an "Effort" number, a "Context"
multi-select, a "Waiting since" date — and filter and group views by them.

**Data model.** Two tables. Again, **nothing on `KaizenTasks`**.

`KaizenPropDefs` — 9 columns, 10 with `ROWID`: `DefId varchar(64)` unique
mandatory · `OwnerId varchar(64)` mandatory · `Name varchar(100)` mandatory ·
`Kind varchar(16)` (`SELECT`\|`MULTI`\|`NUMBER`\|`DATE`\|`CHECKBOX`\|`TEXT`) ·
`OptionsJson text` (select options; 10k caps you at a few hundred, which is
right) · `DefOrder int` · `ShowInList boolean` · `CreatedAt`/`UpdatedAt bigint`.

`KaizenTaskProps` — 9 columns, 10 with `ROWID`: `PropId varchar(64)` unique
mandatory · `OwnerId varchar(64)` mandatory · `TaskId varchar(64)` mandatory ·
`DefId varchar(64)` mandatory · `ValueText varchar(255)` · `ValueNum double` ·
`ValueDate date` · `ValueBool boolean` · `UpdatedAt bigint`.

Typed value columns rather than one text column, because `03-datastore.md`
records what happens otherwise: an earlier version typed everything `text`, so
`TaskOrder` sorted lexically — `"10"` before `"9"`. Requires the `ColumnSpec`
widening noted above (`double`, `date`).

**The read strategy, and why the join doesn't rescue it.** §0.1 corrected "no
joins" — ZCQL has `LEFT JOIN`, ≤ 4 per query. But it does **not** solve this
query, for two compounding reasons:

- **Columns.** Tasks select 19; a useful join needs ~5 more from
  `KaizenTaskProps`. That is 24, over the 20-column cap.
- **Rows.** A `LEFT JOIN` returns one row per task **per property**. Under the
  300-row cap, a task carrying 5 properties means **300 rows ≈ 60 tasks**.

So: **two paged queries, not a join.** Page the tasks (≤ 300 each), then read
that owner's prop rows in their own paged query and stitch in Node. For a solo
user with 300 tasks × 3 properties that is 900 prop rows — three more queries.
This is the concrete reason **X1 must not ship before N2**.

**Migration.** Two new tables. Existing tasks simply have no prop rows, which
renders as empty — no backfill, no default rows.

**UI.** A "Properties" block in `TaskDetailPanel` below the existing fields; a
"Fields" section in the filter popover; `ShowInList` controls whether a property
appears as a chip on `TaskRow`.

**Effort: large** — two tables, a definition editor, six value editors, filter
and group integration, and the paged stitch.

**Depends on.** **N2, hard.** And N1, since a property is only worth having if
you can build a view on it.

**Stages.** (1) defs CRUD, no values. (2) values on the detail panel, display
only. (3) filter by properties. (4) group by a `SELECT` property.

**What breaks if deployed in the wrong order.** Shipping before N2 means the
property join or stitch silently truncates and tasks appear to lose their
property values at random — the worst class of bug, because it looks like data
loss and is not reproducible at small scale. Also: `KaizenTaskProps` has no
cascade. Deleting a task must delete its prop rows, or they orphan exactly the
way `DELETE /api/lists/:id`'s unbounded non-atomic cascade already can.

---

#### X2 · Calendar and board layouts

**What it does.** See tasks on a month or week grid, or as columns grouped by
any `SELECT` property. A due-date-and-time app without a calendar is a real hole.

**Data model.** None — `Layout` already exists on `KaizenViews` from N1.

**UI.** Extend the existing `tasksMode` localStorage toggle
(`'list' | 'matrix'`) to four values and add options to the existing
`TopBarToggle`. Feed both from `listTodos`; reuse `bucketByQuadrant` for the
board's default grouping.

**Effort: medium.** Two new components, no backend.

**Depends on.** N1 (for persistence), X1 (for grouping by anything but quadrant).

**Stages.** (1) calendar, read-only. (2) drag a task to change its due date.
(3) board grouped by quadrant. (4) board grouped by a property.

**What breaks.** Nothing structural. One trap: the calendar must resolve "today"
in the **owner's** zone. `GET /api/stats/momentum` and
`GET /api/tasks/today-history` currently use `new Date().getFullYear()` — the
*server's* zone, UTC in production — so a user in Asia/Kolkata already gains or
loses a day at the boundary and the streak is silently wrong. Fix that with this,
since a calendar makes the bug visible.

---

#### X3 · Sub-tasks

**What it does.** Break a stalled task into steps that roll up. The commonest
reason a task sits in "Do First" for a fortnight is that it is three tasks.

**Data model.** One self-referential column — and here the 20-column cap bites
directly: `KaizenTasks` is at 19, so `ParentTaskId varchar(64)` makes 20, the
documented maximum, with zero headroom left forever.

Two ways out, and I recommend the first:

1. **Drop `TaskPriority` from the SELECT list** (§1.5 — it is dead, every stored
   value is `''`, nothing writes it). That returns you to 18, and
   `ParentTaskId` makes 19. The column can stay in the table; just stop
   selecting it. This is the cheapest column you will ever buy.
2. A `KaizenTaskLinks` side table (`LinkId`, `OwnerId`, `ParentTaskId`,
   `ChildTaskId`, `LinkOrder`, `CreatedAt` — 6 columns). More flexible, and one
   extra paged query on every task read.

**Migration.** Option 1 is additive: one new column, empty on every existing
row, which reads correctly as "no parent". Probe it with the existing
`hasOptionalColumn` pattern so a deploy landing ahead of setup cannot break task
reads — `ensureTaskLinkColumns` is the template.

**Effort: medium.** Indentation in `TaskListView`, a parent picker, and a
completion rule (does completing a parent complete its children? — I'd say no,
and grey the parent until children are done).

**Depends on.** N2.

**What breaks if deployed in the wrong order.** Adding the column to
`TASKS_COLS` before `pnpm catalyst:setup` creates it fails **every** task read
for **every** user — the exact failure `ensureTaskLinkColumns` was written to
prevent. Use it. And if you add `ParentTaskId` *without* dropping
`TaskPriority`, you are at exactly 20 columns and the next person to add a field
breaks production with no warning — leave a comment in `schema.ts` saying so.

---

#### X4 · Notes that sync, and search that works

**What it does.** Notes stop being stuck on the device that wrote them, and
searching finds text anywhere in a note instead of only the first block.

**Data model.** No new tables. Enable a **search index** on `KaizenNotes.Title`
and `BlocksJson` so `executeSearchQuery()` can be used — it is documented
`[REPO-DOCS: DOCS]` and never run here.

**UI.** Unchanged search box; it just finds more. A conflict toast when a
server copy is newer.

**Effort: medium**, and the riskiest item in the plan — it changes the notes
data path from push-only to bidirectional, and `useNotes.ts` currently states
*"localStorage is ALWAYS the source of truth for reads."*

**Depends on.** N2 (`GET /api/notes` is unbounded today) and N4 (do not start
pulling notes down before writes are validated).

**Stages.**
1. **Read path only:** `GET /api/notes` on mount, merge by `updatedAt`, server
   wins ties. Keep localStorage as the render source. Ship.
2. Full-text search server-side via `executeSearchQuery`, client-side kept as
   the offline fallback.
3. Surface conflicts instead of silently discarding the loser — today the
   server returns the winning copy on a stale write and **the client throws it
   away**.

**What breaks if deployed in the wrong order.** Pulling before validating
(N4) means a note that cannot save is also a note that gets overwritten by the
server's older copy on next load — silent data loss on the one path with no
rollback. Also, client-supplied `updatedAt` is the LWW clock, so a device with a
skewed clock can pin a note permanently: any honest later write has a smaller
`updatedAt` and is discarded with a `200`. Fix that with stage 1, not after.

---

#### X5 · Embed a saved view of tasks in a note

**What it does.** Drop "Do First, overdue" into your weekly-review note and see
live tasks there. §2.7's option (b), cheaply.

**Data model.** One optional field on `NoteBlock`: `viewId?: string`, plus a
`taskview` entry in `BlockType`. No server change — blocks are opaque JSON, and
the field follows the exact precedent of `taskId`, `emoji` and `tone`, which
were all added without migrating a single note.

**UI.** A `/taskview` slash command; renders as a compact `TaskRow` list read
live from tasks, the way `LinkedTaskChip` already reads its task live rather
than snapshotting it.

**Effort: small**, given N1. This is the payoff for having built views properly.

**Depends on.** N1.

**What breaks.** Nothing — an unknown `viewId` renders an empty state, and an
older client seeing a `taskview` block shows an unknown-block placeholder.
Worth checking that the block renderer has such a fallback; if it does not, add
one first, because it makes every future block type safe to ship.

### LATER

- **Narrow rollups** — `count`, `percent_checked`, `latest_date` over sub-tasks,
  plus footer calculations on a view. Three fixed aggregates, computed in Node
  over an already-fetched page. Nothing recursive, ever.
- **Templates** — mostly subsumed by N3. Revisit only if recurring tasks turn
  out to need fixed checklists.
- **Export / import** — a JSON dump of the seven tables, and a CSV task import.
  Matters for trust more than daily use.
- **A router** — there is none today, so reload always lands on Tasks and
  nothing is linkable. Cheap, and it makes saved views shareable as URLs.
- **Charts** — one streak/completion chart, if ever. Not a chart *builder*.

### Not building

Formulas · general relations · recursive rollups · permissions, teamspaces,
sharing, comments, suggested edits, version history · timeline, gallery, map,
feed, form, dashboard layouts · synced blocks · public publishing · AI agents,
autofill, transcription. §3.2 argues each.

### What I would build first, and why

**N1 stage 1 — consume `_filters` in `useCatalystSync`.**

Because the feature is already built on three of four layers and is connected to
nothing. `api.ts` serialises all nine parameters, `notes-server.ts:2060`
implements every one server-side including comma-separated multi-values, and
`mockApi.ts` implements them for offline. A 466-line hook that *does* consume
them exists and nothing imports it. Right now a user sets a filter, watches the
badge increment, and sees an unchanged screen — the app is lying to them.

Then **N2**, because silent row loss past 300 is a correctness bug that
everything in NEXT would otherwise inherit and hide.

Then **N3**, because recurring tasks is the clearest thing Notion cannot do,
the machinery already exists and is already correct, and it is the feature that
makes HitList worth using over the thing you were comparing it to.

---

## 5. Full Notion parity — the honest map

You chose full parity over "small and sharp". The ranked plan in §4 is still my
recommendation, and §3.2 is the do-not-copy list your own brief asked for. This
section is the thing your choice actually requires: the rest of the surface,
itemised, so the decision is made with the number in front of you rather than
behind it.

Everything in §4 — all of NOW, NEXT and LATER — is roughly **4–7 months** of
solo evenings. That gets you: views, filters, recurring tasks, typed properties,
calendar and board layouts, sub-tasks, syncing searchable notes, embedded views,
narrow rollups, export. Call that **Notion's useful 80% for one person.**

The remaining 20% is where the curve turns vertical:

| Remaining surface | Scale | Notes |
|---|---|---|
| 19 more property types (relation, rollup, formula, person, files, place, button, verification, ID, created/edited by, dependencies, status groups) | **very large** | Relation and rollup alone are a graph engine plus a cycle detector, against ≤4 joins and 300 rows |
| Formulas 2.0 | **very large** | Parser, type system, evaluator, editor with live type-checking, dependency graph, migration story. Notion needed a dedicated migration guide and still shipped `unsupported` as a return value |
| 6 more view types (timeline, gallery, chart, map, form, dashboard) | large | Each is a config surface, empty state, mobile layout and permanent maintenance cost |
| ~18 more block types (columns, tabs, synced, template, equation, media, embeds, TOC, breadcrumb, toggleable headings) | large | Requires nesting in the block model, which is flat today — that alone is a rewrite of `NoteEditor` |
| Nested block model + rich text with links/colour/inline code | large | `inlineMarkdown.ts` supports 4 marks stored as delimiters in a plain string. Links and colours do not fit that representation |
| Automations engine (property-edited triggers, actions, webhooks, Slack, variables) | large | You have the *delivery* half, which is the hard half. The trigger/action matrix is the other half |
| Permissions, teamspaces, guests, comments, suggested edits, version history, analytics | **very large** | Every query and mutation grows a dimension. Version history means storing every revision against a 10k text column |
| Real-time collaboration | **very large** | CRDT or OT. Notion has a team on this |
| Offline parity, mobile apps, web clipper | large | You are React-on-web; Notion has native apps on five platforms |
| Public API, webhooks, MCP, agents, workers | large | A product in its own right |

Honest estimate for genuine parity, solo: **not a roadmap, a company.** Notion
has hundreds of engineers and two breaking API versions in seven months
(`2025-09-03` and `2026-03-11`) — the second of which broke its own integration
ecosystem badly enough that the advice was to wait 2–3 months before adopting
multi-source databases.

**The useful reframing, which is what I'd actually urge:** parity is the wrong
target because Notion's 250,000-row generality is *the cause* of the weaknesses
in §2.6, not an accident alongside them. Notion cannot ship recurring reminders,
escalation, a snooze, or an opinionated triage rule — not because nobody asked,
but because a tool that models everything cannot insist on anything. That is a
structural opening and it does not close with headcount. §6 is where I'd spend
the months instead.

You have the map. The order in §4 is the same either way — views, then the 300-row
fix, then recurring tasks — so nothing here needs deciding this week.

---

## 6. Suggestions you did not ask for

Ideas of my own, aimed at the job HitList actually does. Notion does none of
them. Three are flagged as ones I expect you to disagree with.

### 6.1 Per-step channels — escalation that actually escalates

Today a rule picks channels once (`NotifyInApp`/`NotifyBrowser`/`NotifyEmail`)
and fires the same way at every step. So `-60, -5, 0, +30` escalates in *timing*
and not in *volume* — four identical taps.

Make channels per step: step 1 in-app only, step 3 adds push, step 5 emails you,
step 6 emails someone else. `OffsetSteps` is already
`varchar(255)` holding `-60,-5,0,30`; a parallel `StepChannels varchar(255)`
holding `i,ip,ipe,ipe` costs one additive column on a table with headroom, and
`channelsFor(rule)` becomes `channelsFor(rule, stepIndex)`. Small change,
disproportionate behavioural payoff — and it is the single feature Notion is
structurally furthest from.

### 6.2 Acknowledge, don't dismiss

A notification you can dismiss teaches you to dismiss notifications. Replace
dismissal with a choice: **Done** · **Snooze until \<time\>** · **Defer, and say
why**. The queue already has everything needed — dedupe keys carry the firing
instant, so a snooze is just a new row with a new key and a cancel of the old.
The third option is the valuable one: after two weeks you have a list of the
reasons you don't do things, which is more useful than any chart.

### 6.3 Quadrant decay — *you will disagree with this*

A task that has sat in "Do First" for fourteen days is not urgent and important.
It is avoided. Auto-move it to Eliminate after a threshold, or at minimum force
a re-triage prompt that will not go away until you re-pick a quadrant.

**Why you'll object:** it moves your data without asking, and the first time it
touches something genuinely important you will hate it.

**Why it's right anyway:** the Eisenhower matrix has exactly one failure mode,
and this is it — everything ends up in Do First, at which point the quadrant
carries no information and the app is a list with a red label. The method only
works if the quadrant is honest, and nothing else in the design makes it honest.
Ship it as a prompt rather than a silent move if you must, but ship the
enforcement. An app with an opinion is the entire differentiator against Notion;
this is what having an opinion costs.

### 6.4 A hard cap on Do First — *you will disagree with this too*

Refuse to hold more than five tasks in Do First. The sixth forces you to demote
one.

**Why you'll object:** it is patronising, and some weeks genuinely do have six
urgent important things.

**Why it's right anyway:** the matrix's only function is forcing a choice, and
an uncapped quadrant does not force anything. If six things are urgent and
important, one of them is lying, and the cap is what makes you find out. Notion
would never do this — it has no opinions to enforce — which is exactly why this
is available to you and not to them. Make the number configurable if you like,
but do not default it to infinity.

### 6.5 Momentum should measure the right thing

`streak`, `totalCompleted` and `todayCompleted` reward volume, so the cheapest
way to a streak is to complete trivia. Weight by quadrant: a Do-First completion
is worth more than an Eliminate one. You already store `Quadrant` and
`CompletedAt` on every task, so this is a change to one comparator, not a
feature. (Fix the server-local-time bug in the same pass — §X2.)

Related and smaller: the streak already steps back a day without breaking if
today is empty. That is a kind design. Keep it.

### 6.6 Delete `TaskPriority` — *you will probably disagree*

It is dead: column, `ApiTask.priority`, validator, `?priority=` filter and sort
comparator all live and correct; nothing writes it; every stored value is `''`;
the filter UI is mounted and does nothing (§1.5).

**Why you'll object:** it is already built, so wiring a control to it looks like
a free feature.

**Why deleting is right:** priority and quadrant are the same information in
incoherent form. What is a `HIGH` priority task in the Eliminate quadrant? The
matrix *is* your priority model — two axes, four cells, one decision. A second
orthogonal priority field invites states that mean nothing and quietly
undermines the one opinion the app has. And concretely: dropping it from
`TASKS_COLS` frees a slot against the 20-column ceiling, which is what §X3 needs
for `ParentTaskId`. Delete the field, keep the column in the table, and spend
the slot on sub-tasks.

### 6.7 Separate capture from triage

`AddTaskDialog` asks for a quadrant at creation time, which means every capture
is a decision, so capture gets avoided and things go uncaptured. Let a task
arrive with no quadrant into an Inbox bucket, then triage in a batch — that is
when the matrix is a genuinely good tool. `Quadrant varchar(16)` already accepts
an empty string, so this may be almost free.

---

## 7. Verify before building

Your closing note said to check the data model against the Catalyst constraints
before committing, and that you know where the real limits bite. These are the
checks that would change the plan, in the order I'd run them. The first three
take under an hour together.

### 7.1 The 300-row and 20-column caps — **do this first**

`[CAT-DOCS]` says *"a maximum of 20 columns and a maximum of 300 rows in one
SELECT query"*. Insert 350 rows in a scratch table, `SELECT` without a `LIMIT`,
and count. Then `SELECT` 25 columns and see whether it errors or silently drops.

This decides: how much of N2 is needed; whether `listRules`' 24–25 columns is a
live bug; and whether `ParentTaskId` (§X3) needs `TaskPriority`'s slot or not.
It is the single highest-value hour in this document.

### 7.2 The `SourceId` overflow — **this one may be broken in production now**

`varchar(64)` receiving a 73-character composite (§0.3). Create a `due-date`
rule against a task with a due date, then query
`KaizenNotificationQueue` and look at the stored `SourceId`. Rejected, or
truncated to 64? Either answer means task-driven rules are not working the way
the code believes, and the test suite cannot tell you because
`fakeCatalyst.ts` enforces no column lengths.

### 7.3 Does `pnpm catalyst:setup` still match the live tables?

Every new table in §4 goes through it. Before any of that, confirm the seven
existing tables match `SCHEMA` exactly — then **fix the missing-table test** in
`probeCatalystTables` (`notes-server.ts:390`) and `GET /api/setup` (`:2037`):
both match on `String(e)` while the adjacent comment already states that an SDK
error renders as `[object Object]`. One word each, `String` → `describeError`.
As written, a missing table can downgrade the whole process to JSON-file
storage, which is the most dangerous ordering hazard in this plan (§N1).

To test it deliberately: add a table to `SCHEMA`, *don't* run setup, start the
server, and read the log. If it says "Missing Catalyst table(s)" the detection
works and the hazard is theoretical. If it says "Probing … failed" and then
reports `json-file` at `/api/health`, it is real.

### 7.4 Do ZCQL joins work on your tables?

`[CAT-DOCS]` says `INNER`/`LEFT`, ≤ 4 per query, fully qualified column names,
one condition per clause. Nothing in this repo has ever run one. Try a two-table
`LEFT JOIN` before X1 depends on the shape — though note §X1 concludes you
should use two paged queries regardless, so this is informational rather than
blocking.

### 7.5 Open questions I could not settle

- `[UNVERIFIED]` Whether Catalyst enforces the 20-column cap by erroring or by
  silently dropping columns. The difference decides whether `listRules` is
  broken today.
- `[UNVERIFIED]` ZCQL's tie ordering when `ORDER BY` values are equal. N2 stage
  4 needs this, or manual drag order will jump.
- `[UNVERIFIED]` Whether `date` and `double` columns round-trip through the SDK
  as strings like everything else (`03-datastore.md` says every value returns
  as a string regardless of type — presumably these too, but it was never tested).
- `[UNVERIFIED]` The full Catalyst reserved-word list. `Priority` is known. Of
  the new column names proposed here, `Status`, `Name`, `Title` and `Order` are
  the sort of words that get reserved — which is why this plan uses
  `RecurStatus`, `ViewOrder` and `DefOrder`. Probe each new name with a throwaway
  column before committing the schema.
- `[UNVERIFIED]` Your actual Notion habits. §0.4 — the workspace was empty, so
  §3's ranking is argued from HitList's code and from what personal task
  execution needs, not from evidence about you. If you use Notion properly for a
  month, rows 5, 6 and 7 are the ones most likely to move.

---

## Sources

**This repo** (`[CODE]`): `server/catalyst/schema.ts` · `server/notes-server.ts`
· `server/automations/{steps,recurrence,rules,runs,taskTriggers,planner}.ts` ·
`server/notifications/{queue,sweep,scheduler,schedule,channels,inbox,zcql}.ts` ·
`src/types/{notes,todo,automation}.ts` ·
`src/components/{NoteEditor,NotesWorkspace,AdvancedFilterBar,EisenhowerMatrix,TaskDetailPanel}.tsx`
· `src/components/notes/{TableBlock,SlashMenu,MentionMenu,InlineText,LinkedTaskChip,blockMetrics}.ts(x)`
· `src/hooks/{useCatalystSync,useNotes,useServerSync}.ts` ·
`src/services/notesSyncService.ts` · `src/lib/{api,storage,mockApi,inlineMarkdown}.ts`
· `scripts/catalyst-setup.ts` · `docs/catalyst/*.md`

**Catalyst** (`[CAT-DOCS]`):
[ZCQL introduction](https://docs.catalyst.zoho.com/en/cloud-scale/help/zcql/introduction/) ·
[SELECT syntax](https://docs.catalyst.zoho.com/en/cloud-scale/help/zcql/select/) ·
[JOIN clause](https://docs.catalyst.zoho.com/en/cloud-scale/help/zcql/joins/) ·
[LIMIT clause](https://docs.catalyst.zoho.com/en/cloud-scale/help/zcql/limit/) ·
[ZCQL functions](https://docs.catalyst.zoho.com/en/cloud-scale/help/zcql/zcql-functions/)

**Notion** (`[NOTION]`):
[data sources & linked databases](https://www.notion.com/help/data-sources-and-linked-databases) ·
[upgrade guide 2025-09-03](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03) ·
[upgrade FAQs](https://developers.notion.com/docs/upgrade-faqs-2025-09-03) ·
[working with views](https://developers.notion.com/guides/data-apis/working-with-views) ·
[property object](https://developers.notion.com/reference/property-object) ·
[filter data source entries](https://developers.notion.com/reference/filter-data-source-entries) ·
[block reference](https://developers.notion.com/reference/block) ·
[request limits](https://developers.notion.com/reference/request-limits) ·
[API changelog](https://developers.notion.com/page/changelog) ·
[database properties](https://www.notion.com/help/database-properties) ·
[relations & rollups](https://www.notion.com/help/relations-and-rollups) ·
[views, filters & sorts](https://www.notion.com/help/views-filters-and-sorts) ·
[formula syntax](https://www.notion.com/help/formula-syntax) ·
[database automations](https://www.notion.com/help/database-automations) ·
[reminders](https://www.notion.com/help/reminders) ·
[search](https://www.notion.com/help/search) ·
[use pages offline](https://www.notion.com/help/use-pages-offline) ·
[optimize database performance](https://www.notion.com/help/optimize-database-load-times-and-performance) ·
[pricing](https://www.notion.com/pricing)

**Your workspace** — `notion-fetch` on `self` and both databases,
`notion-query-data-sources` for row counts, 15 September 2026.
