# Phase 2 — Shell exactness

Read `CONVENTIONS.md` first. Phase 1 must be complete — these tasks assume the tokens
are already right, and several of them will look wrong if the radius scale and accent
have not been fixed.

**Scope.** The shell is on every screen, so an error here is visible 51 times. The
structure is already close (Phase 1's predecessor session built `Sidebar` + `AppHeader`
correctly); what is wrong is metrics — padding, type size, and one structural mistake
in `TopBar`.

---

## T2.1 — Rebuild the page header as a two-row block

**Why** This is the only *structural* error left in the shell. `TopBar` is a single
56px bar with a bottom border and everything on one line. The design has no such bar:
it is a padding-based block with **two rows** — title row, then a controls row carrying
the layout tabs on the left and the actions on the right — and **no bottom border**.
The app's `h1` is also 10px too small and uses the wrong weight.

**Spec** showcase 117–144.
```
padding: 8px 48px 0;  background: #fff;   /* no border-bottom */

  row 1  display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding-bottom:6px
    · optional dot   14×14px, border-radius:3px   (a rounded square, not a circle)
    · h1             font-size:32px; line-height:1.2; font-weight:700; letter-spacing:-0.02em
    · subtitle       font-size:14px; color:var(--text-tertiary)
    · attention      font-size:14px; font-weight:500; color:#b83232

  row 2  display:flex; align-items:center; gap:8px; margin-top:8px
    · left   flex:1; min-width:0   → the layout Tabs (Tasks only)
    · right  display:flex; gap:4px; padding-bottom:4px  → the action cluster
```

Per-view action clusters (showcase 130–141), all `size="sm"` (28px):

| View | Actions |
|---|---|
| Tasks | ghost `Filter` (+ blue count badge: `min-width:18px;height:18px;border-radius:3px;background:var(--blue-500);color:#fff;font-size:11px;font-weight:600`), then primary `New` |
| Notes | success `Badge` "Saved" with dot, then primary `New` |
| Databases | primary `New column` |
| Calendar | **ghost** `Add on a day` |
| Automations | primary `New rule` |
| Library | primary `New page` |

**File** `web/src/components/shell/TopBar.tsx`

**Current code**
```tsx
<header className="flex h-14 flex-shrink-0 items-center gap-3 border-b border-a-line px-3 md:px-[26px]">
  …
  <h1 className="min-w-0 truncate font-display text-[22px] leading-none text-a-ink">{title}</h1>
  {subtitle && <p className="hidden min-w-0 truncate text-[13.5px] text-a-faint lg:block">{subtitle}</p>}
  {actions && <div className="ml-auto flex flex-shrink-0 items-center gap-2 md:gap-2.5">{actions}</div>}
</header>
```
and the dot at `size-[9px] … rounded-full`.

**Change**
- Drop `h-14` and `border-b border-a-line`. Use `px-12 pt-2` (48px / 8px).
- Split into two rows per the spec above.
- `h1` → `text-[32px] font-bold leading-[1.2] tracking-[-0.02em]`. Remove `leading-none`.
- Subtitle → `text-[14px]`, colour `--text-tertiary` not `--a-faint`.
- Dot → `size-[14px] rounded-[3px]` (square with soft corners, not a circle).
- Add an `attention?: ReactNode` prop rendered at `text-[14px] font-medium text-[#b83232]`. `App.tsx:1303-1307` already computes an `alertCount` and renders it inline in `subtitle` — move it to the new prop.
- Add a `tabs?: ReactNode` slot for row 2's left side. `App.tsx` passes `TopBarToggle` into `actions` today; move it.

**Trap** `App.tsx` builds `tasksTopBar` at lines ~1294–1374 and the three pages build
their own `<TopBar>` calls. All four call sites need the new props. Do not leave
`attention` text inside `subtitle` for some views and not others.

**Accept** `node web/scripts/shoot.mjs tasks-matrix` — the app's title reads 32px bold,
there is no hairline under the header, and the tabs sit on their own row under the title.

**Verify** `cd web && pnpm exec tsc -b && pnpm vitest run`

---

## T2.2 — `AppHeader` metrics

**Why** The structure is right and the height (44px) is already correct. Four metrics
are off, and two of them make the breadcrumb read washed out.

