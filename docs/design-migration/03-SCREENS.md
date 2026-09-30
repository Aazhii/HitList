# Phase 3 — Per-screen fidelity, one task per prototype screen

Read `CONVENTIONS.md` and `SPEC-MAP.md` first. Phases 1 and 2 must be complete —
doing screen work before the tokens and shell are right means doing it twice.

**42 tasks**, one per prototype screen, grouped and numbered in execution order.

## How every task in this phase works

1. Open the prototype screen: `node web/scripts/shoot.mjs <screen-id>`. That writes `docs/design-migration/shots/<screen-id>.ref.png` and `.app.png`.
2. Read the showcase markup at the line range `SPEC-MAP.md` gives for that screen.
3. Change the app to match. Structure first, then metrics, then copy.
4. Re-shoot. **The pair is the acceptance criterion** — not a description of what you changed.
5. `cd web && pnpm design:check && pnpm exec tsc -b && pnpm vitest run`.
6. Update `00-INDEX.md` with the shot pair as "Verified by".

**A task is not done because the diff looks right.** It is done when the two PNGs
match. This is the whole reason the phase is structured this way.

## Order

**Tasks → Task dialogs → Databases → Notes → Calendar → overlays.** Tasks and
Databases are what gets looked at daily; the Databases popover family (ten popovers) is
built once and reused by Notes' inline database in Phase 4, so it comes before Notes.

---

# 3A · Tasks (T3.1 – T3.8)

**Read first** showcase 159–300. Shared task-row vocabulary across all four layouts:
status glyph (`circle` / `loader` / `circle-check` at 17px, coloured `--gray-400` /
`#006eb9` / `--dq-valid`), title, due label with tone, category `Tag` with a solid
swatch dot, optional note back-link, and a brand `Badge` reading **"Next up"** on the
single next task.

### T3.1 — `tasks-matrix`
Showcase **184–215**. → `web/src/components/EisenhowerMatrix.tsx`

Rebuilt in the session that produced this plan and **close** already: white panel,
tinted header, flat rows, dashed empty box, `"N completed · hidden"` footer. Verify
rather than rewrite. Checks: panel `min-height:240px`, grid `max-width:1200px` with
`gap:16px`, header `padding:10px 16px` with an 8px dot, row `padding:9px 16px`, quadrant
subtitles reading `Urgent · Important` (not `&`).

Leave the dead `onToggleReminder` / `notificationPermission` props alone — T4.3 decides
their fate.

### T3.2 — `tasks-list`
Showcase **218–247**. → `web/src/components/tasks/TaskListView.tsx`, `TaskRow.tsx`

Group header is a **tinted label pill** (`padding:1px 8px; border-radius:3px;
background:{q.bg}`) plus subtitle plus mono count plus a ghost **"Add here"** button —
not a panel header. Rows live in a white `border-radius:8px` container, `min-height:44px`,
`padding:0 12px`, leading `grip-vertical` at 14px in `--gray-300`. Due date is
right-aligned in a fixed **120px** column.

### T3.3 — `tasks-table`
Showcase **250–261**. → `web/src/components/tasks/TaskTableView.tsx`

The prototype renders this with the DS `Table` plus a saved-view `Tag` strip above it
(251–258) and a "New row" button below (260). The app has a much richer custom table —
**do not downgrade it**. Match the chrome and leave the extra capability in place.

**Structural decision to make here.** `web/src/components/tasks/ViewTabs.tsx` renders
literal `Table` / `Board` chips (its `TAB_LAYOUTS`, line 31) as a secondary row. Those
now duplicate the primary tab bar, since Board became a top-level tab. The prototype's
secondary row carries **named saved views only** — `Default table`, `Due this week`,
`+`, and `2 more…` overflow (see showcase 602–603 for the Databases equivalent, and your
own Notion screenshot `uploads/Screenshot 2026-09-29 at 6.39.49 PM.png`). Remove the
built-in layout chips and update `web/test/ViewTabs.test.tsx:65`, which currently
asserts `onSelectLayout` is called with `'board'`. A deliberate change with a test
update, not a drive-by deletion.

