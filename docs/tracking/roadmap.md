# HitList roadmap

Working tracker for what is being built, what is next, and what is deliberately
not being built. Designs live in [`../notion-parity-plan.md`](../notion-parity-plan.md);
this file links to its sections (e.g. §N1) instead of repeating them.

Started 15 September 2026.

## How to use this file

- `- [ ]` not started
- `- [ ]` **In progress** — being worked on now
- `- [x]` done, with the date and commit: `- [x] … — done 2026-09-16, a1b2c3d`

Only verified or explicitly planned work goes here. Anything not yet confirmed is
marked **unverified**.

Every change that touches stored data follows the same order: back up
(`scripts/backup-tables.mjs`), dry-run `pnpm catalyst:setup`, apply, then diff row
counts. New tables and columns are additive only; existing rows are never rewritten.

---

## Now

### Moving to the HitList2 org

The original org's AppSail free tier ran out (every request answered 400
`FREE_USAGE_LIMIT_REACHED` from 16:51 on 2026-09-15). The app moves to a new org:
**HitList2 — org 60088007808, project 71828000000013051**.

- [x] **Backup of the old project.** All 10 tables and the 7 app users, compared
  with the live project table by table: identical. `backups/2026-09-15T12-02-54-681Z/`
  (local, git-ignored). — done 2026-09-15
- [x] **Server on HitList2's AppSail**, `https://hitlist-api-50045941899.development.catalystappsail.in`:
  health 200 on the Catalyst backend, 401 without a session, tick accepted with
  `TICK_SECRET`, hourly cron repointed to it. — done 2026-09-15, 29e21f8
- [x] **Migration script** `scripts/migrate-to-project.mjs`: reassigns rows to
  owners' new user ids by email; skips rows already present, so re-running
  cannot duplicate. — done 2026-09-15, 29e21f8
- [x] **arikaran258@gmail.com migrated:** account created in HitList2, 24 rows
  imported (3 lists, 5 tasks, 1 note, 2 rules, 9 rule runs, 4 notifications),
  compared field for field with the backup: identical apart from the owner id.
- [ ] **The other three people with data** — nandanadhandapani.ai@gmail.com (5
  tasks, 1 note), haribabu2004.m@gmail.com (2 tasks, 2 notes),
  athithanramabhoopathi@gmail.com (2 tasks, 1 note). Blocked: adding a user needs
  an invitation redirect on an authorised domain, and the AppSail URL is not
  authorised in HitList2's Authentication settings yet. Their rows are safe in
  the backup; import is one re-run once their accounts exist.
- [x] **Slate app** at `https://hitlist-oeiefiri.onslate.in`. It first served a
  build from before 14 Sep (it still called the old org's AppSail and lacked the
  redesign), so it was rebuilt from the current commit. Its origin was added to
  `ALLOWED_ORIGINS`. — f24291a
- [x] **Every API call from Slate was blocked by CORS.** Catalyst's AppSail
  gateway answers OPTIONS preflights itself — 200, empty, no CORS headers — and
  never forwards them. Verified: the same preflight against the server locally
  returns 204 with every header. Fix: every call is now a CORS simple request
  (PUT/PATCH/DELETE as `POST ?_method=`, timezone as `?tz=`, JSON as
  `text/plain`), mapped back by `server/simpleRequests.ts`, which also refuses
  changes from origins that are not allowed. Notes sync was also calling Slate
  itself with relative URLs and no session cookie. — done 2026-09-15, 9dcb60c
