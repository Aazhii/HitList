# Phase 0 + Phase 1 — Make it verifiable, then fix the foundations

Read `CONVENTIONS.md` before starting anything in this file.

**Why this phase comes first.** The app does not look like the prototype mainly
because of four global token bugs, not because of per-screen structure. Each fix below
is a small edit with app-wide effect. Doing Phase 3 (per-screen work) before these
would mean re-doing every screen once the tokens change underneath it.

All Phase 1 edits are in `web/src/index.css` unless a task says otherwise.

---

# Phase 0 — Make the work verifiable

## T0.1 — Confirm the local design bundle matches the live project

**Why** Every line number in `SPEC-MAP.md` and `CONVENTIONS.md` points into the local
mirror at `~/Documents/newHitlistDesign/`. If the live design project has moved on, all
of those addresses are wrong. The file *list* was already verified identical via the
`DesignSync` MCP; file *contents* were not.

**Do**
1. `DesignSync` → `method: "get_file"`, `projectId: "01862a97-e237-4311-9051-d31fae69f088"`, `path: "HitList Notion x Zoho.dc.html"`.
2. Write the returned content to a scratch path.
3. `diff <scratch> "/Users/arikaran-25256/Documents/newHitlistDesign/project/HitList Notion x Zoho.dc.html"`.

**Accept** `diff` is empty. If it is not: the **live project wins**. Replace the local
file, then re-derive every line number in `SPEC-MAP.md` before any other task runs.

**Verify** Paste the `diff` exit status into `00-INDEX.md`.

---

## T0.2 — Commit the pending work (ship-blocker inside)

**Why** 1,632 uncommitted lines are in the tree — a whole shell re-architecture
(64px icon rail + per-view context column → one 248px `Sidebar` + 44px `AppHeader`).
More urgently: **`web/public/fonts/` is untracked while `web/src/index.css` already
`@font-face`s those files.** A fresh clone renders with no Zoho Puvi. That is a
production bug hiding in git state, not in code.

**Do**
1. `git -C /Users/arikaran-25256/Documents/HitList status --short` and read it.
2. Stage the font files explicitly: `git add web/public/fonts/`.
3. Stage the rest of the shell rework by name (not `git add -A`).
4. Commit. Suggested message: `feat(shell): one 248px sidebar + 44px header, replacing the icon rail`.

**Do not** commit anything you did not review. **Do not** use `git add -A`.

**Accept** `git status --short` shows no untracked `web/public/fonts/`. `git ls-files web/public/fonts/ | wc -l` returns 8.

**Verify** `cd web && pnpm exec tsc -b && pnpm vitest run` — 335 tests green.

---

## T0.3 — Create the tracking scaffold

**Why** This is the system the whole migration is tracked in.

**Do** The eight files in `docs/design-migration/` already exist as of this planning
pass. Confirm they are all present, then add them to git in one commit:
`docs(design): task-tracked migration plan`.

**Accept** `ls docs/design-migration/` lists: `00-INDEX.md`, `01-FOUNDATIONS.md`,
`02-SHELL.md`, `03-SCREENS.md`, `04-FEATURES.md`, `05-IMPROVEMENTS.md`,
`CONVENTIONS.md`, `SPEC-MAP.md`.

---

## T0.4 — Build `design:check`, the conformance script

**Why** The previous attempt failed because "matches the design" was an opinion. This
turns it into a number that either goes down or does not.

**File** new — `web/scripts/design-check.mjs`. Follow the existing style of
`web/scripts/check-lockfiles.mjs` (plain Node, no deps, non-zero exit on failure).

**Do** Walk `web/src/**/*.{ts,tsx,css}` and report a count per rule. Rules, thresholds
and the rationale for each are in `CONVENTIONS.md` §12. Summary:

