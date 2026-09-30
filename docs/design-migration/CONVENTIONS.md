# Design conventions — the laws this migration enforces

Everything here is quoted or derived from the design bundle. Nothing is invented.
If a task tells you to do something this file forbids, **stop and report it** rather
than guessing.

**Sources**
- Prototype: `~/Documents/newHitlistDesign/project/HitList Notion x Zoho.dc.html` (1,879 lines) — referred to below as **the showcase**.
- Design system: `~/Documents/newHitlistDesign/project/_ds/zoho-dataprep-design-system-20a89338-6c21-4f3c-bfc1-0b92957928cc/` — referred to as **the DS**. Its `readme.md` is the written law; `tokens/*.css` are the values.
- Live source of truth: claude.ai/design project `01862a97-e237-4311-9051-d31fae69f088`. The local folder is a verified mirror (see T0.1).

---

## 1. How the two token layers combine (read this first)

The showcase loads the DS stylesheet, then overrides **only** neutrals, radii and
shadows in an inline `:root` block (showcase lines 20–30). It **never overrides
`--blue-*`, `--color-primary`, or the data-quality colours.**

So the effective palette is:

| Layer | Comes from | What it governs |
|---|---|---|
| Neutrals, radii, shadows | showcase `:root`, lines 20–30 | Notion's warm greys, tight corners, flat shadows |
| Brand blue, DQ colours, type, spacing, motion | the DS `tokens/*.css` | `#006EB9` accent, green/red/grey DQ, Puvi, 4px grid, 120–260ms |

**This is the mistake that broke the previous attempt.** A prior session assumed the
whole palette was Notion's and set the accent to Notion blue `#2383e2`. It is not.

### Proof (sampled pixels, not inference)

Dominant colour along a horizontal scanline through each primary button, and flat
areas of each surface:

| Thing | Prototype | App before this migration |
|---|---|---|
| Primary button fill | **`#006eb9`** | `#2383e2` ✗ |
| Logo mark | **`#006eb9`** | — |
| Content background | **`#ffffff`** | `#f7f6f3` ✗ |
| Sidebar background | **`#f7f6f3`** | `#f1f1ef` ✗ |
| Card / panel body | **`#ffffff`** | — |

Reproduce with `web/scripts/sample-pixels.mjs` (T0.5) against
`ref-tasks-matrix.png`. Do not re-litigate these values from reading CSS — sample them.

---

## 2. Colour

### Accent (brand blue) — `#006EB9`
```
--a-accent:      #006eb9   /* --blue-500, DataPrep primary */
--a-accent-600:  #005c9c   /* hover */
--a-accent-700:  #004a7f   /* active */
--a-accent-tint: rgba(0, 110, 185, 0.10)
```
Carries: primary buttons, active nav, links, focus rings, selection outlines, the
active-tab underline, count badges. DS readme: *"Brand blue is the anchor… Hover
darkens (600), active darkens further (700)."*

### Surfaces — white content, grey sidebar
```
--surface-page   #ffffff   content area, cards, popovers, menus, drawers
--gray-50        #f7f6f3   sidebar ground, "sunken" surfaces
--gray-100       #f1f1ef   hover wash, soft hairlines
--gray-25        #fbfbfa   table-row hover, card-footer tint
```
`<main>` is literally `background:#fff` (showcase 107). The sidebar is
`background:var(--gray-50)` (showcase 39).

### Neutrals (showcase's Notion override, lines 21–23)
```
--gray-25 #fbfbfa  --gray-50 #f7f6f3  --gray-100 #f1f1ef  --gray-200 #e9e9e7
--gray-300 #d3d1cb --gray-400 #9b9a97 --gray-500 #787774  --gray-600 #5f5e5b
--gray-700 #494844 --gray-800 #37352f --gray-900 #2b2a27
--text-primary #37352f  --text-secondary #5f5e5b  --text-tertiary #787774
--border-subtle #f1f1ef --border-default #e9e9e7  --border-strong #d3d1cb
```

### Data quality — do not repurpose these hues
DS readme: *"Data-quality colour language is sacred: green = valid, red = invalid,
grey = missing."*
```
--dq-valid #1FA45E   --dq-invalid #E5484D   --dq-missing #D0D5DD
tracks: valid #E6F5EE  invalid #FCEBEC  missing var(--gray-100)
```