**Done (T3.3).** ViewTabs now renders one `Default table` / `Default board` chip (selecting
it clears the applied view via `onSelectLayout`), saved-view chips, `+ New`; chips are 24px /
12px / 6px-radius bordered tags, selected = accent tint + accent border, no grey tray. A
`Fields` button now sits beside `Columns` (both 28px / 12px), opening the existing
FieldsManager. **Not done, deliberately:** the prototype's DS `Table` shows row numbers,
per-column type glyphs + type sub-labels and a `#` gutter; the app's richer table was left
as-is per the "do not downgrade it" instruction, so those grid-level differences remain and
are not covered by this task's pair. The `Due this week` sample chip is a prototype
saved-view, not a built-in — the app shows whatever views the user saved.

### T3.4 — `tasks-board`
Showcase **264–299**. → `web/src/components/tasks/TaskBoardView.tsx`

Group-by bar (265–271): `Group by` label, a `Select`, a `Manage fields` ghost button,
and right-aligned helper text — *"Drag a card to another column to change its Stage.
Undo is offered for 5 seconds."* Lane header: 8px dot, name, mono count, `+`. Cards
show title, due, category `Tag`, and a mono `N pts` estimate. Empty lanes render a
dashed drop target and **stay visible** (294).

**Fix while here:** `TaskBoardView.tsx:457` is `if (fieldsLoading) return null` — the
entire board renders nothing while fields load. Now reachable, because Board became a
top-level tab. Replace with the skeleton from `tasks-loading`. (Also listed as T4.7; do
it in whichever task reaches it first and mark the other done with a pointer.)

### T3.5 — `tasks-empty`
Showcase **175–177**. → `web/src/components/EmptyState.tsx`

`EmptyState image="hl/ill/no_data.png"`, title *"No tasks in Work yet"*, description
*"Add your first task, or turn a line in a note into one with @. Tasks land in the
Eisenhower quadrant you pick."*, then a primary **"Add task"** button at 34px.
Container `max-width:520px; margin:48px auto`. Depends on T1.10.

### T3.6 — `tasks-nomatch`
Showcase **179–181**. → `web/src/App.tsx:288` `NoMatchingTasks`.
`no_filtered_data.png`. Depends on T1.10.

### T3.7 — `tasks-loading`
Showcase **161–173**. → `web/src/App.tsx:305` `LoadingSkeleton`.
Four skeleton cards in the matrix grid (163–170), not a spinner.

### T3.8 — `tasks-offline`
Showcase **146–154**. → `web/src/components/SyncStatusBar.tsx`

**Note a duplication to resolve:** `AppHeader` now shows an always-on sync pill *and*
`SyncStatusBar` renders its own banner, with independent logic. The design has both —
the 44px row's `Badge` and a separate offline bar (146–154) — but they must agree. Make
`SyncStatusBar` render only the offline/error bar and let the pill own steady state.

---

# 3B · Task dialogs (T3.9 – T3.16)

**Read first** These are the eight overlays in showcase 940–1095. Three shapes:
- **`Dialog`** (centred, DS component) — Add task, Delete task, Delete field, Weekly progress.
- **Right drawer** (`<aside role="dialog">`, `top:52px; right:0; bottom:0`, **no scrim**) — Task detail, Today's history.
- **Anchored popover** (transparent full-inset click-catcher, then an absolutely-positioned panel) — Filter, Fields manager.

The catcher-then-panel pattern is the same one the Databases popovers use (3C). Share it.

### T3.9 — `ov-add`
Showcase **940–959**. → `App.tsx:108-252` (the inline `AddTaskDialog`)

Title input (942), a `role="radiogroup"` quadrant picker (945–947), Category `Select`
(950), due date (951), due time (953), footer (954–957). `web/test/AddTaskDialog.test.tsx`
covers this — note it re-implements a minimal copy rather than importing, so update both.

### T3.10 — `ov-detail`
Showcase **1016–1045**. → `web/src/components/TaskDetailPanel.tsx`