**Spec** showcase 108–115.
```
height:44px;  padding:0 12px 0 48px;  gap:8px
  breadcrumb  font-size:14px; color:var(--text-tertiary)
              separator "/" color:var(--gray-300)
              crumb2     color:var(--text-primary); font-weight:500
  spacer
  Badge       tone=sync, dot
  IconButton  bell    28×28
  IconButton  circle-help  28×28
  avatar      26×26px; border-radius:4px; background:var(--gray-200);
              font-size:12px; font-weight:600
```

**File** `web/src/components/shell/AppHeader.tsx`

**Current vs target**

| Thing | Current | Target |
|---|---|---|
| Padding | `px-3 md:pl-3 md:pr-3` (12px both sides) | `pr-3 pl-12` on desktop (48px left) |
| Breadcrumb colour | `text-a-faint` (`#9b9a97`, gray-400) | `--text-tertiary` (`#787774`, gray-500) |
| `/` separator | `text-a-line` (`#e9e9e7`, gray-200) | `--gray-300` (`#d3d1cb`) |
| Help button radius | `rounded-full` | `rounded-[4px]` |
| Help icon stroke | `strokeWidth={2.25}` | `1.75` (T1.4 covers this) |

**Also** `web/src/components/shell/UserMenu.tsx` renders the avatar as `size-7
rounded-full`. Target is **26×26px, `rounded-[4px]`**, `bg-a-line`-ish (`--gray-200`
= `#e9e9e7`), label at `text-[12px] font-semibold`.

**Also** the sync dot map at `AppHeader.tsx:20-24` uses `bg-a-sage` / `bg-a-tag-yellow`
/ `bg-a-tag-red`. The DS Badge tones are `--green-500 #1FA45E` / `--amber-500 #E8912A`
/ `--red-500 #E5484D`. Point the three dots at those.

**Leave alone** The Help button has no `onClick` — that is T4.5's problem, not this
task's. Do not wire it here and do not remove it here.

**Accept** Screenshot pair for any screen: the breadcrumb, badge, bell, help and avatar
line up with the prototype's at 44px, and the left edge starts at 48px.

**Verify** `cd web && pnpm exec tsc -b && pnpm vitest run`

---

## T2.3 — `Sidebar` metrics and the momentum card

**Why** The sidebar is the closest-to-correct part of the app — most metrics already
match. Two things are wrong: the ground colour (T1.3 fixes it) and the foot, where the
design has a bordered white card and the app has a bare bar.

**Spec** showcase 39–105.

Already correct, do not touch: 248px width, `border-right` 1px, logo row padding
`12px 14px 6px`, 22×22px 4px-radius accent logo tile, "HitList" at 14px/600, 14px
chevron, 28px rows at 4px radius with `gap:10px` and 14px text, active
`rgba(55,53,47,0.08)` + weight 600, hover `rgba(55,53,47,0.06)`, 17px nav icons, mono
11px count badges.

Fix:

| Thing | Current | Target | Source |
|---|---|---|---|
| Ground | `bg-a-surface-2` (`#f1f1ef`) | `#f7f6f3` (`--gray-50`) | T1.3 / showcase 39 |
| Context container padding | `px-1 pb-3` | `8px 8px 12px` | showcase 55 |
| Count on active row | hidden | shown | showcase 51 — `n.hasCount` does not exclude the active row |
| Logo glyph | `Leaf` | `crosshair` at 13px | showcase 41 |
| Section header | `ContextSectionHeader` | `padding:4px 10px 6px`, label `font-size:12px; font-weight:500; color:var(--text-tertiary)` | showcase 58–59 |

**The momentum card** — showcase 89–104. Currently `web/src/components/MomentumBar.tsx`
renders a bare progress bar plus two buttons in the sidebar foot. The design wraps it in
a card:
```
outer   flex:none; border-top:1px solid var(--border-subtle); padding:12px
card    background:#fff; border:1px solid var(--border-default);
        border-radius:6px; padding:12px
  row 1   "Today's momentum" (--text-secondary)  ↔  flame icon 14px + "6 days",
          font-weight:600, color:var(--amber-600) #C0741A
  track   margin-top:10px; height:6px; border-radius:99px; background:var(--gray-100)
          fill: width:{pct}; background:var(--blue-500); border-radius:99px
  row 3   margin-top:8px; font-size:12px; color:var(--text-tertiary)
          left: momentum text   right: pct in --font-mono, --text-secondary
  row 4   margin-top:10px; gap:6px — two `subtle` sm Buttons: "Today", "Weekly progress"
```