### Other literals used by the showcase
- Attention / overdue text: `#b83232` (showcase 123)
- Row hover (nav, menus): `rgba(55,53,47,0.06)`
- Active nav row: `rgba(55,53,47,0.08)` (showcase 1266)
- Icon-button pressed wash: `rgba(55,53,47,0.1)`

### Forbidden
No gradients in the product. No glassmorphism, no `backdrop-filter`. Accent hues
(periwinkle/coral/cyan) are for illustrations only — never page backgrounds.

---

## 3. Type

Base is **13px**. Zoho Puvi everywhere; Roboto Mono for numerics with `tabular-nums`.

| Token | px | Use |
|---|---|---|
| `xs` | 11 | micro labels, table meta, count badges |
| `sm` | 13 | body / UI default |
| `base` | 14 | comfortable body, table cells, nav rows |
| `md` | 16 | emphasised body, inputs |
| `lg` | 18 | card titles |
| `xl` | 20 | section titles |
| `2xl` | 24 | page titles (generic) |
| — | 32 | the page `h1` specifically (showcase 121), weight 700, `letter-spacing:-0.02em` |

Weights: 300/400/500/600/700/800. Line heights: tight 1.2, snug 1.35, normal 1.5,
relaxed 1.65. Tracking: `-0.02em` tight, `-0.01em` snug, `0.06em` all-caps.

### Allowed font sizes — the closed set
`{11, 12, 13, 14, 16, 18, 20, 24, 32}`. Nothing else. `design:check` fails on any other.

**Note on 12px.** The DS type scale jumps 11 → 13, but the showcase's own markup uses
literal `font-size:12px` **64 times** — it is the second most common size in the file,
carrying section titles, meta lines, toolbar pills, menu captions and the calc footer.
The showcase is the authority for structure, so 12 is in the set. (An earlier draft of
this file mapped 12 → 13; that was wrong and would have shifted 37 call sites off the
design.)

Actual distribution in the showcase: 14px ×69, 12px ×64, 11px ×24, 13px ×21, then
16/18/20/24 once or twice each for headings, and 28–38 for the login panel's display type.

### Migration mapping (T1.7) — apply mechanically, do not judge per-site
| Found in app | Replace with | Why |
|---|---|---|
| `text-[10px]` | `text-[11px]` | below the scale floor |
| `text-[11.5px]` | `text-[11px]` | off-grid half |
| `text-[12.5px]` | `text-[12px]` | off-grid half |
| `text-[13.5px]` | `text-[14px]` | off-grid half; 14 is the row/cell size |
| `text-[14.5px]` | `text-[14px]` | off-grid half |
| `text-[15px]` | `text-[14px]` | 15 is not in the scale |
| `text-[17px]` | `text-[16px]` | not in the scale |
| `text-[19px]` | `text-[20px]` | not in the scale |
| `text-[22px]` (page `h1`) | `text-[32px]` | showcase 121 — **T2.1's job, not T1.7's** |

`11`, `12`, `13`, `14`, `16`, `18`, `20`, `24` are already on-scale — leave them alone.

---

## 4. Radius

DS readme: *"Inputs/small buttons 4px, buttons/chips 6px, cards 8px, modals 12px,
tags/toggles pill. Never sharp, never over-rounded."*

| Element | Radius |
|---|---|
| Tags, toggles, avatars, status dots | pill (`rounded-full`) |
| Inputs, small buttons, sidebar/menu rows | 4px |
| Buttons, chips, view tabs | 6px |
| Cards, panels, table containers | 8px |
| Modals, dialogs, large popovers | 12px |

### Allowed radii — the closed set
`{3, 4, 6, 8, 12}` plus `rounded-full` **only** on the four element types above.

### The root cause (T1.1)
`--radius: 0.875rem` (14px) is declared at `web/src/index.css:219` and
**`.app-organic` never overrides it**. Tailwind derives its whole scale from it, so:

| Class | Renders today | Should be |
|---|---|---|
| `rounded-sm` | 8.4px | 4px |
| `rounded-md` | 11.2px | 6px |
| `rounded-lg` | 14px | 8px |
| `rounded-xl` | 19.6px | 12px |
| `rounded-2xl` | 25.2px | — do not use |

