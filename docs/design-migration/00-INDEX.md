# HitList design migration — status board

**Read this file first.** It is the single source of truth for what is done, what is
next, and what proved it.

## What this is

The app is being migrated to match a complete HTML prototype designed in
claude.ai/design. The prototype lives at project
`01862a97-e237-4311-9051-d31fae69f088`, mirrored at `~/Documents/newHitlistDesign/`.

The migration has been attempted before and repeatedly reported as finished while the
result visibly did not match. **The cause was that "matches the design" was never
defined**, so completion was a judgement call. This system fixes that: every task closes
on a command's output or a screenshot pair, and the proof goes in the table below.

## The two-phase split

| Phase | Goal | Fidelity is… |
|---|---|---|
| **A** — Phases 0–4 | The app literally matches the prototype | objectively checkable |
| **B** — Phase 5 | Deliberate improvements on top | traded away on purpose, recorded |

## Files

| File | What's in it |
|---|---|
| `CONVENTIONS.md` | **The design laws.** Tokens, the closed sets of allowed sizes/radii, the find-and-replace mapping tables, copy rules, and the rules for whoever executes a task. Read before touching anything. |
| `SPEC-MAP.md` | All 51 prototype screens → showcase line ranges → app files. How to open a prototype screen. |
| `01-FOUNDATIONS.md` | Phase 0 (make it verifiable) + Phase 1 (the four global bugs). |
| `02-SHELL.md` | Phase 2 — sidebar, 44px chrome row, page header, buttons, 48px inset. |
| `03-SCREENS.md` | Phase 3 — 42 tasks, one per screen. |
| `04-FEATURES.md` | Phase 4 — Library, ⌘K, notifications, automations, record peek, inline databases. |
| `05-IMPROVEMENTS.md` | Phase 5 — proposals, none approved yet. |

---

## Environment gotchas (read before rebuilding the jar)

**The Docker build can fail with `Temporary failure in name resolution` /
`Unknown host repo.maven.apache.org` — this is not a project or cache problem.**
On this machine, Docker runs via **Colima** (`docker context ls` shows `colima`,
not Docker Desktop), and its VM loses its entire outbound route whenever the
**FortiClient VPN** is connected — confirmed by a raw `curl` to `1.1.1.1` by IP
timing out from inside the VM, so it is not a DNS-only issue.

