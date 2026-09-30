# Phase 4 — Features the design specifies but the app does not have

Read `CONVENTIONS.md` and `SPEC-MAP.md` first. Phases 1–3 should be complete; these
tasks add capability rather than fidelity, so they assume the shell and screens already
match.

**These are builds, not restyles.** Unlike Phase 3, several of these do not exist in any
form. Estimate accordingly, and split anything that grows past a day.

---

## T4.1 — Library, Favorites and Recents

**Why** The prototype has a whole `library` screen plus **Favorites** and **Recents**
sidebar sections, and your own Notion is the model — `uploads/Screenshot 2026-09-29 at
7.11.37 PM.png` is Notion's Library with Teamspaces / Recents / Favorites / Shared /
Private tabs, and `…6.39.49 PM.png` shows the sidebar with Favorites, Meetings, Recents
and Teamspaces sections. None of this exists in the app.

**Spec**
- Library page — showcase **831–869**: breadcrumb header (833), Recents/View-all `IconButton`s (837–839), filter chips (844), rows (846–859), `libEmpty` state (860), and a `New page` menu (864–869, `role="menu"`, `position:fixed; top:112px; right:48px; width:220px`).
- Sidebar sections — the prototype builds `favRows` and `recRows` at showcase **1336–1352**, appending a `View all` row to Recents. Section shape matches the existing `ctx` sections (56–86).
- Library tab set — showcase **1510**: `recents`, `favorites`, `notes`, `lists`, `databases`, `all` with icons `clock`, `star`, `sticky-note`, `list-checks`, `table-2`, `layers`.
- Row menu items — showcase **1525–1526**: `Add to Favorites` / `Remove from Favorites`, and `Remove from Recents` when the row is in Recents.
- Empty copy, verbatim (showcase 860): *"Nothing here yet. Star a page to see it under Favorites."*

**Build**
1. **Storage.** A favourite is a `(ownerId, pageKind, pageId)` triple; a recent adds a timestamp and is capped. `pageKind` ∈ {list, note, database}. Follow the existing generic-row pattern — `api/src/main/java/com/hitlist/storage/StorageTables.java` plus `JdbcRowStore`, the same way views and fields are stored. No new table type is needed.
2. **API.** `GET/PUT /api/favorites`, `GET/POST /api/recents`. Recents should be written by the existing navigation path, not by every component.
3. **Frontend.** A `library` member on `AppView` (`web/src/components/shell/Sidebar.tsx:7`), a `pages/LibraryPage.tsx`, two new sidebar sections, and the star/unstar row action.

**Accept** Shot pair for `library`. Starring a note moves it into Favorites and it
survives a reload. Opening a database puts it at the top of Recents.

**Verify** `cd web && pnpm design:check && pnpm exec tsc -b && pnpm vitest run`, plus a
new `web/test/LibraryPage.test.tsx`.

---

## T4.2 — The ⌘K command palette

**Why** `web/src/components/shell/Sidebar.tsx:95-102` renders a Search row with a
`Ctrl K` hint **and no `onClick`**. It is focusable, keyboard-reachable, and does
nothing. The codebase argues against exactly this at
`web/src/components/notes/InlineText.tsx:29-30`: *"Offering a Bold button that visibly
does nothing would be the dead-toolbar problem again, so it is not offered."* The
sidebar currently commits that error, and advertises a keybinding on top.

**Spec** The prototype shows the row but does not mock the palette, so there is no
literal spec — this is the one task in Phase A with design latitude. Stay inside
`CONVENTIONS.md`: modal at 12px radius, `--surface-overlay` scrim at 45%, no blur, 180ms
entrance on `--ease-out`, rows at 28px/4px like every other menu row in the product.

**Build** Bind ⌘K / Ctrl-K globally. Search across tasks, notes, databases and lists —
all four datasets are already in memory (`App.tsx` holds tasks and lists, `useNotes`
notes, `useDatabases` databases). Reuse `web/src/lib/taskFilters.ts`'s `search`
handling rather than writing new matching. Group results by kind; Enter opens, ↑/↓
navigates, Esc closes.

**Accept** ⌘K opens from any view; typing filters across all four kinds; Enter
navigates to the result; the sidebar row opens the same palette.

**Verify** `cd web && pnpm exec tsc -b && pnpm vitest run`, plus a new
`web/test/CommandPalette.test.tsx` covering open/filter/select/escape.

---

## T4.3 — Notifications, made real