| Rule | Fails on |
|---|---|
| `font-size` | `text-[Npx]` where N ∉ {11,13,14,16,18,20,24,32} |
| `radius` | `rounded-[Npx]` where N ∉ {3,4,6,8,12}; any `rounded-2xl`/`3xl`/`4xl` |
| `pill` | `rounded-full` outside the allowlist (tags, toggles, avatars, status dots) |
| `stroke` | `strokeWidth={X}` where X ≠ 1.75 |
| `colour` | hex literal in `web/src/**` outside `index.css` |
| `accent` | any occurrence of `#2383e2` anywhere |
| `motion` | `duration-[N]` where N ∉ {120,180,260} |

Output format — one line per rule so runs are diffable:
```
design:check
  font-size   214 violations
  radius      168 violations
  pill        141 violations
  stroke      125 violations
  colour       37 violations
  accent        4 violations
  motion       96 violations
  ---
  FAIL  785 total
```

Add two flags: `--rule=<name>` to run one rule, and `--list` to print every violation
with `file:line`. Add to `web/package.json` scripts: `"design:check": "node scripts/design-check.mjs"`.

**Accept** The script runs and prints a per-rule table. It is **advisory** now — it will
report hundreds of violations, which is correct. It becomes **blocking** at the Phase 1
exit gate.

**Verify** `cd web && pnpm design:check` exits non-zero and prints the table.

---

## T0.5 — Build `shoot.mjs` and `sample-pixels.mjs`, the visual proof tools

**Why** Every Phase 3 task closes on a prototype-vs-app screenshot pair. That tool must
exist before Phase 3, and the pixel sampler is what settles colour arguments — it is
how the wrong-accent bug was finally proven.

**Files** new — `web/scripts/shoot.mjs`, `web/scripts/sample-pixels.mjs`.

**Do — `shoot.mjs`** Takes a prototype screen id (see `SPEC-MAP.md`) and an app URL.
1. Launch Puppeteer with `args: ['--allow-file-access-from-files']`, viewport 1440×900.
2. **Prototype side:** navigate to the `file://` URL of the showcase; click the "Screens · N/51" pill (showcase 1148–1160); click the target screen's entry. Two required behaviours, both learned the hard way: use a **real** `page.mouse.click()` at the element's `boundingBox()` centre — a DOM `.click()` does not fire the prototype's handlers; and when matching the entry by label, **exclude elements whose `role` is `tab`**, because "Table"/"Board"/"List"/"Matrix" each appear both as a switcher entry and as a live tab.
3. **App side:** navigate to the app, drive it to the equivalent state.
4. Write `docs/design-migration/shots/<screen-id>.ref.png` and `<screen-id>.app.png`.

**Do — `sample-pixels.mjs`** Takes a PNG path plus points or a scanline, and prints hex
values. Chrome cannot read a `file://` image from an `about:blank` page — read the file
in Node and pass it as a `data:image/png;base64,…` URI, then draw to a canvas and
`getImageData`. For solid fills, scan a horizontal line and print the three most common
colours rather than sampling one point, so antialiased edges cannot mislead you.

**Accept** `node web/scripts/shoot.mjs tasks-matrix` produces both PNGs.
`node web/scripts/sample-pixels.mjs docs/design-migration/shots/tasks-matrix.ref.png --scan 122 1322 1390`
reports `#006eb9` as dominant.

---

# Phase 1 — Foundations

## T1.1 — Collapse the radius scale to the design's

**Why** `--radius: 0.875rem` (14px) is declared at `web/src/index.css:219` inside
`:root`, and **`.app-organic` never overrides it**. Tailwind derives its entire radius
scale from that one variable, so `rounded-lg` renders **14px**, `rounded-xl` **19.6px**,
`rounded-2xl` **25.2px**. The design's card radius is **8px**. This single variable is
why every surface in the app reads soft and bubbly next to the prototype.

**Spec** showcase line 26 — `--radius-sm:3px; --radius-md:4px; --radius-lg:6px; --radius-xl:8px`.
DS rule, `CONVENTIONS.md` §4: inputs 4, buttons/chips 6, cards 8, modals 12.

**File** `web/src/index.css`, inside the `.app-organic` block (opens at line 519).