`position:absolute; top:52px; right:0; bottom:0; width:440px`, **no scrim** — the page
stays interactive behind it. Header 1018–1023; body: overdue banner (1025), task
`Textarea` (1026), status (1027), quadrant (1028), due (1029), category (1030), a
Stage/Estimate group (1031–1035), notes `Textarea` (1036), linked-note row (1037);
footer 1039–1043.

### T3.11 — `ov-delete`
Showcase **962–964**. → inside `TaskDetailPanel.tsx`
`Dialog` with `tone="danger"`. Danger controls get the red focus ring
(`CONVENTIONS.md` §7).

### T3.12 — `ov-filter`
Showcase **1059–1074**. → `web/src/components/AdvancedFilterBar.tsx`, `tasks/SaveViewForm.tsx`

Catcher at 1060 (`inset:0; z-index:30`), panel at `top:100px; right:120px;
width:min(560px,92vw)`. Six `Select`s in a row (1064–1069), footer (1071), and a
"Save as a view" row (1072). The app renders this inside a `Popover` from the page
header — keep that, match the panel's internals and width.

### T3.13 — `ov-fields`
Showcase **1076–1095**. → `web/src/components/fields/FieldsManager.tsx`

Panel `top:150px; right:32px; width:min(440px,92vw)`. Header 1079, field rows
1080–1082, the editor block 1083–1092 (including a `Checkbox` at 1091), footer 1093.
Already an anchored popover in the app — a prior session fixed a `Dialog`→`Popover` bug
here, so **do not reintroduce a Dialog**.

### T3.14 — `ov-fielddelete`
Showcase **967–969**. → `fields/FieldsManager.tsx`
`Dialog`, `tone="danger"`. Copy matters: say what happens to existing values.

### T3.15 — `ov-history`
Showcase **1048–1056**. → `web/src/components/TodayHistoryPanel.tsx`
Right drawer, `top:52px; right:0; bottom:0; width:400px`. Header 1050, list 1051–1053,
footer 1054. Opened from the momentum card's "Today" button (T2.3).

### T3.16 — `ov-progress`
Showcase **972–986**. → `web/src/components/StreakPanel.tsx`
`Dialog size="lg"`, title "Weekly progress", description "Work · Sep 23 – Sep 29".
Stat tiles 974–976, bar chart 977–983, footer 984. Opened from the momentum card's
"Weekly progress" button.

---

# 3C · Databases (T3.17 – T3.32)

**Read first** showcase 592–787. The toolbar at **601–612** is the anchor: view chips,
`2 more…` overflow, active sort pill, active filter pill, spacer, then four
`IconButton`s — **Filter (`list-filter`) · Sort (`arrow-up-down`) · Search records
(`search`) · Properties (`sliders-horizontal`)** — then a primary **`New`** button with
a **trailing chevron** (`iconRight`), which adds a *row*. That is distinct from the
page-header's `New column`, which adds a *property*.

The ten popovers in this group share one pattern: a transparent full-inset
click-catcher div, then an absolutely-positioned white panel at `border:1px solid
var(--border-default); border-radius:6px; box-shadow:var(--shadow-lg); padding:6px`.
**Build that shell once** — Phase 4's inline-database feature (T4.8) reuses all ten.

### T3.17 — `db-table`
Showcase **613–749**. → `web/src/pages/DatabasesPage.tsx`, `databases/RecordTable.tsx`

Header cells: 36px tall, `padding:0 8px`, a 15px type glyph, the name, and — the
DataPrep signature — a **3px data-quality fill bar pinned to the header's bottom edge**
(`background:var(--dq-missing-track)` with a `var(--dq-valid)` fill at `{h.fill}`,
showcase 622). `RecordTable.tsx:63` already computes `fillCount`; verify it renders as a
3px bottom bar. Rows `min-height:36px`, cells `padding:6px 8px`. A trailing 44px `+`
header adds a property. Bottom row is `+ New record`.

Toolbar state: a `Sorted by X ×` pill and a filter pill appear **inline in the toolbar**
when active (604–605). The sort pill exists from a prior session; confirm the filter pill.

