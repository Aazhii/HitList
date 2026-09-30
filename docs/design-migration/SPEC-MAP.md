# Spec map — prototype screen → showcase lines → app code

Lookup table for every one of the 51 prototype screens. Use it to find the exact
markup to match and the exact app file that renders the equivalent.

**Showcase** = `~/Documents/newHitlistDesign/project/HitList Notion x Zoho.dc.html`
(1,879 lines). All line numbers below are that file.

## How to open a prototype screen

The prototype is interactive, not static markup. To see a screen rendered:

1. Launch headless Chrome with `--allow-file-access-from-files`.
2. Navigate to `file:///Users/arikaran-25256/Documents/newHitlistDesign/project/HitList%20Notion%20x%20Zoho.dc.html`.
3. Click the **"Screens · N/51"** pill, bottom-right (showcase 1148–1160).
4. Click the target screen's button in the panel that opens.

Two gotchas, both already hit and solved:
- A plain DOM `.click()` does **not** fire the prototype's handlers. Use a real synthetic mouse click at the element's `boundingBox()` centre.
- Several labels are ambiguous across groups — "Table", "Board", "List" and "Matrix" each appear both as a screen-switcher entry and as a live tab inside the rendered app. Filter to `button` elements whose `role` is **not** `tab`.

`web/scripts/shoot.mjs` (T0.5) wraps all of this — prefer it over ad-hoc scripts.

---

## Shell chrome — shared by every screen

| Region | Showcase lines | App file |
|---|---|---|
| `isApp` gate (whole shell) | 35–906 | `web/src/App.tsx:1397-1682` |
| Sidebar `<aside width:248px>` | 39–105 | `web/src/components/shell/Sidebar.tsx` |
| — workspace switcher row | 40–44 | `Sidebar.tsx:85-91` |
| — Search row (`Ctrl K`) | 45 | `Sidebar.tsx:93-103` |
| — primary nav | 46–53 | `Sidebar.tsx:106-133`, `VIEWS` at `:9` |
| — contextual sections | 56–86 | `ListSidebar.tsx`, `tasks/SavedViewsSection.tsx`, pages push theirs up via `onSidebarContentChange` |
| — "Today's momentum" card | 89–104 | `components/MomentumBar.tsx` |
| `<main background:#fff>` | 107–904 | `App.tsx` content column |
| Top chrome row, 44px | 108–115 | `web/src/components/shell/AppHeader.tsx` |
| Page header block | 118–144 | `web/src/components/shell/TopBar.tsx` |
| Offline sync bar | 146–154 | `components/SyncStatusBar.tsx` |
| Content scroll container | 156 | `App.tsx`, per-page wrapper divs |

---

## Group: Tasks (8 screens) → `03-SCREENS.md` tasks T3.1–T3.8

| id | Label | Showcase lines | App file |
|---|---|---|---|
| `tasks-matrix` | Matrix | **184–215** (quadrant loop 186–213, task row 196–209, empty 210, doneNote 211) | `components/EisenhowerMatrix.tsx` |
| `tasks-list` | List | **218–247** (group 220–244, row 230–240, empty 241) | `components/tasks/TaskListView.tsx`, `TaskRow.tsx` |
| `tasks-table` | Table | **250–261** (saved-view chips 251–258, DS `Table` 259, new-row 260) | `components/tasks/TaskTableView.tsx` |
| `tasks-board` | Board | **264–299** (group-by bar 265–271, lanes 272–298, cards 282–293, empty drop 294, add-column 297) | `components/tasks/TaskBoardView.tsx` |
| `tasks-empty` | Empty list | **175–177** (`EmptyState image=no_data.png`) | `components/EmptyState.tsx` |
| `tasks-nomatch` | No filter matches | **179–181** (`no_filtered_data.png`) | `App.tsx:288` `NoMatchingTasks` |
| `tasks-loading` | Loading | **161–173** (skeleton cards 163–170) | `App.tsx:305` `LoadingSkeleton` |
| `tasks-offline` | Offline | 146–154 sync bar + matrix | `components/SyncStatusBar.tsx` |

## Group: Task dialogs (8) → T3.9–T3.16