**Current code** — `:root` at line 219:
```css
    --radius: 0.875rem;
```
`.app-organic` defines `--a-radius-sm: 3px` … `--a-radius-xl: 12px` but **those are not
wired to any Tailwind utility** — they are dead tokens. Do not try to wire them; that
would mean touching every call site.

**Change** Add one declaration inside `.app-organic`, next to the existing
`--a-radius-*` block, with a comment explaining the cascade:
```css
  /* Tailwind derives rounded-sm..4xl from --radius. :root sets 14px, which made
     rounded-lg 14px and rounded-xl 19.6px — the design's card radius is 8px.
     0.5rem lands the derived scale on 4.8 / 6.4 / 8 / 11.2px. */
  --radius: 0.5rem;
```

**Affects** 127 existing class usages, with no per-site edits: `rounded-xl` ×76,
`rounded-lg` ×30, `rounded-2xl` ×18, `rounded-md` ×2, `rounded-sm` ×1.

**Accept** `pnpm design:check --rule=radius` count drops. Visually, cards and panels
read 8px, not 14px.

**Verify** `cd web && pnpm exec tsc -b && pnpm vitest run`

**Blocks** T1.6

---

## T1.2 — Set the accent to the real brand blue

**Why** The app uses `#2383e2` (Notion blue). The prototype's accent is **`#006EB9`**
(Zoho DataPrep `--blue-500`). The showcase loads the DS and overrides only neutrals,
radii and shadows (lines 20–30) — it never touches `--blue-*`. A previous session read
this backwards and left a comment in the code asserting the wrong conclusion; that
comment must go with the value.

**Proof** Scanline through the prototype's primary button: `#006eb9` ×38. Through the
app's: `#2383e2` ×44. The prototype's logo mark samples exactly `#006eb9`. See
`CONVENTIONS.md` §1.

**File** `web/src/index.css`, lines 545–550.

**Current code**
```css
  /* Notion blue, replacing the terracotta accent everywhere — including
     focus rings — per explicit instruction to match the redesign exactly. */
  --a-accent: #2383e2;
  --a-accent-600: #1a6bb8;
  --a-accent-700: #145690;
  --a-accent-tint: rgba(35, 131, 226, 0.10);
```

**Change**
```css
  /* Zoho DataPrep brand blue. The showcase loads the DataPrep design system and
     overrides only the greys, radii and shadows (its :root, lines 20–30) — it
     never overrides --blue-*, so the accent stays #006EB9. Verified by sampling
     the prototype's primary button and logo mark, not by reading CSS. */
  --a-accent: #006eb9;
  --a-accent-600: #005c9c;
  --a-accent-700: #004a7f;
  --a-accent-tint: rgba(0, 110, 185, 0.10);
```
Also fix the dark-theme block at `.app-organic.dark` if it carries the Notion blue.

**Accept** `pnpm design:check --rule=accent` reports 0. `grep -rn "2383e2" web/src` is empty.

**Verify** `cd web && pnpm exec tsc -b && pnpm vitest run`, then sample the app's
primary button and confirm `#006eb9`.

---

## T1.3 — White content area, grey sidebar

**Why** `--background`, `--card` and `--popover` all point at `--a-bg` (`#f7f6f3`), so
the content area, every card and every popover render beige. The prototype's `<main>`
is literally `background:#fff` (showcase 107) and `--surface-page` is `#ffffff`
(showcase 24); `#f7f6f3` appears **only** as the sidebar ground (showcase 39) and as
`--surface-sunken`.

**Proof** Prototype content background samples `#ffffff`; sidebar `#f7f6f3`; panel body
`#ffffff`. App content background samples `#f7f6f3`; sidebar `#f1f1ef`.

**File** `web/src/index.css`, the shadcn remap at lines 633–652.

**Current code**
```css
  --background: var(--a-bg);
  --card: var(--a-bg);
  --popover: var(--a-bg);
  --primary-foreground: var(--a-bg);
  --secondary: var(--a-surface);
  --muted: var(--a-surface);
  --accent: var(--a-surface);
  --sidebar: var(--a-surface);
```