**Note** The progress track and its fill are `border-radius:99px` — these are among the
few legitimate pills (`CONVENTIONS.md` §4). Keep them pill after T1.6.

**Accept** Screenshot pair on `tasks-matrix`: the sidebar foot shows a white bordered
card with a flame streak, a 6px blue track, and two subtle buttons.

**Verify** `cd web && pnpm exec tsc -b && pnpm vitest run` — `web/test/MomentumBar.test.tsx`
and `web/test/Sidebar.test.tsx` both exercise this area; update assertions rather than
loosening them.

---

## T2.4 — Button and icon-button primitives

**Why** The app has no shared icon-button primitive — the same 28px square recurs
inline in `AppHeader`, `DatabasesPage` (×4), `ViewLayout`, `NoteEditor`'s gutter and
elsewhere, each with slightly different classes. The prototype uses the DS `IconButton`
35 times and `Button` 51 times, with a small fixed set of variants. Standardising now
means Phase 3's 51 screens all get the same controls for free.

**Spec** DS readme + showcase usage.
```
Button   sm: height 28px, radius 6px, font-size 13px, padding 0 10px, gap 6px
         variants: primary   bg --a-accent, white label, hover -600, active -700
                   secondary  white bg, 1px --a-line border, ink label
                   ghost      transparent, hover --gray-100 wash
                   subtle     --gray-50 bg, hover --gray-100
         press: fill darkens + ~0.5px downward nudge. Never scale down.

IconButton  28×28px, radius 4px, transparent, hover --gray-100 wash,
            active state = --a-accent-tint bg + --a-accent-700 icon
```

**Files**
- `web/src/components/shell/TopBar.tsx` — `topBarPill` (`:68`) and `topBarPrimary` (`:74`) are both `rounded-full`; `topBarPrimary` is `h-[34px]` with `font-display text-[15px]`. Target: 28px, 6px radius, 13px.
- `web/src/components/ui/button.tsx` — align `buttonVariants` with the four variants above.
- new — `web/src/components/ui/icon-button.tsx`, then replace the inline copies.

**Accept** `pnpm design:check --rule=pill` reports 0 for these files. Every 28px icon
button in the app comes from one component.

**Verify** `cd web && pnpm exec tsc -b && pnpm vitest run`

**Depends on** T1.6

---

## T2.5 — Content padding: 48px

**Why** The design's content column is inset 48px. The app uses 26px, so every screen
sits ~22px too far left and reads cramped against the sidebar.

**Spec** showcase 156 — `padding:16px 48px 48px` on the scroll container.

**Files** the per-view content wrappers: `web/src/App.tsx` (Tasks, ~line 1538
`px-4 py-[22px] md:px-[26px]`), `web/src/pages/DatabasesPage.tsx` (~line 582, same
classes), `web/src/pages/CalendarPage.tsx`, `web/src/components/NotesWorkspace.tsx`.

**Change** → `px-4 pt-4 pb-12 md:px-12` (16px top, 48px sides on desktop, 48px bottom).

**Note** Notes is the exception: its `<article>` is centred at `max-width:calc(720px +
44px)` with `padding:16px 0 96px 44px` (showcase 311), so it keeps its own measure and
gutter instead of the 48px inset. Do not force 48px there.

**Accept** Screenshot pair on `tasks-matrix` and `db-table`: content left edge is 48px
in from the sidebar in both.

**Verify** `cd web && pnpm exec tsc -b && pnpm vitest run`

---

# Phase 2 exit gate

1. `cd web && pnpm design:check` — clean.
2. `cd web && pnpm exec tsc -b && pnpm vitest run` — green.
3. Screenshot pairs for `tasks-matrix`, `db-table`, `notes-editor` and `cal-month` show the shell matching: 44px chrome row, 32px title, tabs on their own row, no header hairline, 48px content inset, white content, `#f7f6f3` sidebar with a carded foot.
4. One rebuild + redeploy, re-verified against the running desktop app (see the Phase 1 gate for the commands).