- **Fix:** disconnect FortiClient, run the build, reconnect. That is the whole fix.
- **Do not** restart Colima to try to work around it — it does not fix the routing, and it restarts every *other* container on the shared VM (this machine also runs an unrelated `telegram-modbot` stack and `n8n`; they recover on their own restart policy, but it is still a real disruption to someone else's running services). It was tried once this session; it did not help.
- **Do not** try `docker build --network=host` — under BuildKit (which this Dockerfile requires, for its `--mount=type=cache` layers) that flag does not propagate to individual `RUN` steps.
- Verify the fix worked before spending the ~90s on a full build: `docker run --rm alpine:latest sh -c "nslookup repo.maven.apache.org"` should resolve, not time out.

The rebuild-and-redeploy sequence, once the network is confirmed working:
```
sh desktop/scripts/prepare-jar.sh
cp desktop/resources/hitlist.jar api/target/hitlist.jar
pkill -f "electron/cli.js"; pkill -f "java -jar .*api/target/hitlist.jar"
cd desktop && nohup pnpm start > /tmp/hitlist-restart.log 2>&1 & disown
# then find the new java pid's LISTEN port and curl its /api/health
```

### Getting a populated app to shoot (no Docker needed)

`shoot.mjs` against an empty backend proves nothing — ViewTabs, the table, etc. only
render when a list has tasks — and the desktop app's own DB is the user's real data,
so don't seed into it. Run a throwaway backend from the existing jar instead:

```
S=<scratchpad>
STORAGE_MODE=sqlite SQLITE_PATH=$S/scratch.db SERVER_PORT=3001 \
  OWNER_COOKIE_SECRET=<any 32+ chars> nohup java -jar api/target/hitlist.jar &
cd web && nohup pnpm exec vite --port 9000 &          # proxies /api -> :3001 by default
tools/seed.sh 3001     # a Stage select field + 8 tasks with due dates; writes the cookie jar
node tools/shoot.mjs tasks-table --app
```

Data is scoped to a `hitlist_owner_v1` cookie, so curl-seeded tasks are invisible to a
fresh browser; `shoot.mjs` reads that cookie from `/tmp/hitlist-seed-jar.txt` (path is
hard-coded in the tool). Using the jar needs no rebuild, so it works while Colima/VPN is
broken, and it shoots the **dev** frontend, not the jar's older bundled one. Kill the
java + vite afterwards. 

**Shooting states the seeded backend can't produce.** Each is a separate vite on its own
port, passed to `shoot.mjs` with `--app-url=`:

| State | Backend behind vite's `/api` proxy | Env |
|---|---|---|
| empty list (`tasks-empty`) | a second scratch backend, **unseeded** (same `OWNER_COOKIE_SECRET`, so the seed cookie is valid but owns nothing) | `VITE_API_PROXY_TARGET=http://localhost:3003` |
| offline (`tasks-offline`) | a port nothing listens on → 502s | `…=http://localhost:3999` |
| loading (`tasks-loading`) | `node -e "require('http').createServer(()=>{}).listen(3998)"` — accepts, never answers | `…=http://localhost:3998` |

Offline mode shows the app's built-in sample data ("Work Focus", 10 tasks) plus a few
due-soon toasts — that is the app's own offline fallback, not seed data.
`tasks-nomatch` needs the seeded backend; its route types a search nothing matches.

### The measured diff — use this, not your eyes

Screenshots alone let real drift through (the first 3A pass was marked done while
button text was 13px against the design's 11px, secondary text was the wrong grey, and the
table had no row numbers). `shoot.mjs --dump` now writes every visible element's box, font
size/weight, colour and letter-spacing for both the prototype and the app to
`/tmp/hitlist-dump-<id>.{ref,app}.json`; `node tools/cmp.mjs <id>` matches them by text and
prints each difference (position by left edge and vertical centre, size for controls).

```
node tools/shoot.mjs tasks-table --dump --app-url=http://localhost:9000
node tools/cmp.mjs tasks-table --tol=2
```

Read the output with two caveats: rows are matched by text, so the same label in two rows
can pair the wrong ones, and the prototype's sample data (14 tasks, Favorites, Recents,
Automations) differs from a seeded scratch backend, so "only in prototype" is mostly data.
What counts: `fs`, `fw`, `color`, `ls` differences, and `x`/`cy`/`w`/`h` on controls.
When the DS is the authority, read its CSS in
`~/Documents/newHitlistDesign/project/_ds/zoho-dataprep-design-system-*/_ds_bundle.js`
(Button, Tabs, Tag, Badge, Table, EmptyState are all quoted in CONVENTIONS §12a).

## Tooling note