**Why** Notifications are wired end to end in the frontend —
`web/src/components/NotificationBell.tsx` (265 lines) is mounted in `AppHeader`,
`NotificationToast.tsx` (200 lines) is mounted in `App.tsx`,
`hooks/useInAppNotifications.ts` and `lib/notificationMapping.ts` exist and are tested.
**Two hardcoded `false`s switch the whole thing off**, one on each side of the wire.

**The client side** — `web/src/lib/api.ts:733-741`:
```ts
async get(): Promise<TrialFeatures> {
  await get<{ notifications: boolean; automations: boolean }>('/trial-features');
  return {
    notifications: false,
    automations: false,
    unavailableReason: AUTOMATIONS_UNAVAILABLE_REASON,
  };
}
```
It performs the real request and then **discards the response**.

**The server side** — `api/src/main/java/com/hitlist/web/PlatformController.java:50-54`:
```java
@GetMapping("/api/trial-features")
Map<String, Object> trialFeatures(HttpServletRequest request) {
    owners.owner(request);
    return Map.of("notifications", false, "automations", false);
}
```

**Good news** `GET /notifications` already exists at
`api/src/main/java/com/hitlist/web/WorkspaceController.java:148`, so there is a real
data source behind the bell.

**Build**
1. Server: return `notifications: true`. Leave `automations` false — that is T4.4.
2. Client: return the server's actual answer instead of the literal. Keep `unavailableReason` for whichever flag is still false.
3. Confirm `/notifications` returns what `lib/notificationMapping.ts` expects — `web/test/notificationMapping.test.ts` (149 lines) documents the shape.
4. **Re-wire `web/src/components/RemindersSettingsPanel.tsx`** (329 lines, currently zero importers). It owns the browser notification-permission request flow (lines 182, 230, 318–320) and there is **no other entry point for permission in the app**. Mount it from the account menu (`UserMenu.tsx`) — that is where the prototype puts settings (showcase 1108–1111).
5. `TaskService.java:64-65` and `:174-175` hardcode `ReminderEnabled=false` / `ReminderMinutesBefore=0` on task create and update. Per-task reminders cannot work while those stand. Decide: honour the client's value, or leave reminders to T4.4 and keep notifications limited to in-app.

**Accept** The bell shows real counts. The account menu reaches reminder settings, and
requesting browser permission works. Toasts fire for a due task.

**Verify** `cd web && pnpm exec tsc -b && pnpm vitest run`, plus a manual permission-grant
pass in the desktop app.

---

## T4.4 — Automations — **read this before estimating**

**Why** You asked for automations in the product, and the prototype has two screens for
them (`auto-list`, `auto-form`).

**Feasibility finding — this is a backend build, not a re-enable.** I checked before
writing this task:

- There is **no automations controller and no automations service**. The complete Java file list is: `ApiException`, `ApiExceptionHandler`, `ApiFallbackController`, `EntityRepository`, `HitListApplication`, `HitListProperties`, `JdbcRowStore`, `ListController`, `ListService`, `MigrationController`, `NoteController`, `NoteService`, `OwnerResolver`, `OwnerSessionFilter`, `PlatformController`, `RemoteExportImportService`, `RowStore`, `SimpleRequestFilter`, `StorageConfiguration`, `StorageTables`, `TaskController`, `TaskService`, `Values`, `WebConfiguration`, `WorkspaceController`, `WorkspaceService`. None of them is about rules.
- There is **no rule endpoint**. Every mapping in the tree: `/api/health`, `/api/lists`, `/api/migrations`, `/api/notes`, `/api/setup`, `/api/stats/momentum`, `/api/tasks`, `/api/trial-features`, `/calendar`, `/databases`(+4), `/field-values`, `/fields`, `/notifications`, `/remote-export`, `/today-history`, `/views`.
- The only trace is two **table-name constants** with nothing reading them — `StorageTables.java:10` `RULES = "KaizenAutomationRules"` and `:12` `RUNS = "KaizenAutomationRuns"`.
- `TaskService.java` **actively zeroes** `ReminderEnabled` and `ReminderMinutesBefore` on create (`:64-65`) and update (`:174-175`).
- `RemoteExportImportService.java:331,518` rejects reminder payloads on import.

So the frontend is the *complete* half: `pages/AutomationsPage.tsx` (464 lines),
`components/automations/AutomationList.tsx` (412), `AutomationRuleForm.tsx` (563),
`ReminderStepList.tsx` (149), `hooks/useAutomations.ts` (294),
`hooks/useAutomationRuns.ts` (70), `lib/reminderSteps.ts` (103) with tests. All of it
orphaned because there is no server to talk to.

**Therefore this task splits. Do them in order and stop after T4.4a to re-decide.**