### T3.18 — `db-board`
Showcase **750–762**. → `web/src/components/databases/RecordBoard.tsx`

The Board reference screen shows **no secondary view-chip row** — just the group-by
toolbar. Confirm the app does not render the chip strip in board layout.

### T3.19 — `db-colmenu`
Showcase **651–694**. → `RecordTable.tsx:378` `FieldHeader`

A rename `<input>` at the top of the menu (654), then the item list. Items may carry a
right-aligned value (`m.hasRight`), a `Switch` (`m.hasSwitch`), or a chevron for a
submenu (`m.hasChevron`). Item rows: `padding:5px 8px; min-height:30px;
border-radius:4px; font-size:14px; gap:10px`, 16px icon. Panel `width:260px;
max-height:70vh; overflow:auto`.

### T3.20 — `db-type`
Showcase **665–672**. → `RecordTable.tsx` type submenu

`width:230px; max-height:420px`, a `Change type` caption row at `font-size:12px;
color:var(--text-tertiary)`, then the type rows with a blue check on the current one.
The app's Change-type flow already works end to end — including the non-destructive
cloak/uncloak behaviour where switching type blanks values and switching back restores
them. **This task is chrome only. Do not touch the behaviour.**

### T3.21 — `db-options`
Showcase **681–693**. → `fields/FieldsManager.tsx`
`role="dialog" aria-label="Edit options"`. Option rows 684–690.

### T3.22 — `db-newprop`
Showcase **696–705**. → `fields/FieldsManager.tsx`
Type grid at 701–703.

### T3.23 — `db-props`
Showcase **707–715**. → `DatabasesPage.tsx:975` `PropertiesButton`
Note the `Show all` action in the header (468/709).

### T3.24 — `db-sort`
Showcase **716–726**. → `DatabasesPage.tsx:896` `SortButton`

### T3.25 — `db-filter`
Showcase **727–738**. → `DatabasesPage.tsx:863` `FilterButton`

### T3.26 — `db-picker`
Showcase **739–748**. → `RecordTable.tsx` `FieldCell`
`role="listbox"`, option rows with a check on the selected one.

### T3.27 — `db-peek` — **net-new**
Showcase **765–784**. `grep -ri peek web/src` returns nothing today.

`<aside role="dialog" aria-label="Record">` at `position:fixed; top:0; right:0;
bottom:0; width:min(520px,100vw)`. Header (767): a `chevrons-right` close button, the
database name in `--text-tertiary`, spacer, a `trash-2` delete button. Body: the record
title, then one row per property (770–780) reusing the table cells' editors.

A real feature, not a restyle. If it grows past a day, move it to Phase 4 and say so in
`00-INDEX.md`.

### T3.28 — `db-freeze`
Showcase 613–749 with `freeze:'title'`. → `RecordTable.tsx`
`position:sticky` with the showcase's per-cell `left` / `z-index` / background. Exists
from a prior session — **scroll-test it**, since that is the only way it fails.

### T3.29 — `db-group`
Showcase 627–645 with `groupBy` + `calc`. → `RecordTable.tsx`
Group rows (628): a tinted label pill plus a count. Calc footer (645): 32px,
right-aligned per column, `font-size:12px; color:var(--text-tertiary)`.

### T3.30 — `db-new`
Showcase **1124–1131**. → `DatabasesPage.tsx:1130` `NewDatabaseButton`
`top:230px; left:232px; width:280px`.

### T3.31 — `db-empty`
Showcase **593–595**. `no_data.png`. Depends on T1.10.

### T3.32 — `db-offline`
Showcase **596–598**. `error_state.png`. Copy verbatim: *"Databases need the server — A
record's columns are field definitions the server holds, so there is no offline copy.
Try again when it is reachable."* Depends on T1.10.

---

# 3D · Notes (T3.33 – T3.36)

**Read first** showcase 303–589. The editor is an `<article>` at
`max-width:calc(720px + 44px); margin:0 auto; padding:16px 0 96px 44px` (311) — the 44px
left padding is the block-controls gutter.