Setting `--radius: 0.5rem` inside `.app-organic` lands the scale on
4.8 / 6.4 / 8 / 11.2px, which is the design's scale within a rounding error, and
fixes **127 call sites with one line**.

### Migration mapping (T1.6)
| Found | Replace with |
|---|---|
| `rounded-2xl`, `rounded-3xl`, `rounded-[24px]`, `rounded-[20px]`, `rounded-[18px]`, `rounded-[16px]` | `rounded-[12px]` if a modal, else `rounded-[8px]` |
| `rounded-[14px]`, `rounded-[10px]`, `rounded-[9px]` | `rounded-[8px]` |
| `rounded-[7px]`, `rounded-[5px]` | `rounded-[6px]` |
| `rounded-[2px]` | `rounded-[3px]` |
| `rounded-full` on a button, pill-chip, card, input, row, or panel | the radius for that element from the table above |
| `rounded-full` on a tag, toggle, avatar, or status dot | **keep** |

---

## 5. Spacing and geometry

4px grid. DS readme: *"Product density is high — most gaps are 4–16px; section
padding 24–32px."*

```
--space: 0 2 4 8 12 16 20 24 32 40 48 64 80 96
--control-height-sm 28px   --control-height-md 34px   --control-height-lg 40px
--sidebar-width 248px      --container-max 1200px
```

Structural contracts taken literally from the showcase:

| Thing | Value | Showcase line |
|---|---|---|
| Sidebar width | 248px | 39 |
| Top chrome row height | 44px | 108 |
| Top chrome padding | `0 12px 0 48px` | 108 |
| Page-header padding | `8px 48px 0` | 118 |
| Content scroll padding | `16px 48px 48px` | 156 |
| Sidebar row min-height | 28px | 49, 74 |
| Table row min-height | 36px | 630 |
| Task list row min-height | 44px | 232 |
| Matrix row padding | `9px 16px` | 197 |
| Quadrant header padding | `10px 16px` | 188 |
| Matrix panel min-height | 240px | 187 |
| Grid max width | 1200px | 185 |
| Avatar button | 26×26px, radius 4px | 114 |
| Icon buttons | 28×28px | 112 |
| Note editor measure | 720px + 44px gutter | 311 |
| Detail / history drawer top | `52px`, right-anchored | 1017, 1049 |
| Record peek drawer width | `min(520px, 100vw)` | 766 |

**Content horizontal padding is 48px.** The app currently uses 26px.

---

## 6. Borders, shadows, elevation

DS readme: *"Borders over shadows: the UI leans on 1px cool-grey borders to separate
surfaces. Shadows are subtle… used for elevation on cards-on-hover, menus, modals
and toasts — not as decoration."*

Showcase's own shadow values (lines 27–29):
```
--shadow-xs: none
--shadow-sm: 0 1px 3px rgba(15,15,15,0.10)
--shadow-md: 0 2px 4px rgba(15,15,15,0.15)
--shadow-lg: 0 4px 6px rgba(15,15,15,0.10), 0 0 0 1px rgba(15,15,15,0.05)
--shadow-xl: 0 10px 15px rgba(15,15,15,0.10), 0 0 0 1px rgba(15,15,15,0.05)
```

**Cards:** white surface, 1px border, 8px radius, `shadow-sm` at rest. On hover they
lift 1px with `shadow-md` and a stronger border. Selected = brand-blue border + focus ring.

Shadows are allowed only on: menus, popovers, modals, drawers, toasts, and card-hover.
A static panel gets a border, not a shadow.

---

## 7. Focus, hover, press

- **Focus** — always visible, always brand blue: `box-shadow: 0 0 0 3px rgba(0,110,185,0.28)`. Danger controls: `0 0 0 3px rgba(229,72,77,0.26)`. Never `outline: 2px solid`.
- **Hover** — buttons darken to `-600`; ghost/icon buttons pick up a `--gray-100` wash; cards lift; links darken and underline.
- **Press** — slightly darker fill plus a ~0.5px downward nudge. **Never scale down.**
- **Modal scrim** — `rgba(16,24,40,0.45)`. No blur.

---

## 8. Motion