**Change** — note this is a **swap**, not a one-way edit. `--a-surface` is already
`#ffffff` and `--a-bg` is `#f7f6f3`; the two are currently used in each other's roles.
```css
  --background: var(--a-surface);        /* white page — showcase 107 */
  --card: var(--a-surface);
  --popover: var(--a-surface);
  --primary-foreground: var(--a-surface);/* white label on the blue button */
  --secondary: var(--a-bg);              /* grey, or it vanishes into the page */
  --muted: var(--a-bg);
  --accent: var(--a-bg);                 /* shadcn's hover wash, not the brand accent */
  --sidebar: var(--a-bg);                /* #f7f6f3 — showcase 39 */
```

**Also** `web/src/components/shell/Sidebar.tsx` uses `bg-a-surface-2` (`#f1f1ef`) for
the sidebar ground — one step too dark. Change to `bg-a-bg` (`#f7f6f3`).

**Trap** Do not simply flip `--background` and leave `--secondary`/`--muted`/`--accent`
at `--a-surface`. All four would then be white, and every secondary button, muted
surface and hover wash would disappear against the page.

**Accept** Sample the app: content `#ffffff`, sidebar `#f7f6f3`, a popover `#ffffff`.

**Verify** `cd web && pnpm exec tsc -b && pnpm vitest run`. Open a dropdown, a dialog
and a sheet and confirm none of them went transparent or invisible.

---

## T1.4 — One icon stroke weight: 1.75

**Why** The DS specifies stroke **1.75** (`_ds/readme.md`, Iconography). The app ships
2.75 (×60), 2.5 (×40), 2.25 (×14), 2 (×8), 3 (×2), 3.4 (×1) — **not one icon at spec**.
This is why every glyph reads heavier and blunter than the prototype.

**Files** all of `web/src/**/*.tsx` — 125 occurrences.

**Change** Every `strokeWidth={N}` → `strokeWidth={1.75}`. Purely mechanical; there is
no case where a different weight is correct.

**Accept** `pnpm design:check --rule=stroke` reports 0.
`grep -rn "strokeWidth={" web/src | grep -v "1.75" | wc -l` returns 0.

**Verify** `cd web && pnpm exec tsc -b && pnpm vitest run`

---

## T1.5 — The brand-blue focus ring

**Why** The DS: *"Focus: always a visible brand-blue ring (`--shadow-focus`, blue at
28% alpha)."* The app draws `outline: 2px solid var(--a-accent)` — a hard 2px line, not
a soft 3px halo.

**File** `web/src/index.css`, lines 726–729.

**Current code**
```css
  .app-organic :focus-visible {
    outline: 2px solid var(--a-accent);
    outline-offset: 2px;
  }
```

**Change**
```css
  .app-organic :focus-visible {
    outline: 3px solid var(--a-accent-tint-strong);
    outline-offset: 0;
  }
```
and add alongside the accent tokens:
```css
  --a-accent-tint-strong: rgba(0, 110, 185, 0.28);   /* DS --shadow-focus alpha */
```

**Why `outline` and not `box-shadow`** The design expresses this as
`box-shadow: 0 0 0 3px rgba(0,110,185,0.28)`, and a 3px solid outline at the same colour
and alpha is visually equivalent. Keep `outline` deliberately: the comment at
`index.css:717-720` explains this rule lives in `@layer base` **so that components can
opt out with `outline-none`** — note editors rely on that. Switching to `box-shadow`
would silently break every one of those opt-outs.

**Accept** Tab through the app: focus rings are a 3px translucent blue halo. Focus a
note block's textarea and confirm it still draws **no** ring.

**Verify** `cd web && pnpm exec tsc -b && pnpm vitest run`

---

## T1.6 — Radius sweep: retire the pills

**Why** After T1.1 the derived scale is right, but 141 `rounded-full` and ~50 off-scale
arbitrary radii remain. The DS allows a pill **only** on tags, toggles, avatars and
status dots. Everything else is 4 / 6 / 8 / 12px. Today the app is pill-first, which
reads as a different product from the prototype.