### T4.4a — Feasibility write-up (no code)
Read the frontend's expectations: `hooks/useAutomations.ts`, `types/automation.ts`
(108 lines), and `lib/api.ts:475-509`'s stub signatures — those define the contract the
backend must satisfy. Then write, into this file, what the backend needs: tables,
endpoints, and **how a rule actually fires** (a scheduler? polling? on-write triggers?).
That last question is the real one — a rule engine needs something to run it, and this
is a desktop app whose backend only runs while the app is open.

**Deliverable** a written contract and a recommendation, appended here. **No code.**

### T4.4a — Findings (written 2026-09-30; no code changed)

**1. The design itself draws Automations as unavailable.** `auto-list` (showcase 876–899) opens with an amber
`role="status"` banner — *"Automations are unavailable. Rules and reminders can't run in the PostgreSQL-only
migration, so creating, editing and triggering rules is disabled."* — the rule cards are dimmed (opacity .85) with a
disabled **Run now** and a disabled read-only **Switch**, and Recent runs is the empty state *"No runs yet"*.
`auto-form` (989–1013) is the same: a "New automation rule" dialog whose first row is an amber notice that rules
can't run right now. So "match the design" and "build a rule engine" are different jobs. The prototype only asks for
the first.

**2. The contract the frontend expects** (`types/automation.ts`, `lib/api.ts` 431–510, `hooks/useAutomations.ts`):
`AutomationRule` = id, name, description, optional taskId, triggerType (`due-date` | legacy `overdue` | `recurring`
| `status-change` | `daily-digest`), status (`active` | `paused` | `draft`), urgency, `offsetMinutes[]` (signed minutes
from the due instant, up to 5 steps), optional recurrence {frequency, time, dayOfWeek, dayOfMonth}, three notify
channels (in-app, browser, email), timestamps, `lastTriggeredAt`, `nextTriggerAt`. `AutomationRun` = id, ruleId,
ruleName (copied), triggeredAt, status (`SUCCESS` | `FAILED` | `SKIPPED`), source (`scheduler` | `manual`), detail,
channels. Endpoints implied: list / create / update / delete rules, recent runs, runs for a rule, trigger.

**3. What a backend would take.** Persistence is small: `StorageTables.RULES` and `RUNS` already exist as constants,
so it is two generic-store tables and a controller like `PageMarksController` (about a day, additive, contract-tested).
*Firing* is the real work, and there is a wall in it: the backend only runs while the desktop app is open, so a
rule cannot fire at 09:00 if the app is closed. Options, cheapest first:
   a. **A sweep while the app is open** — a `@Scheduled` job (every 30–60 s) that evaluates rules against tasks and
      writes in-app notifications and run rows; browser notifications go through the client (it already has timers).
      Honest limit: nothing fires while the app is closed; missed firings can be caught up on start ("SKIPPED").
   b. **Client-side evaluation** — the browser evaluates rules from `reminderSteps` and the reminder timers now
      mounted for T4.3; the server only stores rules. Simplest, same limit, no Java scheduler.
   c. **Email** (`notifyEmail`) needs an SMTP configuration the app does not have, so it stays off in either case.
   Recurring / daily-digest / status-change triggers each need their own evaluator; `due-date` with offsets is the
   one that overlaps the reminders that now exist.

**4. Recommendation.** Do **T4.4d/e as a *design* task now** — mount `AutomationsPage`, add `'automations'` to the
sidebar, match `auto-list` / `auto-form` *including* the unavailable banner, disabled Run now / Switch and "No runs
yet" — because that is exactly what the prototype shows and it costs no backend. Treat a working engine (option a or
b) as a separate, later decision: it is a product change, not a fidelity one. Nothing here deletes the existing
automations code, which stays the spec for that later build.

**Decision needed before T4.4b–e:** (A) mirror the prototype — visible but unavailable; (B) build the engine, option a
or b, so rules really fire while the app is open.

### T4.4b — Backend: persistence + CRUD
Rules and runs tables via the existing generic row store, plus an `AutomationController`
matching the stub's signatures. Stop honouring `TaskService`'s reminder zeroing.

### T4.4c — Backend: execution
Whatever T4.4a recommends. Expect this to be the hard part.

### T4.4d — Frontend: un-stub and mount
Replace `automationApi`'s stub bodies with real calls. Add `'automations'` to `AppView`.
Mount `AutomationsPage`. Flip the server's `trial-features` automations flag. Remove the
nine `toast.error(AUTOMATIONS_UNAVAILABLE_REASON)` calls in `AutomationsPage.tsx`.
Update `web/test/Sidebar.test.tsx`, which currently asserts Automations is **absent**.