```
--duration-fast 120ms   --duration-base 180ms   --duration-slow 260ms
--ease-standard cubic-bezier(0.4, 0, 0.2, 1)
--ease-out      cubic-bezier(0.16, 1, 0.3, 1)   /* entrances */
```
DS readme: *"Quick and gentle… **No bounce**, no long or looping decorative animation.
Reduced-motion friendly."* Fades plus small translate/scale pops for modals and toasts.

---

## 9. Icons

Lucide, rendered in `currentColor`. Default size **16–20px**, **stroke 1.75**.

The app currently ships stroke 2.75 (×60), 2.5 (×40), 2.25 (×14), 2 (×8), 3 (×2),
3.4 (×1) — **zero at spec**, which is why every glyph reads heavier than the design.
T1.4 sets all of them to `1.75`.

Sizes seen in the showcase: 13 (logo mark), 14 (chevrons, small adds), 15 (column
type glyphs), 16 (nav-adjacent, menu items), 17 (primary nav, task status), 12 (inline
meta). Keep these; only the stroke is wrong.

**No emoji anywhere in product UI.** DS readme: *"Personality comes from the
illustrations, not emoji."* User-authored content (a note's own emoji icon) is exempt —
that is data, not chrome.

---

## 10. Illustrations

The design pairs every empty and error state with a line-art illustration from
`~/Documents/newHitlistDesign/project/hl/ill/` (12 PNGs). T1.10 copies them to
`web/public/ill/`.

| File | Used for | Showcase line |
|---|---|---|
| `no_data.png` | Tasks empty, Databases empty | 176, 594 |
| `no_filtered_data.png` | No filter matches | 180 |
| `sample_data.png` | Notes empty | 306 |
| `error_state.png` | Offline / needs-the-server | 597, 792 |
| `happy_mascot.png` | Login panel | 922 |
| `schedule.png` | Automations empty | 898 |
| `delete_confirmation.png`, `discussion.png`, `no_search_result.png`, `security_privacy.png`, `template.png`, `bot_mascot.png` | available, not yet placed | — |

---

## 11. Copy rules (DS "Content fundamentals")

- **Sentence case everywhere** — buttons, menus, titles, table headers. Not Title Case. "Import data", "Needs review", "Add destination".
- **Verbs first** on actions: "Add task", "Change type", "Delete property".
- **Numbers are specific and formatted** — grouping separators, mono font, `tabular-nums`.
- **Empty and error states are warm but directive** — say exactly what to do next.
- **Address the user as "you".**
- **No emoji, no exclamation-heavy copy.**

---

## 12. What `design:check` enforces

`cd web && pnpm design:check` (built in T0.4). Each rule prints a violation count, so
progress is visible run to run.

| Rule | Fails on |
|---|---|
| `font-size` | any `text-[Npx]` where N ∉ {11,13,14,16,18,20,24,32} |
| `radius` | any `rounded-[Npx]` where N ∉ {3,4,6,8,12}; any `rounded-2xl`/`3xl`/`4xl` |
| `pill` | `rounded-full` on an element not tagged as tag/toggle/avatar/dot (allowlist by file+line, see the script) |
| `stroke` | any `strokeWidth={X}` where X ≠ 1.75 |
| `colour` | any hex literal in `web/src/**` outside `index.css` |
| `accent` | any occurrence of `#2383e2` (the wrong blue) anywhere |
| `shadow` | `shadow-[…]` on a file/element not in the elevation allowlist |
| `motion` | `duration-[0-9]+` outside {120,180,260} |

The script is advisory during Phase 1 (it will report hundreds initially) and becomes
blocking at the Phase 1 exit gate.

---

## 12a. Recorded deviations from the design

Phase A's value is that fidelity is checkable, so anything we knowingly do
differently is written down here. `design:check` and screenshot comparison will
otherwise flag these as regressions.

### The `longtext` field kind ("Text area")

**The design has one text type.** Its property list (showcase 1389) is
`text, number, select, multi, status, date, person, files, checkbox, url,
email, phone, formula, relation, created, edited` — a single `Text`, which in
Notion wraps natively inside the row.

**We have two.** `text` stays a single-line input; `longtext` renders a
textarea that wraps and grows. The reason is a real defect the single type
could not express: a `text` cell is an `<input>`, so a paragraph scrolls
sideways and becomes unreadable and uneditable.