| id | Label | Showcase lines | App file |
|---|---|---|---|
| `ov-add` | Add task | **940–959** (input 942, quadrant radiogroup 945–947, category 950, due date 951, due time 953, footer 954–957) | `App.tsx:108-252` inline `AddTaskDialog` |
| `ov-detail` | Task detail panel | **1016–1045** — `top:52px;right:0;bottom:0;width:440px`, **no scrim** | `components/TaskDetailPanel.tsx` |
| `ov-delete` | Delete task confirm | **962–964** (`tone="danger"`) | inside `TaskDetailPanel.tsx` |
| `ov-filter` | Filter popover | **1059–1074** — `top:100px;right:120px;width:min(560px,92vw)`, 6 Selects 1064–1069, "Save as a view" 1072 | `components/AdvancedFilterBar.tsx`, `tasks/SaveViewForm.tsx` |
| `ov-fields` | Fields manager | **1076–1095** — `top:150px;right:32px;width:min(440px,92vw)` | `components/fields/FieldsManager.tsx` |
| `ov-fielddelete` | Delete field warning | **967–969** (`tone="danger"`) | `components/fields/FieldsManager.tsx` |
| `ov-history` | Today's history | **1048–1056** — `top:52px;right:0;bottom:0;width:400px` | `components/TodayHistoryPanel.tsx` |
| `ov-progress` | Weekly progress | **972–986** (`size="lg"`, stat tiles 974–976, bar chart 977–983) | `components/StreakPanel.tsx` |

## Group: Notes (9) → T3.33–T3.36 (the 5 inline-database screens are Phase 4, T4.8)

| id | Label | Showcase lines | App file |
|---|---|---|---|
| `notes-editor` | Note editor | **310–587** — `<article max-width:calc(720px + 44px);padding:16px 0 96px 44px>` 311; icon 312, H2 313, meta 314; blocks 316–586 | `components/NoteEditor.tsx`, `components/NotesWorkspace.tsx` |
| `notes-slash` | Slash menu | **550–568** | `components/notes/SlashMenu.tsx` |
| `notes-mention` | @ add to quadrant | **570–584** | `components/notes/MentionMenu.tsx` |
| `notes-empty` | No notes yet | **304–309** (`sample_data.png`) | `NotesWorkspace.tsx:97` `NotesEmptyState` |
| `notes-db-new` | / Create database, just inserted | 356–542 with `noteDb:'new'` | **net-new** — no inline-database block exists |
| `notes-db` | Database inside a note | **356–542** (header+toolbar 357–370, table 371–507) | **net-new** |
| `notes-db-menu` | Inline database · property menu | **409–452** + submenus 423–451 | **net-new** |
| `notes-db-board` | Inline database · board | **508–520** | **net-new** |
| `notes-db-linked` | Linked view of Reading list | 356–542 with `noteDb:'linked'` | **net-new** |

Block-level detail inside `notes-editor`: H3+paragraph 317–318, checkbox blocks
320–337 (gutter controls 321–324), callout 339–342, bullet list 344–345, blockquote
347, table block 349–351, code block 353–354.

> The five `notes-db-*` screens are a whole feature (databases embedded in notes) that
> does not exist in the app. They are scoped as Phase 4 follow-on work, not Phase 3
> fidelity — see `04-FEATURES.md`.

## Group: Databases (16) → T3.17–T3.32

| id | Label | Showcase lines | App file |
|---|---|---|---|
| `db-table` | Table | **613–749** (toolbar 601–612, header 618–624, body 627–644, calc footer 645) | `pages/DatabasesPage.tsx`, `databases/RecordTable.tsx` |
| `db-board` | Board | **750–762** | `databases/RecordBoard.tsx` |
| `db-colmenu` | Property menu | **651–694** (items 655–663) | `RecordTable.tsx:378` `FieldHeader` |
| `db-type` | Change property type | **665–672** | `RecordTable.tsx` type submenu |
| `db-options` | Edit select options | **681–693** (`role="dialog" aria-label="Edit options"`) | `fields/FieldsManager.tsx` |
| `db-newprop` | New property | **696–705** | `fields/FieldsManager.tsx` |
| `db-props` | Show / hide properties | **707–715** | `DatabasesPage.tsx:975` `PropertiesButton` |
| `db-sort` | Sort | **716–726** | `DatabasesPage.tsx:896` `SortButton` |
| `db-filter` | Filter | **727–738** | `DatabasesPage.tsx:863` `FilterButton` |
| `db-picker` | Pick a status | **739–748** (`role="listbox"`) | `RecordTable.tsx` `FieldCell` |
| `db-peek` | Open record | **765–784** — `<aside role="dialog"> position:fixed;top:0;right:0;bottom:0;width:min(520px,100vw)`, header 767, props 770–780 | **net-new** — `grep -ri peek web/src` is empty |
| `db-freeze` | Freeze first column | 613–749 with `freeze:'title'` | `RecordTable.tsx` frozen column |
| `db-group` | Group by status + totals | 627–645 with `groupBy` + `calc` | `RecordTable.tsx` grouping + calc footer |
| `db-new` | New database | **1124–1131** — `top:230px;left:232px;width:280px` | `DatabasesPage.tsx:1130` `NewDatabaseButton` |
| `db-empty` | No databases | **593–595** (`no_data.png`) | `DatabasesPage.tsx:1015` `EmptyNote` |
| `db-offline` | Needs the server | **596–598** (`error_state.png`) | `DatabasesPage.tsx:1015` `EmptyNote` |