### T4.4e — Fidelity
Match showcase **876–899** (`auto-list`) and **989–1013** (`auto-form`). Note the
prototype still shows a `role="status"` banner at 876–879 — read it before deciding
whether it applies.

**Do not** delete any of the existing automations code at any point. It is the spec for
the backend contract.

---

## T4.5 — The remaining dead controls

**Why** Three controls render and do nothing. Two are fixed by other tasks (Search by
T4.2, reminders-settings reachability by T4.3). Two remain:

1. `web/src/components/shell/AppHeader.tsx:64-70` — `aria-label="Help"`, no `onClick`.
2. `web/src/components/shell/Sidebar.tsx:85-91` — a `ChevronsUpDown` workspace-switcher affordance inside a **non-interactive `<div>`**. It signals a switcher that does not exist.

**Decide and act, per control:** wire it, or remove it. Do not leave either as-is. The
prototype shows both, but the prototype is a mock — a control that cannot work should
not ship. Suggested: Help opens a small menu (keyboard shortcuts, about, the design
docs); the workspace chevron comes out until multi-workspace exists.

**Accept** Every focusable control in the shell either does something or is gone.
`pnpm design:check` gains a `dead-control` rule: any `aria-label`-bearing `<button>`
with no `onClick` and no `type="submit"` fails.

---

## T4.6 — Finish the half-wired view persistence

**Why** `web/src/lib/api.ts:522-527` added `sort`, `groupField`, `calc`,
`frozenFieldId` and `wrapFieldIds` to `ViewDisplay` — the persistence target exists and
round-trips through the backend's schema-free JSON. But
`web/src/pages/DatabasesPage.tsx:129-134` still wipes all of them on every `openId`
change, and the file's own comment admits it:

```
// The column-menu table controls: hidden/sorted/grouped/calculated/frozen/
// wrapped columns. Ad-hoc per open database for now, same as fieldFilters —
// not yet round-tripped into a saved view's own stored display.
```

**Build** Load the five keys from the active saved view on open; write them through
`persistTableControls` (already exists, `DatabasesPage.tsx:~415`) on change. The type is
ready; only the wiring is missing.

**Accept** Sort a column, freeze it, group by a field, switch database, switch back —
all three survive. Reload the app — they still survive.

**Verify** `cd web && pnpm exec tsc -b && pnpm vitest run`

---

## T4.7 — Fix the blank Board

**Why** `web/src/components/tasks/TaskBoardView.tsx:457` is `if (fieldsLoading) return
null`. The whole board renders nothing — no skeleton, no spinner — while fields load.
This became user-reachable when Board was promoted to a top-level tab.

**Build** Render the `tasks-loading` skeleton (showcase 161–173) instead of `null`.

**Accept** Throttle the network and switch to Board: a skeleton appears, never a blank
page.

**Note** Also listed as part of T3.4. Do it once; mark the other done with a pointer.

---

## T4.8 — Databases inside notes (the five `notes-db-*` screens)

**Why** The prototype dedicates five of its 51 screens to databases embedded in a note —
`notes-db-new`, `notes-db`, `notes-db-menu`, `notes-db-board`, `notes-db-linked`
(showcase 356–542). The app has no inline-database block at all. It is the single
largest missing capability in the design.

**Good news** The prototype's inline database is a **structural duplicate** of the
standalone Databases view — the same ten popovers, the same grid, the same toolbar, in
the same order (compare 409–506 with 651–748). If Phase 3B extracted those into shared
components, this becomes mostly composition.

**Spec** header + toolbar 357–370, table 371–507, board 508–520, record peek 522–541.
Slash-menu entries at showcase 1753: *Create database*, *Create board*, *Linked view of
Reading list*.

**Gate** Do not start until T3.17–T3.32 are done and the popover family is shared. If
they were not extracted, extract them first — building this twice is the failure mode.

**Sequence** new block type in `types/notes.ts` → render in `NoteEditor.tsx` → the three
`SlashMenu` entries (T3.34 deliberately leaves them out until this lands) → linked-view
mode last, since it needs a database picker.

---

# Phase 4 exit gate

1. Every task above is `done` or explicitly `deferred` with a reason in `00-INDEX.md`.
2. No focusable control in the app renders without an action.
3. `cd web && pnpm design:check && pnpm exec tsc -b && pnpm vitest run` — clean and green.
4. Shot pairs exist for `library`, `auto-list`, `auto-form`, `sh-notif`.
5. One rebuild + redeploy, re-verified against the running desktop app.