**Spec** `CONVENTIONS.md` §4, including the full find-and-replace mapping table. Use it
literally; do not judge site by site.

**Files** across `web/src/**`. Highest-density: `TopBar.tsx` (`topBarPill`,
`topBarPrimary`), `tasks/ViewTabs.tsx` (`TAB`), `pages/DatabasesPage.tsx` (icon
buttons, `TAB`), `shell/Sidebar.tsx`, `components/ui/*`.

**Keep pill on** `FieldChips.tsx` chips, quadrant/status dots, `ui/switch.tsx`,
`ui/avatar.tsx`, the sync `Badge` dot, `MomentumBar`'s progress track.

**Accept** `pnpm design:check --rule=radius` and `--rule=pill` both report 0, with the
allowlist covering only the element types above.

**Verify** `cd web && pnpm exec tsc -b && pnpm vitest run`, plus a screenshot of Tasks
and Databases — buttons should read as 6px rectangles, not lozenges.

**Depends on** T1.1

---

## T1.7 — Collapse the type scale

**Why** The app uses 12 distinct sizes including off-grid halves — `text-[10px]` ×53,
`[11px]` ×44, `[13px]` ×43, `[13.5px]` ×43, `[12px]` ×37, `[12.5px]` ×31, `[14px]` ×27,
`[14.5px]` ×17, `[15px]` ×6, `[16px]` ×4, `[11.5px]` ×4, `[19px]` ×3. The DS defines
**eight**. Half-pixel sizes are the clearest signal that type was set by eye.

**Spec** `CONVENTIONS.md` §3, including the exact replacement table. Apply it
mechanically — the table exists so no judgement is needed.

**Files** across `web/src/**`.

**One exception** The page `h1` goes from `text-[22px]` to `text-[32px]`; that is
T2.1's job, not this task's. Leave it.

**Accept** `pnpm design:check --rule=font-size` reports 0.

**Verify** `cd web && pnpm exec tsc -b && pnpm vitest run`. Tests assert on text
content, not size, so this should be inert — if a test breaks, something else changed.

---

## T1.8 — Motion tokens

**Why** The DS: *"Motion: quick and gentle. 120–260ms… **No bounce**."* The app uses
`duration-150` ad hoc (~96 occurrences) and has no easing tokens.

**Files** `web/src/index.css` (add tokens), then `web/src/**` (apply).

**Change** Add to `.app-organic`:
```css
  --a-duration-fast: 120ms;
  --a-duration-base: 180ms;
  --a-duration-slow: 260ms;
  --a-ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
  --a-ease-out: cubic-bezier(0.16, 1, 0.3, 1);   /* entrances */
```
Expose them in the `@theme inline` block (line 99) so `duration-fast` etc. become real
utilities, then replace `duration-150` → `duration-fast` on hovers and colour
transitions, `duration-base` on layout/opacity, `duration-slow` only on drawer slides.

**Also** audit `index.css:3-28` keyframes and `tw-animate-css` usage for anything with
overshoot. There must be no bounce anywhere.

**Accept** `pnpm design:check --rule=motion` reports 0.

**Verify** `cd web && pnpm exec tsc -b && pnpm vitest run`

---

## T1.9 — Shadows: borders over elevation

**Why** The DS leans on 1px borders and reserves shadows for genuinely floating
surfaces. The app's shadow tokens are its own, not the showcase's.

**Spec** showcase lines 27–29, transcribed in `CONVENTIONS.md` §6.

**File** `web/src/index.css` — `--a-shadow-sm` / `--a-shadow-md`, plus any
`shadow-[…]` arbitraries in components.

**Change** Adopt the showcase's five values. Then remove shadows from static panels
(they get `border: 1px solid var(--a-line)` instead) and keep them only on: menus,
popovers, modals, drawers, toasts, and card-hover.

**Accept** No static panel carries a shadow. Menus and dialogs still visibly float.

**Verify** `cd web && pnpm exec tsc -b && pnpm vitest run`

---

## T1.10 — Illustration-backed empty states