Every popover in this group is preceded by its own transparent click-catcher div
(lines 652, 697, 708, 717, 728, 740, 764). The same ten-popover family is duplicated
inside the Notes inline database at lines 409–506 — identical structure, identical
order. Build once, use twice.

## Group: Calendar (3) → T3.37–T3.39

| id | Label | Showcase lines | App file |
|---|---|---|---|
| `cal-month` | Month | **794–825** (toolbar 796–801, grid 802–816, legend 818–823) | `pages/CalendarPage.tsx`, `calendar/UnifiedCalendar.tsx` |
| `cal-add` | Add on a day | **1114–1122** — `top:300px;left:50%;margin-left:-100px;width:300px`, radiogroup 1119 | `CalendarPage.tsx:251` `AddOnDayDialog` |
| `cal-offline` | Needs the server | **791–793** (`error_state.png`) | `CalendarPage.tsx` |

## Group: Shell overlays (3) → T3.40–T3.42

| id | Label | Showcase lines | App file |
|---|---|---|---|
| `sh-notif` | Notifications | **1099–1103** — `top:48px;right:56px;width:360px` | `components/NotificationBell.tsx` |
| `sh-account` | Account menu | **1108–1111** — `role="menu"`, `top:48px;right:12px;width:272px` | `components/shell/UserMenu.tsx` |
| — | Sidebar page menu | **1136–1144** — `position:fixed`, `width:280px`, items 1138–1141, footer meta 1143 | `ListSidebar.tsx`, `SavedViewsSection.tsx` row menus |

Also global: **toast** at line 1146 (`role="status"`, `position:fixed;left:50%;bottom:24px`)
→ `components/ui/sonner.tsx` / `NotificationToast.tsx`.

## Group: Automations (2) → Phase 4, T4.4

| id | Label | Showcase lines | App file |
|---|---|---|---|
| `auto-list` | Rules & runs | **876–899** (status banner 876–879, rules 880–895, runs 896–899) | `pages/AutomationsPage.tsx` (orphaned — revive) |
| `auto-form` | Rule form | **989–1013** | `components/automations/AutomationRuleForm.tsx` |

## Group: Shell — Library (1) → Phase 4, T4.1

| id | Label | Showcase lines | App file |
|---|---|---|---|
| `library` | Library (Recents · View all) | **831–869** (header 831–839, body 841–861, New-page menu 864–869) | **net-new** |

Sidebar's Favorites/Recents sections are built in the prototype's JS at lines
1336–1352 (`favRows`, `recRows`, and a "View all" row).

## Group: Sign in (2) → out of scope

| id | Label | Showcase lines | Notes |
|---|---|---|---|
| `login` | Sign in | **909–937** | A ready-made patch exists at `~/Documents/newHitlistDesign/project/repo-patch/`. Separate `.login-organic` theme, separate decision. |
| `login-error` | Sign in · wrong password | 909–937 with `variant:'error'` | ditto |

---

## Design-system components → app equivalents

The prototype uses only 15 DS components (243 `x-import` calls). Everything else —
the data grid, board lanes, calendar grid, note blocks, all popovers, all drawers — is
hand-rolled `div`/`section`/`aside` with inline styles, and must be reproduced
structurally rather than mapped to a component.

| DS component | Uses | App equivalent |
|---|---|---|
| `Icon` | 82 | `lucide-react` |
| `Button` | 51 | `components/ui/button.tsx` + `TopBar.tsx` class consts |
| `IconButton` | 35 | no dedicated primitive — recurring inline pattern; **consider extracting** (T2.4) |
| `Input` | 16 | `components/ui/input.tsx` |
| `Select` | 15 | `components/ui/select.tsx` |
| `Checkbox` | 9 | inline; `ui/status-box.tsx` for task status |
| `Badge` | 9 | `components/ui/badge.tsx` |
| `Tag` | 8 | `fields/FieldChips.tsx`, inline chips |
| `EmptyState` | 7 | `components/EmptyState.tsx` (rebuilt in T1.10) |
| `Dialog` | 5 | `components/ui/dialog.tsx` |
| `Switch` | 4 | `components/ui/switch.tsx` |
| `Textarea` | 2 | `components/ui/textarea.tsx` |
| `Table` | 2 | `RecordTable.tsx` / `TaskTableView.tsx` (custom, not `ui/table.tsx`) |
| `Tabs` | 1 | `TopBar.tsx` `TopBarToggle` |
| `Card` | 1 | `components/ui/card.tsx` (currently unreferenced) |