### T3.33 — `notes-editor`
Showcase **310–587**. → `web/src/components/NoteEditor.tsx`, `NotesWorkspace.tsx`

Page furniture: note emoji icon (312), `h2` title (313), and a meta line (314) reading
*"Edited 2h ago · N blocks"*. Block types to verify against 317–354: h3, paragraph,
to-do with gutter controls, callout, bullet list, blockquote, table block, code block.
The gutter's `+` and grip live at 321–324 as 28px `IconButton`s.

`web/src/components/notes/blockMetrics.ts` already centralises the gutter geometry —
change values there, not per block.

### T3.34 — `notes-slash`
Showcase **550–568**. → `web/src/components/notes/SlashMenu.tsx`

Two groups: **Basic blocks** and **Database**. The Database group's three items
(`dbSlashItems`, showcase 1753) are *Create database*, *Create board*, *Linked view of
Reading list* — they belong to T4.8. Render that group only once the actions exist; do
not ship dead menu items.

### T3.35 — `notes-mention`
Showcase **570–584**. → `web/src/components/notes/MentionMenu.tsx`
Cascading: Add to quadrant → workspace → quadrant.

### T3.36 — `notes-empty`
Showcase **304–309**. → `NotesWorkspace.tsx:97` `NotesEmptyState`.
`sample_data.png`. Depends on T1.10.

> The five `notes-db-*` prototype screens (inline databases inside a note) are a whole
> feature the app does not have. They are **Phase 4**, tracked as T4.8 — not part of
> Phase 3 fidelity.

---

# 3E · Calendar (T3.37 – T3.39)

### T3.37 — `cal-month`
Showcase **794–825**. → `web/src/pages/CalendarPage.tsx`, `calendar/UnifiedCalendar.tsx`

Toolbar (796–801): prev/next `IconButton`s, an `h2` month label, a `Today` button. Grid
802–816 with a weekday header row, day cells carrying item chips, and a `c.hasMore`
overflow indicator (813). Legend row 818–823 using `Tag`s.

### T3.38 — `cal-add`
Showcase **1114–1122**. → `CalendarPage.tsx:251` `AddOnDayDialog`
`width:300px`, a `role="radiogroup"` target picker (1119) offering *A task* or *A record
in Reading list*. Note the page-header action for Calendar is **ghost**, not primary
(showcase 139).

### T3.39 — `cal-offline`
Showcase **791–793**. `error_state.png`. Depends on T1.10.

**Also** `CalendarPage.tsx:169` renders `ZOHO_CALENDAR_UNAVAILABLE_REASON` as static
sidebar copy. Leave it — T4.3/T4.4 decide whether that capability returns.

---

# 3F · Shell overlays (T3.40 – T3.42)

### T3.40 — `sh-notif`
Showcase **1099–1103**. → `web/src/components/NotificationBell.tsx`
`top:48px; right:56px; width:360px`. The bell is already mounted in `AppHeader`.

### T3.41 — `sh-account`
Showcase **1108–1111**. → `web/src/components/shell/UserMenu.tsx`
`role="menu"`, `top:48px; right:12px; width:272px`. The app's menu contains only static
text today ("Local workspace", "PostgreSQL", "Same-origin Spring Boot service"). Match
the prototype's structure; the reminders entry point lands here in T4.3.

### T3.42 — sidebar page menu
Showcase **1136–1144**. → `ListSidebar.tsx`, `tasks/SavedViewsSection.tsx` row menus
`position:fixed`, `width:280px`, items with optional separators and keyboard hints
(1140), and a footer meta line (1143). The prototype's items include *Add to Favorites*
/ *Remove from Recents* (showcase 1525–1526) — those depend on T4.1, so render them only
once Favorites exists.

---

# Phase 3 exit gate

1. A `.ref.png` / `.app.png` pair exists in `docs/design-migration/shots/` for all 42 tasks, and each pair matches.
2. `cd web && pnpm design:check && pnpm exec tsc -b && pnpm vitest run` — clean and green.
3. One rebuild + redeploy, re-verified against the running desktop app.
4. `00-INDEX.md` names the proving shot pair for every task.