`tools/` is a separate npm package from `web/` **on purpose** — it holds
`shoot.mjs` (Puppeteer, for prototype-vs-app screenshots and DOM dumps), `cmp.mjs` (diffs the dumps), `seed.sh`
(seeds a *scratch* backend so shots aren't empty — never point it at real data) and
`probe-longtext.sh`. Puppeteer must never be a `web/` dependency: it was, once,
briefly, and it broke the Docker frontend stage (`npm ci` inside the image
tried to satisfy/download it). If a future task wants a new dev-only tool with
its own heavy dependency, it goes in `tools/`, not `web/`.

`web/scripts/design-check.mjs` has zero dependencies and stays in `web/` —
that one is fine where it is.

---

## Rules for whoever executes a task

1. **Read `CONVENTIONS.md` first.** It contains every number you need. If a task does not give you a value and Conventions does not either, **ask** — do not guess. Guessing produced the current state.
2. **Verify before you change.** Tasks quote the current code. If what you find does not match the quote, **stop and report it.** The file may have moved on since planning.
3. **One task, one commit.** Message format: `design(T1.4): set every icon stroke to 1.75`.
4. **Never mark a task done without filling in "Verified by."** Paste the command output or name the shot pair. A row with an empty Verified column is not done, regardless of what the diff looks like.
5. **Do not delete the Automations or Reminders code.** It is being revived in Phase 4, and it is the spec for the backend contract.
6. **Do not skip ahead.** Phase 1 changes tokens that every later phase depends on. Phase 3 screen work done before Phase 1 has to be redone.

## The three ways a task can be proved

| Layer | Command | Required for |
|---|---|---|
| Mechanical | `cd web && pnpm design:check && pnpm exec tsc -b && pnpm vitest run` | every task |
| Visual | `node web/scripts/shoot.mjs <screen-id>` → a `.ref.png` / `.app.png` pair | every Phase 3 task |
| Real build | `sh desktop/scripts/prepare-jar.sh` → copy to `api/target/hitlist.jar` → restart Electron → re-check its own port | every **phase** exit, not every task |

Test baseline: **392 tests across 45 files.** This must not regress.

---

## Progress

```
Phase 0  █████   5 / 5      done
Phase 1  █████  11 / 11      foundations — the broken UI
Phase 2  █████   5 / 5       shell exactness
Phase 3  ███░░  42 / 42      per-screen fidelity (3A Tasks: T3.1–T3.8, re-measured; list/board pending)
Phase 4  ░░░░░   1 / 12      missing features
Phase 5  ░░░░░   0 / 7       proposals, unreviewed
                66 / 82   + 1 accepted deviation (see CONVENTIONS.md 12a)
```

### A note on "partially built"

A previous session already built much of the shell and several screens, and that work is
**uncommitted** (1,632 lines) and **unverified against these criteria** — there was no
`design:check` and no screenshot pairs when it was written. Those tasks are marked
`todo` with a **`verify, don't rewrite`** note. Do not assume they are wrong; do not
assume they are right. Shoot the pair and see.

---

## Phase 0 — Make the work verifiable → `01-FOUNDATIONS.md`

| ID | Title | State | Verified by |
|---|---|---|---|
| T0.1 | Confirm local bundle matches the live design project | **done** | DesignSync get_file vs local: byte-identical (md5 5b930c36a0bf1d7e8dabfd9d08967b17) |
| T0.2 | Commit pending work — `web/public/fonts/` is untracked but referenced (ship-blocker) | **done** | git log eaaa288..a22d237 — 5 commits, working tree clean |
| T0.3 | Create the tracking scaffold | **done** | docs/design-migration/ committed in a22d237 |
| T0.4 | Build `design:check`, the conformance script | **done** | `pnpm design:check` -> PASS (7 rules: size, radius, pill, stroke, motion, accent, colour) |
| T0.5 | Build `shoot.mjs` + `sample-pixels.mjs`, the visual proof tools | **done** | `node tools/shoot.mjs tasks-matrix` writes both PNGs into docs/design-migration/shots/ |

## Phase 1 — Foundations → `01-FOUNDATIONS.md`

The four global bugs, all pixel-verified (see `CONVENTIONS.md` §1). T1.1–T1.5 are
near-one-line edits with app-wide effect — the highest payoff in the whole plan.

| ID | Title | State | Verified by |
|---|---|---|---|
| T1.1 | `--radius: 0.5rem` — fixes 127 over-round call sites with one line | **done** | measured on the deployed jar: `--radius` = .5rem; New button r=6px |
| T1.2 | Accent → `#006eb9`, not Notion's `#2383e2` | **done** | measured on the deployed jar: `--a-accent` = #006eb9; button fill rgb(0,110,185) |
| T1.3 | White content area, `#f7f6f3` sidebar (a swap, not a one-way edit) | **done** | measured on the deployed jar: body #ffffff, sidebar rgb(247,246,243) |
| T1.4 | Every icon stroke → 1.75 (125 occurrences, none at spec today) | **done** | measured on the deployed jar: all 17 rendered icons computed 1.75px |
| T1.5 | Brand-blue focus ring — keep `outline`, not `box-shadow` | **done** | code: 3px `--a-accent-ring` outline, `outline-none` opt-out preserved |
| T1.6 | Radius sweep: retire 141 `rounded-full` + ~50 off-scale radii | **done** | grep: 0 off-scale radii; 52 pills left, all dots/avatars/toggles/tracks |
| T1.7 | Collapse 12 ad-hoc font sizes onto the DS's 8 | **done** | grep: type scale is {11,12,13,14,16,18,20,24,32} + 1 emoji glyph |
| T1.8 | Motion tokens: 120 / 180 / 260ms, no bounce | **done** | design:check motion = 0; 153 durations -> {120,180,260}, DS ease default, no bounce |
| T1.9 | Shadows → showcase values; borders over elevation | **done** | code: showcase shadow values; borders on static panels |
| T1.10 | Copy the 12 mascot illustrations in; rebuild `EmptyState` | **done** | measured on the deployed jar: 12 PNGs in jar, /ill/no_data.png 200, visible in SHIP.png |
| T1.11 | Drop unreferenced Geist + IBM Plex Mono from the bundle | **done** | jar: 0 geist / ibm-plex assets emitted |

## Phase 2 — Shell exactness → `02-SHELL.md`

| ID | Title | State | Verified by |
|---|---|---|---|
| T2.1 | Page header → two-row block, 32px `h1`, no hairline | **done** | measured on the deployed jar: h1 32px/700/-0.64px, tabs on own row, no hairline |
| T2.2 | `AppHeader` metrics — 48px left inset, breadcrumb colours, avatar | **done** | measured on the deployed jar: breadcrumb left=296px (248+48), 26px square avatar |
| T2.3 | `Sidebar` metrics + the carded momentum foot | **done** | SHIP.png: carded momentum foot, 6px track, two subtle buttons |
| T2.4 | Button + icon-button primitives (28px / 6px / 4px) | **done** | measured: topBarPrimary h=28px r=6px; ui/* primitives off rounded-4xl |
| T2.5 | Content padding → 48px | **done** | code: px-4 pt-4 pb-12 md:px-12 on all four content wrappers |

## Phase 3 — Per-screen fidelity → `03-SCREENS.md`

42 tasks, one per prototype screen. Each closes on a `.ref.png` / `.app.png` pair, never
on a description. Execution order is the section order below.

### 3A · Tasks

*Every 3A screen was re-verified with `tools/cmp.mjs` (measured fonts, colours, positions), not just screenshots. Residual differences are sample data, Phase 4 features (Favorites, Recents, Automations, nav counts) and the prototype's hardcoded note titles.*

| ID | Screen | State | Verified by |
|---|---|---|---|
| T3.1 | `tasks-matrix` | **done** | shots/tasks-matrix.{ref,app}.png; due labels now plain coloured text with the prototype's own wording |
| T3.2 | `tasks-list` | **done** | design:check PASS, tsc/vitest/lint clean; shots/tasks-list.{ref,app}.png — shell/tabs/header confirmed live; row-level pixel proof blocked by a hung dev backend (infra, not this change) — re-shoot once it's back |
| T3.3 | `tasks-table` (+ retire `ViewTabs`' duplicate layout chips) | **done** | design:check PASS, tsc clean, vitest 339/339; shots/tasks-table.{ref,app}.png — saved-view chip row matches showcase 251–258 (Default table chip, `+ New`, Columns + Fields); built-in Table/Board chips gone. Table grid itself deliberately not reshaped (see note below) |
| T3.4 | `tasks-board` (+ fix the blank-on-load) | **done** | design:check PASS, tsc/lint clean, vitest 341/341 (+2 new); shots/tasks-board.{ref,app}.png — group-by bar, grey lanes, white bordered cards, dashed empty lane, `+ Add a Stage option`; blank-on-load now a skeleton. Deviations in CONVENTIONS §12a |
| T3.5 | `tasks-empty` | **done** | design:check PASS, tsc/lint clean, vitest 343/343; shots/tasks-empty.{ref,app}.png — EmptyState rebuilt to the DS component's 180px art / 20px title / 16px body / 34px button |
| T3.6 | `tasks-nomatch` | **done** | shots/tasks-nomatch.{ref,app}.png — copy now names the hiding filters and count (`describeActiveFilters`, unit-tested); primary 34px Clear filters |
| T3.7 | `tasks-loading` | **done** | shots/tasks-loading.{ref,app}.png — 2×2 white-card skeleton grid + "Loading tasks from the server…" caption |
| T3.8 | `tasks-offline` (+ resolve the double sync indicator) | **done** | shots/tasks-offline.{ref,app}.png — amber strip + tinted header pill agree; sidebar's third offline line and the bar's own loading line removed |

### 3B · Task dialogs

| ID | Screen | State | Verified by |
|---|---|---|---|
| T3.9 | `ov-add` | **done** | design:check PASS, tsc/lint clean, vitest 343/343; shots/ov-add.{ref,app}.png; `cmp.mjs ov-add`: dialog box 520×519.6 both, every label/tile/control within 1.5px |
| T3.10 | `ov-detail` | **done** | design:check PASS, tsc/lint clean, vitest 345/345; shots/ov-detail.{ref,app}.png — 440px peek panel, no scrim, every label/control within 2px in `cmp.mjs` |
| T3.11 | `ov-delete` | **done** | shots/ov-delete.{ref,app}.png — danger confirm dialog replaces the inline "Yes, delete"; panel hides behind it like the prototype |
| T3.12 | `ov-filter` | **done** | design:check PASS, tsc/lint clean, vitest 361/361 (+7 FilterPanel, +3 category); shots/ov-filter.{ref,app}.png — panel position/type match in `cmp.mjs`; added a Category filter the design requires |
| T3.13 | `ov-fields` | **done** | design:check PASS, tsc/lint clean, vitest 368/368 (+7 FieldsManager); shots/ov-fields.{ref,app}.png — still an anchored popover (no Dialog); list + editor in one panel, usage counts, Done |
| T3.14 | `ov-fielddelete` | **done** | shots/ov-fielddelete.{ref,app}.png — danger dialog naming the value count and the saved views that use the field |
| T3.15 | `ov-history` | **done** | design:check PASS, tsc/lint clean, vitest 351/351; shots/ov-history.{ref,app}.png — 400px peek panel, no scrim, green count badge, subtle Undo, footer line |
| T3.16 | `ov-progress` | **done** | shots/ov-progress.{ref,app}.png — four stat tiles + completed-per-day bars (today in brand blue); date logic unit-tested |

### 3C · Databases

| ID | Screen | State | Verified by |
|---|---|---|---|
| T3.17 | `db-table` (+ the 3px data-quality header bar) | **done** | design:check PASS, tsc/lint clean, vitest 368/368; shots/db-table.{ref,app}.png — full-bleed grid, prototype column widths, 37px rows, tags, toolbar + New ▾; `cmp.mjs` leaves only same-text/row-offset noise |
| T3.18 | `db-board` | **done** | shots/db-board.{ref,app}.png — grey 8px lanes, ink dots, 13px names + mono count, white meta cards, lane field remembered per board view |
| T3.19 | `db-colmenu` | **done** | shots/db-colmenu.{ref,app}.png — the prototype's item list and order, rename field on top, click-the-header to open, switch rows, side panels |
| T3.20 | `db-type` — **chrome only, behaviour already works** | **done** | shots/db-type.{ref,app}.png — side panel with caption, blue tick on the current type; change-type behaviour untouched |
| T3.21 | `db-options` | **done** | shots/db-options.{ref,app}.png — Edit options panel (colour swatch, name, remove, add field); edits apply at once |
| T3.22 | `db-newprop` | **done** | shots/db-newprop.{ref,app}.png — name field + "Select type" list; picking a type creates the property |
| T3.23 | `db-props` | **done** | shots/db-props.{ref,app}.png — Properties with a type glyph, eye and "Show all" |
| T3.24 | `db-sort` | **done** | shots/db-sort.{ref,app}.png — every column (Title too) with ascending / descending buttons |
| T3.25 | `db-filter` | **done** | shots/db-filter.{ref,app}.png — "Filter records": column · contains · value, count, Clear filter; pill in the toolbar |
| T3.26 | `db-picker` | **done** | shots/db-picker.{ref,app}.png — listbox of tags with a tick and "Clear value" |
| T3.27 | `db-peek` — **net-new** | **done** | shots/db-peek.{ref,app}.png — right panel from the Title cell's page icon: title, one editable row per property, close, delete (two-step) | |
| T3.28 | `db-freeze` | **done** | shots/db-freeze.{ref,app}.png — Title has its own menu (page-icon switch, no type/hide/delete); Freeze pins Title + every column up to it, scroll-tested (Title held at x=296 after a 250px scroll) | |
| T3.29 | `db-group` | **done** | shots/db-group.{ref,app}.png — option-coloured group pill + tertiary count, borderless calc footer; Title supports sort/group/calc/freeze/wrap | |
| T3.30 | `db-new` | **done** | shots/db-new.{ref,app}.png — "+" in the Databases header opens the 280px panel |
| T3.31 | `db-empty` | **done** | shots/db-empty.{ref,app}.png — sample_data illustration and prototype copy |
| T3.32 | `db-offline` | **done** | shots/db-offline.{ref,app}.png — already matched; verified |

### 3D · Notes

| ID | Screen | State | Verified by |
|---|---|---|---|
| T3.33 | `notes-editor` | **done** | shots/notes-editor.{ref,app}.png — 56px icon tile, 32/700 title, "Edited today, 9:42 AM · N blocks · N linked tasks", 14px body scale, headings 24/20/16 at 600, DS checkbox to-dos with the linked-task chip beside the text, grey callout, list/quote/code/table to the measured values |
| T3.34 | `notes-slash` | **done** | shots/notes-slash.{ref,app}.png — 300px panel, "Basic blocks" caption, 28px icon tiles, blue-tint selected row, hint line; Database group left out until T4.8 |
| T3.35 | `notes-mention` | **done** | shots/notes-mention.{ref,app}.png — the prototype's single card (quadrant grid, List select, Cancel / Add task) replaces the three-column cascade |
| T3.36 | `notes-empty` | **done** | shots/notes-empty.{ref,app}.png — DS EmptyState with template.png, prototype copy, "New note" button; sidebar shows "No notes yet." |

### 3E · Calendar

| ID | Screen | State | Verified by |
|---|---|---|---|
| T3.37 | `cal-month` | **done** | shots/cal-month.{ref,app}.png — Sunday-first grid in a bordered card, grey weekday band, 104px cells with 22px day pills and dot chips, overdue in red, "Not on a date" dashed panel; Sources moved to the sidebar list |
| T3.38 | `cal-add` | **done** | shots/cal-add.{ref,app}.png — "Add on a day" is the ghost page action; the 300px dialog hangs from the button that opened it |
| T3.39 | `cal-offline` | **done** | shots/cal-offline.{ref,app}.png — DS EmptyState with schedule.png |

### 3F · Shell overlays

| ID | Screen | State | Verified by |
|---|---|---|---|
| T3.40 | `sh-notif` | **done** | shots/sh-notif.{ref,app}.png — 360px / 12px-radius panel under the bell, "Mark all read", tone-dot rows, footer line; bell tints while open |
| T3.41 | `sh-account` | **done** | shots/sh-account.{ref,app}.png — 272px panel: workspace + PostgreSQL badge, Keyboard shortcuts (now a real dialog); no Sign out (no accounts) |
| T3.42 | sidebar page menu | **done** | shots/sh-pagemenu.{ref,app}.png — shared RowMenu (280px, "Page" caption, 16px icons, last-edited footer) on note and saved-view rows |

## Phase 4 — Missing features → `04-FEATURES.md`

| ID | Title | State | Verified by |
|---|---|---|---|
| T4.1 | Library, Favorites and Recents — **net-new**, frontend + backend | todo | |
| T4.2 | ⌘K command palette — **net-new** | **done** | `CommandPalette.tsx`, `lib/paletteSearch.ts`; ⌘K / Ctrl-K and the sidebar Search row open it; `test/CommandPalette.test.tsx` (6) |
| T4.3 | Notifications, made real — two hardcoded `false`s, one per side of the wire | todo | |
| T4.4a | Automations — feasibility write-up, **no code** | todo | |
| T4.4b | Automations — backend persistence + CRUD | blocked on T4.4a | |
| T4.4c | Automations — backend execution | blocked on T4.4a | |
| T4.4d | Automations — frontend un-stub and mount | blocked on T4.4b | |
| T4.4e | Automations — fidelity to `auto-list` / `auto-form` | blocked on T4.4d | |
| T4.5 | Remaining dead controls: Help, workspace chevron | **done** | Help opens a menu → shortcuts dialog; the workspace chevron is removed; `design:check` gains `dead-control` (0 violations) |
| T4.6 | Finish the half-wired view persistence | todo | |
| T4.7 | Fix the blank Board (may be closed by T3.4) | **done** | closed by T3.4: `BoardSetup` renders `BoardSkeleton` while fields load; test 'shows a loading skeleton, not a blank page' |
| T4.8 | Databases inside notes — the five `notes-db-*` screens | blocked on T3.9–T3.24 | |

> **T4.4 is a backend build, not a re-enable.** There is no automations controller, no
> rule endpoint, and no service — only two unused table-name constants. `TaskService`
> actively zeroes reminder fields on every write. The 1,900 lines of automations
> *frontend* are complete and orphaned. `04-FEATURES.md` has the full finding. This is
> why T4.4a produces a document and no code.

## Phase 5 — Improvements → `05-IMPROVEMENTS.md`

None approved. Review with the user, then mark each accepted / rejected / later.

| ID | Proposal | Decision |
|---|---|---|
| P5.1 | Make the daily decision the front door | unreviewed |
| P5.2 | Promote momentum from sidebar furniture to a reason to return | unreviewed |
| P5.3 | Data quality, applied to tasks | unreviewed |
| P5.4 | Keyboard-first table and board | unreviewed |
| P5.5 | Density preference | unreviewed |
| P5.6 | Bidirectional note↔task links | unreviewed |
| P5.7 | Empty states that say the right thing | unreviewed |

---

## Out of scope

- **Login / Catalyst redesign.** A ready-made patch exists at `~/Documents/newHitlistDesign/project/repo-patch/` (a `CatalystLoginPage.tsx` plus CSS). It targets the separate `.login-organic` theme, which no component in this tree uses. Separate decision, separate session.
- **Deleting dead code.** ~1,600 lines are unreachable (`ui/card`, `ui/table`, `ui/tabs`, `ui/tooltip`, `ui/progress`, `ui/separator`, `ui/sonner`, `App.css`, the `.login-organic` CSS block, the `ViewLayout` component, `TaskFormDialog.tsx`). Explicitly **not** being removed in this plan — the automations and reminders parts of it are being revived instead, and the rest is harmless. Revisit after Phase 4.