- [x] **A login on Slate does authenticate calls to AppSail.** Verified from the
  data: a note created in the Slate client at 18:29 on 2026-09-15 was written to
  HitList2 with owner 71828000000021001 (arikaran258@gmail.com's new id) and
  updated at 18:30. The `PUT /api/notes/:id → 404` seen in the browser is the
  expected first step of notes sync's upsert (PUT, then POST on 404).
- [ ] Queued notifications (12) deliberately not migrated; reminders are
  re-created when each person opens the app.

### Trial features — switching off what keeps AppSail running

- [x] **`KaizenTrialFeatures` table** (FeatureKey, Enabled, UpdatedAt; app-wide, no
  OwnerId). Backup `backups/2026-09-15T13-16-44-898Z/`, dry run listed only this
  table, created; every other table's row count unchanged afterwards. —
  done 2026-09-15, 65cef5f, d0bd4ee
- [x] **`notifications` off:** the sweep timer is not started (or stops on its next
  tick), and the tick answers `{paused: true}`. Verified live: the tick returned
  `paused` after deploy. The hourly cron `hitlist_notification_sweep` was deleted.
  Whether the timer is actually stopped on the instance is **unverified**, because the
  AppSail logs were not read.
- [x] **`automations` off:** no rule planning, rule firings withdrawn as they come
  due, "Run now" refused (409). The Automations page shows a paused notice once
  Slate is rebuilt.
- [x] **A reminder more than a day late is withdrawn, not sent.** It stays in the
  queue as CANCELLED, with the reason recorded. Always applies, not only after a
  pause.
- Both switches set to `false` on 2026-09-15 with `pnpm catalyst:features`.
- To turn back on:
  1. Set Enabled to `true` in the console, or run
     `pnpm catalyst:features notifications=true automations=true`. The script's
     update path is **untested**; only its insert path has run.
  2. Run `pnpm catalyst:cron` to restore the hourly backstop.

### Step 0 — verified live bugs

- [x] **Escalation firings are never withdrawn.** Rule firings store `SourceId` in
  a `varchar(64)` column, but the value is `${ruleId}:${taskId}` — 73 characters.
  Every stored firing held exactly the first 64 while the cancel lookups searched
  for all 73. Fixed by clamping on write and lookup, which also matches rows
  already stored. (§0.3) — done 2026-09-15, e59ed8b. **Verified against the live
  datastore:** moving a due date cancelled the 2 old firings, completing the task
  cancelled the rest.
- [x] **Deleting a rule leaves its per-task firings pending.** Now withdraws the
  rule's own firings and every per-task firing. (§0.3) — done 2026-09-15, e59ed8b.
  Verified live: deleting a rule cancelled its pending per-task firings.
- [x] **The table probe can misread a missing table.** `probeCatalystTables`,
  `GET /api/setup` and `catalystGetOwnerRows` matched errors on `String(e)`; now on
  the readable form. (§7.3) — done 2026-09-15, e59ed8b

### Feature 1 — Views

- [x] **Stage 1: the filter bar actually filters.** Status, quadrant, search, date
  range and sort now change what is shown, plus a relative Due filter (overdue,
  today, next 7 days, none). (§N1 stage 1) — done 2026-09-15, 13be22f.
  Applied in the browser over loaded tasks, **not** by fetching a filtered list as
  §N1 suggested — see Corrections.
- [x] **Stage 2: saved views.** New `KaizenViews` table (created with
  `pnpm catalyst:setup` after a dry run listed only it) holding name, layout,
  filter, list scope and "show completed"; views above Lists; "Save as view" in
  the filter popover; a view shows as current whenever the screen matches it.
  (§N1 stages 2–3) — done 2026-09-15, dbdd297. Verified against the live datastore:
  create, list, update, validation errors, 404 and delete.

---

## Next

### Feature 2 — Custom task fields, including picklists

New tables `KaizenPropDefs` (field definitions and options, per user) and
`KaizenTaskProps` (values), read with two paged queries rather than a join. Field
types: single select, multi-select, number, date, checkbox, text. (§X1)
Values are stored as text and parsed by kind — not in `date`/`double` columns,
whose round-trip is still **unverified**. A field's kind is fixed once created.

- [x] Stage 1: create, edit and delete field definitions — done 2026-09-15, d10a133
- [x] Stage 2: set values on a task in the task panel, and chips on cards for
  fields marked "Show on card" — done 2026-09-15, d10a133. Verified against the live
  datastore: one row per task and field, wrong-kind values and kind changes
  rejected, renaming an option keeps its value, deleting a task or field leaves
  no value rows.
- [x] Stage 3: filter views by a field. Logic and saved-view storage landed in
  a0934c4, but it did nothing on screen: App never passed field values to the
  filter, and there was no UI. Now wired, with a menu per field in the filter
  popover (options, has a value / empty, checked / unchecked). — done 2026-09-16
- [x] Stage 4: group by a select field, in the list and the table; drag to
  reorder is off while grouped. — done 2026-09-16

### Feature 3 — Tasks as a database (option A)

Tasks stay the records; no new tables, no stored data rewritten.

- [x] **Table layout** (List / Matrix / Table): Title, Status, Quadrant, Due and
  a column per custom field, every cell editable in place, headers sort
  (asc → desc → manual), group by a select field. Sort by quadrant or by any
  custom field, also in the filter popover, kept in saved views. The server now
  accepts `table` as a view layout and the new sort keys. — done 2026-09-16.
  Unit and component tests only; **not yet clicked through in a browser**.
- [x] **Board layout**: a column per option of the group-by select field plus
  "No <field>", cards dragged between columns set or clear the value; without a
  field it offers the select fields, or to create one. The server accepts
  `board` as a view layout. — done 2026-09-16. Unit and component tests only;
  drag itself is **not tested in a browser**.
- [x] **Board fixes from first use:** the board ignored Multi-select and Checkbox
  fields, so an account with only those saw "You don't have one yet". Grouping
  now takes both (a multi-select task sits under each option; checkbox is Checked
  / Not checked). Board moved inside Table (Table / Board switch); top bar is
  List / Matrix / Table. — done 2026-09-16
- [x] **Calendar layout** (inside Table: Table / Board / Calendar): month grid,
  Monday first; tasks on their due date, timed first; a tray for tasks with no
  date. Drag to another day moves the date (time kept), onto the tray clears date
  and time, from the tray onto a day sets one. Click opens the task; + on a day
  adds a task due that day. The server accepts `calendar` as a view layout.
  — done 2026-09-16. Unit and component tests only; drag **not tested in a
  browser**.

### Feature 3b — Finishing the Table / Board / Calendar UI

From using it live on 2026-09-16: the board's field also grouped the table, the
Filter badge counted sorting and grouping, there was no way back from a chosen
board field, no way to create a named board, and the table had no row or column
controls. Plan: `~/.claude/plans/magical-soaring-dolphin.md`.

- [x] **Step 1 — grouping per layout, honest filter badge, matching skeleton.**
  Each layout keeps its own group-by (localStorage); the badge counts only filters
  that hide tasks; the skeleton matches the layout. — done 2026-09-16, fd5d563
- [x] **Step 2 — view tabs.** Table · Board · Calendar, then a tab per saved view of
  those layouts, then "+ New" (name, layout, and for a board the field). A tab that
  no longer matches shows a dot with Save / Reset; Rename, Duplicate, Delete per
  tab. — done 2026-09-16, f025e09
- [x] **Step 3 — board toolbar and "+ Add".** "Columns: <field>" changes the field,
  creates one, or goes back to choosing; each column adds a task already carrying
  its value. — done 2026-09-16, 4c901ac
- [x] **Step 4a — table rows, cells and column menus.** Titles wrap and edit in a
  box that grows; the due date reads "Sep 20" and edits in a popover with Clear;
  the checkbox is the app's own, not the browser's. A "+ New task" row in each
  group (carrying that group's value) and at the end; a row menu with Open and
  Delete (confirm first). Column headers gained a menu: Hide column, and for a
  field Edit field… and Delete field… (confirm), plus "+" to add a field — the
  update/delete for fields that was missing. Hidden columns are kept per list in
  localStorage. — done 2026-09-16
- [x] **Step 4b — column choices saved with a view.** A Columns button beside the
  view tabs shows, hides and reorders a table's columns; Title is always shown.
  Stored as `{hidden, order, widths}` per list in localStorage, and in a view via
  a new **additive `DisplayJson`** column on KaizenViews — backed up first
  (0 rows), dry run listed only that column, every other table's count unchanged.
  The server reads and writes it only once it has seen it
  (`ensureViewDisplayColumn` → `hasOptionalColumn`), so deploying ahead of
  `catalyst:setup` cannot break view reads. Changing columns marks the tab
  changed, so Save keeps them. — done 2026-09-16, 172e900 + the client half
  - **Not built:** dragging a column edge to resize. `widths` is stored and
    normalised (80–600) but nothing sets it yet.
- [x] **Step 5 — undo, and browser Back.** One `undoable()` helper puts an Undo
  on the toast for the changes that are easy to make by accident: a card dragged
  between board columns, a task moved on the calendar, and any table cell edit —
  each capturing the old value first. `useHistoryState` records one history entry
  per screen (page, list, layout, open view) and restores it on Back or Forward,
  so Back no longer leaves the app. No router: no paths and no route table to
  keep in step. — done 2026-09-16
- [x] **Step 6 — calendar: "+N more".** A day shows three tasks, then a "+N more"
  button opening the whole day; chips carry their full title on hover. Dragging
  stays on the grid — a drag inside a popover fights the popover's own
  dismissal — so a task is opened, not moved, from that list. — done 2026-09-16
### Step 7 — Databases (option B)

Records that are not tasks, with their own fields, shown through the Table, Board
and Calendar already built. Tasks stay where they are — they are simply the
database the app ships with. Design in the plan file.

- [x] **Stage 1 — tables.** `KaizenDatabases` and `KaizenDbRows` created, and an
  additive `DatabaseId` on `KaizenPropDefs` ('' = the task fields, so every field
  that exists keeps working). Backed up first; every pre-existing table's row
  count unchanged afterwards (PropDefs 2, TaskProps 3, Tasks 5, Lists 3, Notes 4,
  Views 0, Rules 2, Runs 17, Inbox 6, Queue 9, Trial 2); both new tables empty.
  — done 2026-09-16
  - **`RowId` is unusable as a column name.** Column names are case-insensitive,
    so it resolves to Catalyst's own `ROWID`: setup reports "already exists" and
    creates nothing, while `SELECT RowId` quietly returns the internal id. The
    column is `RecordId`. Same trap as `Priority`, which is why tasks use
    `TaskPriority`. Add to the reserved-name list in docs/catalyst.
- [x] **Stage 2 — server.** `server/databases.ts` (CRUD, validation, reads paged
  at 300 from the start), `/api/databases` and `/api/databases/:id/rows` routes,
  and `server/fields.ts` scoped by database behind the `hasOptionalColumn` guard,
  so deploying ahead of `catalyst:setup` still reads every field as a task field.
  — done 2026-09-16
- [x] **Stage 3 — record values.** Records had no values path at all:
  `/api/field-values` joins against the task fields, so a record's values were
  dropped, and the only setter was task-scoped. Added
  `GET /api/databases/:id/field-values` and
  `PUT /api/databases/rows/:recordId/fields/:fieldId`, which refuses a field
  from another database. Deleting a record removes its values, as a task's does.
  — done 2026-09-16, 42b251b
  - **Scope call:** the record shape stops here. The Table is the one view a
    database can use as-is; Board needs a card that is not `MatrixTaskCard`, and
    Calendar needs a chosen date field. Both are stage 5 rather than a rewrite of
    three components now.
- [x] **Stage 4 — the Databases screen.** A Databases entry in the rail; the left
  column lists databases with New / Rename / Delete (the delete says how many
  records went with it); the main area is the open database's records as a table
  of Title plus a column per field, editing in place, with the field's own menu
  on each column header and "+ New column". The page states plainly that records
  have no reminders, escalation or automations. — done 2026-09-16
- [x] **Stage 5 — Board and Calendar over records.** A database now has the same
  three views tasks do, switched per database (kept on the device; a database's
  views are not saved views yet).
  - **Board**: columns from one of the database's own fields, dragging a card
    between them sets it, "+ Add" creates a record already in that column. The
    drop rules are the task board's, imported rather than copied — `boardDrop`,
    `boardCardId`, `parseBoardCardId` only touch ids and field values.
  - **Calendar**: the database names which Date column the calendar reads, in a
    new additive `DateFieldId` on KaizenDatabases behind `hasOptionalColumn`.
    Backed up first; dry run listed only that column; every row count unchanged.
  - **Shared grouping**: `groupItemsByField` is the generic core; `groupByField`
    stays as its task-shaped wrapper, so no existing caller or test changed.
  - `RecordCard` is deliberately not `MatrixTaskCard` — a record has no status,
    due date, reminder or category. `FieldChips` is shared.
  — done 2026-09-16, 6b1dafe → 5ba13ee and the calendar commit.
  Unit and component tests only; **drag is not tested in a browser**.

### Feature 4 — Databases redesign, and one calendar

From the `design_handoff_notes_tasks_redesign 2` bundle (`DATABASES.md`, mocks
`1a`/`1b`/`1c`) plus your call that one calendar should serve both tasks and
records. Full plan: `~/.claude/plans/magical-soaring-dolphin.md` — nine phases.

- [x] **Phase 1 — one calendar.** A Calendar view in the rail below Databases,
  carrying tasks by due date *and* database records by their date column. Drag
  writes whichever the item is; "+" on a day asks what to create; chips switch a
  list or database off. `GET /api/calendar` returns both in one request instead of
  N+1. `TaskCalendarView` and `RecordCalendar` are deleted — one component now.
  A view saved as a calendar still loads, as a table. — done 2026-09-16, 23a7a0f
- [x] **Phase 2 — the reported bug.** The add-column control was a `Dialog`, whose
  `bg-black/80` overlay hid the grid you were deciding about and locked its
  scroll. Now an anchored popover that flips or shifts at an edge.
  `FieldsManagerDialog.tsx` → `FieldsManager.tsx`. — done 2026-09-16
- [ ] **In progress** — Phase 3: the grid redesign (D2 chrome, D3 add-property
  popover with type groups, D4 column menu + option editor with per-option
  counts, D5 toolbar + calculation footer)
- [ ] Phase 4: database views saved on the server (`DatabaseId` on KaizenViews)
- [ ] Phase 5: row peek — a row is a page, with `NoteEditor` as its body
- [ ] Phase 6: wave-1 column types (Status, URL, Email, Phone, number formats, system)
- [ ] Phase 7: change a column's type, with the migration rules
- [ ] Phase 8: relation and rollup
- [ ] Phase 9: gallery, timeline, CSV, templates, ten fixed computed columns

**Dark mode is deliberately unreachable.** `.app-organic.dark` holds a complete
token set (`index.css:532`) but nothing ever adds the `dark` class — only
`app-organic` and `login-locked` are ever set. Checked on 2026-09-16 against the
`design_handoff_notes_tasks_redesign` bundle, whose Task 0 asked for this
decision: leave the tokens in place, unused. Not a bug; do not "fix" it by
half-wiring a toggle.

---

## Verified bugs

- [x] **A note has no size guard.** The server now rejects a note over the
  10,000-character column by name; sync stops retrying a rejected note instead of
  marking the server offline; the note shows its size from 9,000 characters.
  (§N4) — done 2026-09-15, e59ed8b
- [x] **Notes can cross accounts on a shared browser.** Notes now live under a
  per-user localStorage key; notes under the old shared key are claimed once,
  merged by id, and never deleted before being copied. — done 2026-09-15, fd9a9f9
- [x] **Momentum and today's history used the server's date (UTC).** Days are now
  worked out in the timezone the client sends. (§X2) — done 2026-09-15, e59ed8b
- [x] **`TaskPriority` is dead.** The Priority filter and "sort by priority" are
  removed from the UI, since they could only hide every task. — done 2026-09-15,
  13be22f. The column and the API's `priority` parameter still exist, unused.
  (§1.5, §6.6)

---

## Future enhancements

- [ ] Recurring tasks (§N3)
- [ ] Notes that load from the server, plus full-text search (§X4) — today notes
  are never read from the server; `notesSyncService` only sends PUT, POST, DELETE
  and HEAD
- [ ] Calendar and board layouts (§X2)
- [ ] Sub-tasks (§X3)
- [ ] A live task view embedded in a note (§X5)
- [ ] Per-step escalation channels — in-app first, then push, then email (§6.1)
- [ ] Snooze or defer instead of dismiss (§6.2)
- [ ] Export / import (§4 Later)
- [ ] A URL router, so views and pages can be linked (§4 Later)
- [ ] Paged reads past 300 rows (§N2) — Catalyst documents a 300-row limit per
  query; **unverified** here, and the largest table currently holds 13 rows.
  New code (views, rule cancellation) already pages its reads.

---

## Not building

Formulas · general relations and rollups · permissions, sharing and collaboration ·
timeline, gallery, map, form and dashboard layouts · synced blocks · AI agents.
Reasons in §3.2.

---

## Corrections to the parity doc

Checked on 15 September 2026, against the code and read-only against the live
project. Don't build on the original claims below.

| Parity doc | What was found |
|---|---|
| §0.2 — "20 columns per SELECT; `KaizenTasks` is at 19, one more column breaks every task read" | A 25-column SELECT on `KaizenAutomationRules` returned all 25 columns, including the last. Not enforced at that width. Side tables are still the right design for custom fields, but because fields are per-user, not because of a column cap. |
| §0.2 / §N2 — "every list read silently truncates at 300 rows" | Documented by Catalyst, **unverified** here. The largest table holds 13 rows, so it is a future limit, not a present bug. |
| §N1 stage 1 — "pass the filters to `api.task.list(params)`" | Would have broken things. App's task array also feeds list counts, reminders, note chips and the offline copy in localStorage; a filtered fetch replaces all of them with the subset. Filters are applied in the browser instead (`src/lib/taskFilters.ts`). |
| §1.5 — "nothing imports `useServerSync`" | Its types and converters are imported (`src/hooks/useCatalystSync.ts`). The hook function itself is unused. |
| §0.4 / §3 — gap ranking "against how you use Notion" | The Notion workspace held only template content, so the ranking reflects HitList's code, not real Notion usage. The doc says this itself. |

Still **unverified**, so nothing here depends on them: ZCQL joins on these tables,
ZCQL ordering of tied values, whether `date` and `double` columns round-trip, and
the full list of reserved column names.