- Both kinds store the same string, and `WorkspaceService.interchangeable()` makes switching between them **non-destructive** — unlike every other type change, which cloaks values by design.
- `longtext` always wraps, independent of the column's own "Wrap content" toggle. A text area that truncated would be the bug it exists to fix.
- `longtext` caps at 10,000 characters; `text` stays at 2,000.

### Per-column widths

The design gives every column an explicit width (showcase 619, `width:{{ h.w }}px`)
but does not show a resize affordance. We added a drag handle on the header's
right edge, persisted into the saved view's `display.widths` — a field that had
been declared in `ViewDisplay` and left unused since it was written.

---

### Board (T3.4)

- **Cards are the prototype's** (showcase 282–293): title, then a 12px row of quadrant
  dot, due, Tag. **No status glyph and no hover delete** — the prototype's card has
  neither. Status and delete are in the detail panel (T3.10). Reversing this earlier
  "keep them" call was deliberate: the brief is the design, not our additions.
- **No estimate ("N pts") on cards.** The prototype's Estimate is a sample custom
  number field; the app has no built-in estimate, so there is nothing to show.
- **The saved-view chip row appears on the board only once a board has been saved as a
  view** (Filter → Save as view still creates one); the prototype's Board screen has no
  chip row. It also hides while a filter leaves no visible tasks (showcase 179: the
  no-matches screen is the whole block).
- **No right-edge fade** (gradients are forbidden, §2).
- **New token `--a-line-strong: #d3d1cb`** (= `--border-strong`) for dashed drop targets.

### List and matrix (T3.1, T3.2)

- Status glyphs are the circle icons the design specifies (`circle`/`loader`/
  `circle-check`, 17px) — `ui/status-icon.tsx`, shared by matrix, list and board. The
  checkbox-style `StatusBox` remains only in the note editor's to-do block.
- List rows: grip `--gray-300`, 13px/500 title, Badge "Next up", DS Tag with swatch, due
  column 120px flush right; the row menu is overlaid on hover so it never offsets the
  due column. The "next task" accent ring is gone (the design marks it with the badge
  only). Group spacing 20px; subtitle/count tertiary; "Add here" is the ghost `sm` button.
- Breadcrumb `Tasks` is tertiary and its `/` is `--gray-300`; sidebar list counts are
  11px tertiary, including the active row.

### Empty, loading and offline states (T3.5–T3.8)

- **One offline strip, one pill.** The design has exactly two offline signals: the
  header badge and the amber bar (showcase 146–154). The app had three — the sidebar
  foot also said "Offline — using local data" — so that one is gone. `SyncStatusBar`
  shows the bar whenever `!serverOnline` (the pill's own condition), except while the
  first load is in flight; it no longer owns saving, loading, or the old
  `backendUnavailable` case. Its `loading`/`saving`/`backendUnavailable` props are
  removed.
- **The header pill is tone-tinted** (green Saved, amber Offline/Syncing, red Error) as
  the DS `Badge` is, not a neutral outline.
- **New amber tokens**, all literals from the showcase/DS: `--a-amber-tint` `#fdf3e4`
  (DS `--amber-50`), `--a-amber-line` `#f2d6a8` (showcase 147 border), `--a-amber-ink`
  `#7a4a0e` (showcase 147 text). Dark theme gets translucent equivalents.
- **`EmptyState` follows the DS component**, not the earlier smaller rebuild: 180px art
  (max 60%), h2 20px/600, body 16px/1.65, 420px column with 40/24 padding inside the
  showcase's 520px / 16px-gap / 48px-margin wrapper. The action sits outside the 420px
  column, as in showcase 176.
- **No-match copy is computed**, not fixed: "Your tasks are safe — N are hidden by
  <clauses>." from `describeActiveFilters` (search, status, quadrant, due, custom
  fields; sort and grouping hide nothing so are omitted).

### Measured corrections to the foundations (found by `tools/cmp.mjs`)

**Radii are one step smaller than §4 says, for DS components.** The showcase re-declares
`--radius-sm/md/lg/xl` as **3 / 4 / 6 / 8px** (line 28) on top of the DS's 4 / 6 / 8 / 12, and
every DS component reads those. Measured in the prototype: sm **Button 3px**, md Button
(34px) **4px**, **Tag 4px**, IconButton 4px, Badge pill (with a 1px border, so 19px
tall), DS Table container 6px. Hand-written markup in the showcase (panels, popovers,
sidebar rows) uses literal px and is unaffected. DS controls also carry a real 1px border
(transparent, `--border-strong` or `--border-default`), which is part of their box — don't
fake it with an inset shadow or the control comes out 2px small.