**Why** The design pairs all seven of its empty/error states with a line-art mascot
illustration (`EmptyState image="hl/ill/*.png"`). **None of those 12 PNGs are in the
repo.** `web/src/components/EmptyState.tsx` is 30 lines and renders a lucide glyph
instead. This is the single largest visual gap that is not a token.

**Spec** `CONVENTIONS.md` §10 for the file→state mapping. Showcase usages at lines 176,
180, 306, 594, 597, 792, 898.

**Do**
1. Copy all 12 PNGs from `~/Documents/newHitlistDesign/project/hl/ill/` to `web/public/ill/`. Commit them — this is the same trap as T0.2's fonts.
2. Rewrite `web/src/components/EmptyState.tsx` to match the DS `EmptyState`: illustration, then title, then description, then optional action. Props: `image`, `title`, `description`, `action?`.
3. Point the existing states at it: `App.tsx:288` `NoMatchingTasks` → `no_filtered_data.png`; `DatabasesPage.tsx:1015` `EmptyNote` → `no_data.png` for empty and `error_state.png` for offline; `NotesWorkspace.tsx:97` `NotesEmptyState` → `sample_data.png`; `CalendarPage` offline → `error_state.png`.

**Copy** Keep the prototype's own strings — they are already written to the DS's voice.
E.g. showcase 176: *"No tasks in Work yet — Add your first task, or turn a line in a
note into one with @. Tasks land in the Eisenhower quadrant you pick."*

**Accept** All five empty/offline states render an illustration. `ls web/public/ill/ | wc -l` returns 12.

**Verify** `cd web && pnpm exec tsc -b && pnpm vitest run`, then screenshot the Tasks
empty state and the Databases empty state.

---

## T1.11 — Drop the unreferenced webfonts

**Why** `index.css` imports five `@fontsource` packages. **Geist and IBM Plex Mono are
referenced nowhere in the codebase** yet are bundled and emitted — the production build
writes out `geist-*` and `ibm-plex-mono-*` woff2 files for nothing. Caprasimo and
Figtree serve `.login-organic` only, which no component uses either, but Login is out of
scope, so leave those two and note them.

**File** `web/src/index.css`, lines 31–35.

**Current code**
```css
@import "@fontsource-variable/geist";
@import "@fontsource-variable/manrope";
@import "@fontsource/caprasimo";
@import "@fontsource-variable/figtree";
@import "@fontsource/ibm-plex-mono";
```

**Change** Delete the `geist` and `ibm-plex-mono` lines. Keep `manrope` — it is the
declared fallback in `@theme` (`--font-sans: var(--a-font-body, 'Manrope Variable', …)`).
Remove the two packages from `web/package.json` dependencies as well.

**Accept** `pnpm build` no longer emits `geist-*` or `ibm-plex-mono-*` into `dist/assets/`.

**Verify** `cd web && pnpm exec tsc -b && pnpm vitest run && pnpm build`, then
`ls dist/assets | grep -cE "geist|ibm-plex"` returns 0.

---

# Phase 1 exit gate

Do not start Phase 2 until all of these hold:

1. `cd web && pnpm design:check` — **clean**, and now wired as blocking.
2. `cd web && pnpm exec tsc -b && pnpm vitest run` — 335 tests green.
3. `node web/scripts/shoot.mjs tasks-matrix` — the app side shows: white content area, `#006eb9` primary button, 8px panel corners, 1.75 icon strokes, `#f7f6f3` sidebar.
4. `node web/scripts/sample-pixels.mjs docs/design-migration/shots/tasks-matrix.app.png` — primary button dominant colour is `#006eb9`, content background `#ffffff`, sidebar `#f7f6f3`.
5. Rebuild and redeploy once, then re-verify against the running desktop app:
   ```
   sh desktop/scripts/prepare-jar.sh
   cp desktop/resources/hitlist.jar api/target/hitlist.jar
   # restart the Electron app, find its port, re-check /api/health
   ```
   The jar embeds the built frontend, so this is the only check that reflects what
   actually runs on the desktop.

Record which check proved each task in `00-INDEX.md`. A task with an empty
"Verified by" column is not done.