These were wrong at the source and every screen inherited them.

- **Text colours.** `--a-muted` is now `#5f5e5b` (`--text-secondary`) and `--a-faint`
  `#787774` (`--text-tertiary`); they were `#6f6e69` and `#9b9a97` (`--gray-400`, an icon
  grey). Plain due dates, captions, counts and placeholders all use the faint one.
- **DS `Button` sm** — what every page-header control is: 28px tall, `0 12px`, **11px /
  600**, 8px gap, **3px radius**, 1px border (md: 34px, `0 16px`, 13px, 4px). Variants: primary
  (`#006eb9`), secondary (white, `--border-strong` ring, ink), ghost (transparent,
  secondary ink, `--gray-100` hover). `topBarPrimary / topBarSecondary / topBarPill` in
  `TopBar.tsx` are these; `BTN_MD` is the md override.
- **DS `Tabs`**: 13px, 500 (selected 600, brand), `12px` padding, 4px gap, a 1px
  `--border-default` rule under the row and a 2px brand rule inset 12px on the selected tab.
  The page header puts **8px** between the title row and the tab row.
- **DS `Tag`**: 11px / 500, `3px 8px`, 1px border, **4px** radius, 6px gap, an 8px swatch.
  Selected: `--blue-50` fill, `--blue-200` border, `--blue-700` text. Used for the
  saved-view chips and every category chip.
- **DS `Badge`**: 11px / 600, `3px 8px`, pill, 1px transparent border, 6px dot in the ink. Sync pill
  (green-50/600, amber-50/600, red-50/600) and "Next up" (blue-50/700).
- **Quadrant and category colours are the showcase's literals** (lines 1224–1227), with a
  separate dot colour per quadrant: Do `#b83232 / #ffeaea / #e03e3e`, Schedule
  `#005c9c / #e7f3ff / #2383e2`, Delegate `#6b4884 / #f4f0f7 / #9065b0`, Eliminate
  `#5f5e5b / #f1f1ef / #9b9a97`; Work `#2383e2`, Personal `#9065b0`, Health `#0f7b0f`,
  Learning `#d9730d`. (`#2383e2` is allowed here as a *data* colour; the `accent` rule
  still bans it as a brand colour — see the two `design-check-ignore` lines in `index.css`.)
- **DS `Table`** (tasks table): a bordered 8px container; sticky `--gray-50` header whose
  cells are glyph + 13px/600 name over an 11px tertiary type label (`text`, `date`,
  `select`…); a 44px `#` gutter (`--gray-100` head, `--gray-25` cells, row numbers 13px ink); container radius 6px;
  cells 13px, hairline rows, hover `--gray-25`; overdue due cells use the DS "invalid" cell
  (`red-50` fill, `red-600` ink, 2px `red-500` left bar); empty cells read `—` in italic
  tertiary; number columns are right-aligned mono 11px. The frozen title column is white,
  not grey.
- **Deviation:** a **single select** shows plain text in the tasks table (as the
  prototype's Stage column does); **multi-select** keeps its coloured chips.
- **Deviation:** the saved-view strip's `+` is a 28px icon button like the prototype's,
  but still opens our name/layout/columns popover (a saved view needs those).

## 13. Standing rules for whoever executes a task

1. **Verify before you change.** Every task quotes the current code. If what you find does not match the quote, **stop and report** — do not adapt silently. The file may have moved on.
2. **Never invent a value.** If a task does not give you a number and this file does not either, ask. Guessing is what produced the current state.
3. **One task, one commit.** Commit message: `design(T1.4): set every icon stroke to 1.75`.
4. **Run the verify line before marking done.** `cd web && pnpm exec tsc -b && pnpm vitest run` must stay green at 343 tests.
5. **Update `00-INDEX.md`** — set State and fill in "Verified by" with the actual command output or screenshot pair. A task with an empty "Verified by" is not done.
6. **Do not delete the Automations or Reminders code.** It is being revived in Phase 4, not removed.
