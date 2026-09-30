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

### Dialogs and form controls (T3.9 onward)

Shared primitives now follow the DS, so every dialog inherits them:

- **Dialog** (`ui/dialog.tsx`): scrim `rgba(16,24,40,.45)` with no blur; white panel, **8px**
  radius (the showcase's `--radius-xl`, not §4's 12), `shadow-xl`, `20px 24px` padding, 520px
  wide (`sm` 400, `lg` 720 by className), children stacked 16px apart; title 20px/600 with a
  13px secondary description 3px below; a 30px close button; `DialogFooter` = a hairline,
  12px above right-aligned buttons. No header icon.
- **Input / Select trigger / Textarea**: 34px (textarea min 72px), 1px `--border-strong`,
  **3px** radius, 13px, `0 12px` padding, hover border `--gray-400`, focus border brand +
  `0 0 0 3px rgba(0,110,185,.28)`; placeholder tertiary.
- **Field label**: 13px / 500 ink, sentence case (no uppercase tracking); a required star
  is `--red-500` (`--a-red-line`), 4px from the label.
- Quadrant picker tile: 6px radius, `8px 12px`, ink text, `line-height: normal`; selected = the
  quadrant tint with a **1.5px** ink border, otherwise white with a 1px default border.
- "Due time (optional)" is always shown (half width), not only once a date is set.

### Task detail panel and delete confirmation (T3.10, T3.11)

- The panel is a **non-modal `<aside>`** (440px, `top:52px`, right-anchored, 1px left border,
  `shadow-xl`, **no scrim** — the page behind stays interactive), not a Radix `Sheet`.
  Escape and the X close it (autosaving), and **Save now saves and closes**; it is never
  disabled.
- Removed because the design has none: the "Unsaved" marker and header Save, the
  per-section icons and uppercase headings, the Info block (created/completed dates), the
  clear-due-date button, the category chip under the select, and the inline "Yes, delete".
- Status buttons carry no icons; the quadrant picker is the shared `QuadrantPicker`.
- Custom fields: a hairline, then `CUSTOM FIELDS` (11px/600/.06em tertiary) and a ghost
  "Manage fields", then each field as a label over a control.
- **Delete** opens a danger `Dialog` (400px): "Delete this task?" — "“<task>” will be removed
  from <list>." plus, only when the task came from a note, "Its chip in the note it came from
  stays, and reads “Task removed”." (the prototype names the note; the panel does not know its
  title). Buttons: ghost "Keep task", red-500 "Delete task". The panel is hidden while it is open.
- **Deviation:** the linked-note row reads "Added from note · Open note" (the prototype shows
  the note's title as the link).

### Today's history and Weekly progress (T3.15, T3.16)

- **Today's history** is a 400px peek panel like the detail panel (no scrim, Escape closes):
  `Today` (18px/600), a green Badge "N completed", rows of a green `circle-check`, the title,
  "Do first · 9:12 AM" (tertiary 12px) and a **subtle** "Undo"; footer "Undo moves a task back
  to the quadrant it came from." The old "Today's Wins" header icon, "Great work" footer,
  quadrant emojis and per-row chips are gone (no emoji in product UI, §9).
- **Weekly progress** is a 720px dialog titled "Weekly progress" with the list name and the
  seven-day range as its description, four tiles — **Streak** (`Nd`), **Today**, **This week**
  (the last seven days), **All time** — and a "Completed per day" bar chart: bars scale to 90px,
  6px minimum, today's in `#006eb9`, the rest `--blue-200`; counts above in 11px mono.
  **Removed** because the design has neither: Best streak and Recent completions.
- `topBarSubtle` (DS subtle `sm`) is shared by the momentum card's buttons and Undo.

### Filter popover (T3.12)

- Contents are `tasks/FilterPanel.tsx` (the popover, its anchor and width stay in the page
  header): "Filter and sort" + a brand Badge "N active" (only filters that hide tasks count) +
  ghost "Clear all"; a 3-column grid of `sm` selects (Status, Quadrant, **Category**, Due,
  Sort by, Group by) labelled 13px/500; **Show completed** (DS `sm` Switch) with a ghost
  "Clear done (n)"; "Save as a view" (sm input, primary "Save view", DS Checkbox "Only show in
  <list>"). Radius 12px (hand-written popover), `shadow-xl`, padding 16, rows 14px apart, placed
  100px from the top so it overlaps the tab row.
- **New filter: Category** (`FilterState.category`). Stored inside the saved view's opaque
  `FilterJson`, so this is additive: a view saved earlier has no key and reads as "Any".
- **Removed from the panel because the design has none:** the search box, the sort
  direction toggle, the due from/to date range, the "drag to reorder is off" note and the
  explanatory copy under "Save as view". Their state still exists (saved views keep
  `search`, `sortDir`, `dueAfter`/`dueBefore`); a table column header still sorts both ways.
  Task search returns as ⌘K (T4.2).
- **Kept, in the same grid:** one select per custom field (Any / each option / Has a value /
  Empty), so filtering by Stage still works. `FieldFilterMenu` (multi-choice) remains for
  Databases until T3.25.
- New DS primitives: `ui/switch` (34×20 track, sm 28×16) and `ui/checkbox` (16px, 1.5px border).

### Fields manager and delete-field warning (T3.13, T3.14)

- One anchored popover (**not** a Dialog), 440px, 12px radius, `shadow-xl`: header "Fields" +
  secondary "New field"; the field list (glyph, name, kind; the selected row tinted); beneath it
  the selected field's editor — Name + Type (Type is a select, **disabled for an existing field**
  because a type can't change), Options (a 14px swatch, the name, a usage count — "5 tasks" /
  "unused" — and an X), "Add option", "Show on cards" (DS Checkbox); footer ghost "Delete field"
  and primary "Done". **Done saves what changed and closes**; moving to another field saves the
  current one first; an unnamed new field is dropped. The removed-option warning stays inline.
- **Delete field** opens a danger dialog (400px): "Delete the “Stage” field?" — "It has a value on
  12 tasks and is used by 2 saved views: … The tasks are kept; only their Stage values are removed.
  This can't be undone." — ghost Cancel (back to the fields panel), red "Delete field and 12 values".
  The fields panel steps aside while it is open. Databases pass `noun="record"`.
- **Option swatches are vivid** (`--a-dot-*`: gray #9b9a97, blue #006eb9, green #1fa45e, red #e03e3e,
  plus brown/orange/yellow/purple/pink), separate from the near-black tag ink; "no value" is
  `#D0D5DD`. Board lanes, list/table group headers and the editor all use them.
- Board "Manage fields" opens the list (first field selected), not a new blank field.

### Database table and toolbar (T3.17)

- **Full-bleed grid** under a hairline (the table breaks out of the 48px content padding and its
  first column starts where the page content does), `table-layout: fixed` with the prototype's
  widths — Title 260, select 140, multi-select 190, number 90, date 130, checkbox 80, text 170 —
  plus a 44px "+" column. A stored column width still wins. Headers 36px, `--gray-50`, glyph +
  13px/600 name, the 3px data-quality bar (the Title column's is always full); the column menu's
  chevron is overlaid so it never widens a column.
- **Rows 37px** (6px 8px padding around 24px content; 1px hairline). Cell editors have no inner
  padding. Title = a 16px page glyph then the title on **one line** (ellipsis; full title as its
  tooltip), 14px/400. Number 13px mono. Date **13px mono, "Aug 14, 2026"** — a button that opens a
  date popover. Tags: 22px tall, 3px radius, 13px/400, a dot on a **single select** only.
  Empty cells are blank (the tasks table's "—" is tasks-only). Checkbox: DS 16px, 1.5px border.
- **Last row** is a full-width ghost "New record" (click, type a title). Below the table:
  "N records" (12px tertiary) and the reminders note (12px tertiary).
- **Toolbar (36px)**: view chips (32px, 8px radius, selected = brand tint / 600, others tertiary / 500),
  the active "Sorted by X ×" and filter pills (24px, pill, brand tint), then Filter · Sort · Search ·
  Properties as 28px icon buttons (4px radius, secondary ink; active = brand tint) and a primary
  `New ▾` that adds an "Untitled" record.
- **Deviations:** no URL column type — a text column that holds a URL renders as plain text, not a
  link; the prototype's "2 more…" overflow is not built (every view shows).

### Databases: the popover family (T3.19–T3.26)

- **One panel shell** — white, 1px `--border-default`, **6px** radius, `shadow-lg`, **6px** padding —
  is now the base of `ui/popover` and `ui/dropdown-menu`, so every menu in the app has it. Menu rows
  are **30px** (`5px 8px`, 4px radius, 14px, 10px gap, a 16px icon, `--gray-100` hover, line-height
  normal); separators are `--border-subtle`; a destructive row is `#b83232` with the same wash.
- **Column menu**: the header opens it on click (a cover button under the name; press-and-hold still
  drags), hung 13px left of the header. Items in the prototype's order — property name field · Change
  type · Edit options (select kinds) · — · Filter · Sort ascending / descending · Group · Calculate ·
  Freeze · Hide · Wrap content · — · Insert left / right · Duplicate property · Delete property. Change
  type (230px), Edit options (280px) and Calculate (220px) open as **side panels**, 12px away and hung
  from the menu's top edge. Freeze and Wrap show DS `sm` switches. Delete keeps its second confirming
  click ("Delete from every record"). The old "Edit column…" entry is gone.
- **Change type** lists only the kinds the app has (text, text area, number, select, multi-select, date,
  checkbox) — the prototype's Status, Person, Files, URL, Email, Phone, Formula, Relation, Created and
  Edited have no backing yet, and dead rows are not shipped.
- **Edit options** applies each change at once (rename on blur/Enter, colour cycles on click, new options
  on Enter). Removing an option that records use asks first ("Remove from N?") — it clears that value.
- **New property**: name field + type list; clicking a type creates the column (named after the type if
  the field is empty). `FieldsManager` is now used only for task fields.
- **Toolbar popovers** (Filter, Sort, Properties) hang from the toolbar's right edge (Radix loses a custom
  anchor when a `PopoverTrigger` is present, so they are controlled with plain buttons).
  Sort lists Title and every column; Properties lists Title (always on) and every column, with "Show all".
- **Filter records** is the prototype's single rule — a column, "contains", a value — with a count and
  Clear filter; a select matches on its option names. It applies **in addition to** the older per-field
  choice filters that saved views carry (`filters.fields`), which still apply and clear from the pill but
  no longer have their own editor.
- **Option picker** is a listbox: caption ("Select an option" / "Select options"), each option as its tag
  with a blue tick, and "Clear value". A single select closes on choosing; a multi stays open.

## 13. Standing rules for whoever executes a task

1. **Verify before you change.** Every task quotes the current code. If what you find does not match the quote, **stop and report** — do not adapt silently. The file may have moved on.
2. **Never invent a value.** If a task does not give you a number and this file does not either, ask. Guessing is what produced the current state.
3. **One task, one commit.** Commit message: `design(T1.4): set every icon stroke to 1.75`.
4. **Run the verify line before marking done.** `cd web && pnpm exec tsc -b && pnpm vitest run` must stay green at 466 tests.
5. **Update `00-INDEX.md`** — set State and fill in "Verified by" with the actual command output or screenshot pair. A task with an empty "Verified by" is not done.
6. **Do not delete the Automations or Reminders code.** It is being revived in Phase 4, not removed.

### Databases: board, new database, empty, offline (T3.18, T3.30–T3.32)

- Board lanes are `--a-line-soft` 8px blocks with an ink-colour dot, 13px/600 name and mono count. The lane's "+" composer is not in the prototype, so it shows only on lane hover.
- A board view remembers its lane field in `filters.groupBy`; Properties gets a "Board columns come from" section for it.
- New database: a "+" icon in the sidebar "Databases" header opens a 280px panel (name, optional emoji, Create database), replacing the old header button.
- Empty state uses `sample_data.png` and the prototype copy. Offline matched without changes.

### Databases: Title menu, frozen columns, groups (T3.28, T3.29)

- Title is a synthetic `title` id in sort/group/calc/freeze/wrap/filter/insert. Its menu drops Change type, Edit options, Hide, Duplicate and Delete, and adds "Show page icon".
- "Show page icon" is a per-browser preference (`localStorage` `hitlist.db.hidePageIcon`), not a per-view setting.
- Freeze no longer moves the column: Title and every column up to the frozen one stick at `--tbl-inset` (16px, 48px from md) plus the widths before them.
- A text column holding a URL still renders as plain text (no URL column kind), so the prototype's blue "Link" cells differ.

### Databases: record peek (T3.27)

- Opened from the Title cell's page icon (now a real "Open <title>" button). Reuses the table's `FieldCell`, so a property edits exactly as in the table; a date and a number read in the body font there, and a single select drops its dot, as in the prototype.
- Left out on purpose: the prototype's "Write something, or press “/” for blocks…" line. A record has no body to store, so it would be a dead field. Revisit with a stored record body (needs an additive migration).
- Title is 32px, not the prototype's 34px (outside the closed type scale). The trash button asks a second time ("Delete for good"); the prototype deletes at once.
- Board cards do not open the peek yet; the prototype only opens it from the table.

### Notes: editor, slash menu, mention card, empty state (T3.33–T3.36)

- Type scale is the prototype's: body 14px, headings 24 / 20 / 16 at weight 600 (the display face is gone from notes), quote 15, code 12 on an ink panel, table cells 13. The quote's 15px is outside the closed scale and carries a `design-check-ignore`. Title is 32px, not the prototype's 34; the note icon is 32px, not 30.
- Lists have no space between items, a to-do's text starts 26px in (16px box + 10), a list item's 22px, a callout's icon is a line lightbulb when it is the default 💡 (a chosen emoji still shows as the emoji).
- A callout's default tone is the prototype's grey; the sage tone stays as the one alternative.
- The linked-task chip reads "Schedule · Work · Oct 2" (quadrant · list · due) and follows the text, which is sized to its content with `field-sizing: content` — a browser without it (Firefox, older Safari) puts the chip at the row's far edge.
- Tables fill the column (stored column widths act as proportions once they add up to less than it). The prototype's per-column type icon and "text" caption are left out: a note table has no column types, so they would be decoration.
- The sidebar keeps its Search notes box (the global Search row is still a placeholder); it sits under the "Notes" header, and is hidden when there are no notes. "Pinned" comes first, as in the prototype.
- The note toolbar shows the sync state as a DS Badge ("Saved" when idle) and "New", always.
- The mention card is one panel (quadrant grid, List select, Cancel, Add task) with Schedule and the open list preselected; arrows move the quadrant, ↵ adds, Esc closes. What was typed after "@" preselects a quadrant or list it starts. This replaces the three-column cascade the docs described — the docs described the app, not the prototype.
- The slash menu's Database group (Create database / board / linked view) is not rendered: it belongs to T4.8.
- The prototype's blocks-count reads 12 for the sample note because it counts a list as one block; the app counts every item.

### Calendar: month, add-on-a-day, offline (T3.37–T3.39)

- The week starts on Sunday, as in the prototype (it was Monday). `monthWeeks` changed with it.
- The grid sits in one bordered 8px card under a grey weekday band; cells are 104px with hairlines right and below, a 22px day pill (today filled in the brand colour, days outside the month in `--a-disabled`), and 12px chips: 6px source dot, title, tinted red when an open task's day has passed, tertiary and struck through when done.
- The Sources on/off chips above the grid are gone: the sidebar's "Sources" rows (dot, name, mono count) now do the switching (`aria-pressed`), as the prototype lists them there. The Zoho "unavailable" copy stays in the sidebar under "What's on it".
- "Add on a day" is the ghost page action (defaults to today); a day's hover "+" is kept for picking another day. The 300px dialog hangs from whichever button opened it, not from a fixed spot as in the prototype. Its Add button stays disabled until there is a title.
- The "Not on a date" panel is a dashed row of Tags under the grid, and is still the drop target for taking a date off. The count is mono.
- Offline: the DS EmptyState with schedule.png. The subtitle count is hidden and the page action is inert rather than hidden.
- Scratch seed now creates the Work / Personal lists, assigns every task to one, and points Reading list at its Finished column, so the calendar has sources.

### Shell overlays (T3.40–T3.42)

- Notifications is a Popover (role dialog): "Notifications", "Mark all read" (it dismisses every reminder), one row per reminder — missed first — with a red or orange dot and "Missed · 2h ago" / "Upcoming · due in 25 minutes". The prototype's "was due Sun, 5:00 PM" needs the due time, which a reminder record does not keep. The unread count badge on the bell stays; per-row go-to-task and dismiss show on hover.
- Account menu: no "Sign out" (there is no sign-in; data belongs to the browser). "Keyboard shortcuts" opens a dialog listing only shortcuts that exist.
- Row menus (`shell/RowMenu.tsx`): notes and saved views use it. The prototype's Add to Favorites, Duplicate, Copy link, Rename-by-shortcut, Open in new tab and its keyboard hints are not offered — they depend on Phase 4 features or do not exist. Lists keep their inline rename/delete icons.

### Phase 4: palette and dead controls (T4.2, T4.5)

- ⌘K searches lists, databases, notes and tasks by title (every word must appear; a title starting with the query ranks first; six per group). Notes are read from local storage, databases from the API when it opens. It is a Dialog, 560px, 12px radius, 28px rows.
- The header Help button opens a menu with Keyboard shortcuts; the shortcuts list now includes ⌘K. The sidebar's workspace chevron is gone until there is more than one workspace.
- `design:check` rule `dead-control`: a `<button aria-label>` with no `onClick`/`type="submit"`/prop spread fails, except as a Radix `Trigger` child or a menu's `trigger` prop.

### Phase 4: reminders (T4.3)

- A task stores `reminderEnabled` and `reminderMinutesBefore` (0–1440). An update that does not mention them leaves them alone; only an explicit `reminderEnabled: false` switches one off. Rows written before this all hold false/0, so nothing needs migrating. The importer still refuses reminder data (unchanged).
- The task detail panel has a Reminder select (Off, 5 min … 1 hour, from `REMINDER_OPTIONS`), disabled until the task has a due date; it starts at the default lead time set in Account → Reminders. This control is not in the prototype: reminders there live in the Automations rule form (T4.4).
- Account → Reminders opens the existing `RemindersSettingsPanel` in a dialog (browser permission, default lead time). Its own styling is still the older look; restyle it if it is kept.
- `useNotifications` is mounted in `App`, so browser notification timers now run for tasks with a reminder once permission is granted.
- The API's contract tests are flaky on `browserSessionsCannotReadEachOthersDataOrChooseAnOwnerHeader` (it flips the last base64 character of a cookie, which is sometimes a no-op); it passed on three full reruns.

### Phase 4: library, favorites, recents (T4.1)

- Storage is two generic-store tables (`KaizenFavorites`, `KaizenRecents`), keyed `kind_pageId`, so starring or visiting twice is one row. Nothing existing is touched (additive; no migration). Recents keep the newest 20; favorites cap at 200.
- Whatever page is on screen is recorded as a visit (a task list, a note, a database). The client keeps a local copy of the last answer for offline.
- The library has no "Created by" column (there is one user) and no Filter / Properties buttons (nothing to filter or choose); Search pages is real. "Source" is a link to that kind's view. Last edited is known for notes and databases only; a list shows "—".
- New page → Note / Database opens that view and makes an "Untitled" one; Task list makes "Untitled list".
- The prototype's Notion-style Favorites row menu also offers Duplicate, Copy link, Rename, Move to Trash, Open in new tab; only Add/Remove Favorites and Remove from Recents are offered (see Shell overlays).
- The API contract test `browserSessionsCannotReadEachOthersDataOrChooseAnOwnerHeader` no longer flips the last base64 character of the cookie (sometimes a no-op, so the test was flaky); it flips a middle one.

### Phase 4: automations (T4.4b–e)

- **The decision:** you chose a working engine over mirroring the prototype's disabled state, so the screens differ from `auto-list` / `auto-form` in three places on purpose: the banner says rules run while HitList is open (not "unavailable"), Run now and the Switch work, and Recent runs shows real rows.
- **What fires, and when:** due-date rules at each signed offset from the due time (up to 5 steps; the server refuses more), recurring schedules (daily, weekdays, weekly, monthly), a daily digest ("N due today · M overdue"), and status changes (found by comparing with the statuses seen at the last sweep, so the first sweep only records). Each moment fires once, never before the rule was created, and a moment more than 2 hours old is dropped rather than delivered late. Times are read in the browser's zone, which the client sends with the rule (the server's zone if absent).
- **Only while the app is open.** The sweep is a scheduled job inside the API; nothing fires while it is not running.
- **Delivery:** in-app becomes a server notification the bell already reads; browser is recorded on it and raised by whichever tab is open, once, if permission was granted; email is not configured, so a rule that asks for it is recorded as SKIPPED with that reason.
- The rule form has no Description or Initial status field (the prototype has neither): a new rule is active, an existing rule's description and status are kept when it is edited, and the list's Switch pauses and activates.
- `MAX_STEPS` is 5, matching the prototype's "up to 5" and the server.
- Two icons on a rule row (edit, delete) appear on hover; they are not in the prototype.

### Databases inside notes (T4.8)

- A note block of type `database` holds `databaseId` and `dbLayout` (additive optional fields; the server stores blocks as opaque JSON, so no migration). The block only points at a database: removing it never removes the database or its records.
- "Create database" makes a real database now (Name, Tags, Status, Date and three "Untitled" records, the prototype's blank one); "Create board" adds a "By status board" view and opens on it; "Linked view of a database" picks an existing one. Those are the slash menu's Database group (the prototype names a specific database, "Linked view of Reading list"; the menu says "of a database" and the picker lists them).
- The block is the Databases page's own workspace (`DatabaseWorkspace`, extracted from the page for this): the same tabs (the database's saved views), toolbar, column menus and peek. In a note the table stays in the note's column instead of running edge to edge.
- Records made with Create database are titled "Untitled" (the server refuses an empty title); the prototype greys an empty title as a placeholder.
- The tabs the prototype shows ("Needs revisit", "All books") are its sample views; the block shows the database's own.

## Phase 5 — what each accepted improvement spends

Everything below deliberately stops matching the prototype. Each entry says where.

### P5.7 Empty states
- A task list that is empty now says why: never had a task ("Start with one task", or "Nothing in X yet" when other lists have some); tasks hidden by filters (the prototype's "No tasks match these filters"); everything finished ("Everything in X is done", the happy mascot, Add task and Show completed). Before, finishing every task showed the filter message, which was wrong.
- Each matrix quadrant has its own empty line instead of "Nothing here. Add a task to …". Spends: `tasks-matrix` empty quadrants, `tasks-empty`.

### P5.3 Data quality on tasks
- The task table's Due column and every custom-field column get the Databases fill bar (3px, valid over missing) with a tooltip "N of M have a value". Status and Quadrant always have a value, so they get none; the bar counts what the table shows (done tasks only with "show completed").
- A quiet chip in the top bar, "N tasks have no due date" (open tasks only), applies the existing "No date" filter; it disappears once that filter is on or nothing is missing. It is not a banner and cannot be dismissed, because it goes away by itself. Spends: `tasks-table` header, every tasks top bar.

### P5.6 Note ↔ task links
- The chip already showed a task's quadrant, list, done state and (since the notes pass) due date, and a task already links back to its note. What was missing is what a note says about them: its meta line now reads "3 of 7 linked tasks done" (green when all are), counted live from the tasks; and a line whose task is done is struck through and faint like a done to-do, so the note stops looking unfinished. A task deleted elsewhere counts for nothing. Spends: `notes-editor` meta line, linked lines.

### P5.5 Density
- Account menu → Density: Compact, Standard (the prototype, and the default), Roomy. One variable, `--a-density` on `<html>` (−2px / 0 / +4px), is added to the padding of the row-shaped content surfaces — task list rows (min height 40 / 44 / 52), matrix rows, board cards, the task table's and the database table's cells. Type size does not change, and the shell (sidebar, top bar, menus) stays at the prototype's size. The density mock-ups in the design bundle also changed type size; that is not done here because sizes are not all token-driven yet. Spends: every content row at Compact and Roomy; Standard is unchanged.

### P5.4 Keyboard-first table and board

- Keys: `j`/`k`/↑/↓ move between tasks, `h`/`l`/←/→ across cells (table) or columns (board), ↵ edits the cell (clicks its first control) or opens the card, `o` opens, `x` toggles done, `[` `]` move the task one quadrant (Do → Eliminate), Esc clears the cursor.
- Spends: one new visual state, a 2px brand-colour ring on the cursor cell or card (`--a-accent`). No new tokens, sizes or motion.
- Scope: the task table and board only. Keys are ignored while typing, in a menu/listbox/dialog, with any modifier, and for ↵ on a focused button. The notes editor is untouched.
- `[` `]` on the board needs `onQuadrantChange` (App passes it, undoable); drag still works unchanged.
- Not shot-paired: the prototype has no cursor state; verified by unit tests (`taskKeyboard`, `useTaskKeyboard`).

### P5.1 Today
- A new first row in the sidebar nav, "Today" (Sun icon), and the landing view on a fresh open. A refresh or Back carries a history entry and keeps the screen. The matrix and the other layouts stay under Tasks; Today's top-bar button "Plan in the matrix" goes there.
- Ranking (`lib/today.ts`, across all lists): overdue, then in progress, then quadrant (Do first → Eliminate), then soonest due, then hand order. Nothing new is asked of the user.
- Layout: greeting line; the next task in a 12px-radius card (quadrant badge, list, due text, title 24px display; Start / Mark done / Open); "After that" lists the next two; "N overdue" expands the overdue tasks inline; "N more open" goes to Tasks. Nothing open → the happy-mascot empty state.
- Spends: one new view and nav row. All tokens, sizes and motion are existing ones. No prototype counterpart, so not shot-paired; covered by `today.test.ts` and `TodayPage.test.tsx`.
- Stored shape: nothing new. `hitlist-active-view` may now hold `today`; older values still load.

### P5.2 Daily line
- One line above the plan on Today: "Yesterday you finished 3 tasks. Today's one thing: <next task>." It shows while the preference is on and it has not been dismissed today; × dismisses it for the day, "Turn off" switches it off for good, and Account → "Daily summary on Today" switches it back on. Preference `hitlist-daily-line` (default on) and last-dismissed day `hitlist-daily-line-seen` live in localStorage, per browser.
- Not a modal or toast, no animation, no streak or celebration. An empty yesterday is left out rather than called out.
- Spends: one tinted 8px-radius strip and one Account-menu checkbox item. Covered by `dailyLine.test.ts` and `TodayPage.test.tsx`; no prototype counterpart.

## Phase 6 — what each accepted improvement spends

### P6.1 Quick capture
- `c` (when nothing is being typed into) or ⌘/Ctrl+⇧+N opens a 560px, 12px-radius dialog shaped like the ⌘K palette: one input, and under it a live line showing the title, date, time, quadrant and list as they will be saved. ↵ adds; Esc closes.
- Language: today / tonight / tomorrow, weekday names (the next one, never today), "in N days/weeks", "oct 5" / "5 oct" (rolls to next year once passed), YYYY-MM-DD; "3pm", "3:30pm", "at 9am", "15:30" (a time alone means today); `!do` `!schedule` `!delegate` `!eliminate`. Anything else stays in the title; with nothing left, the line is kept as the title. No quadrant tag means Do first, the same default as the board's "+ Add".
- Spends: one dialog. No schema change, no new tokens. Covered by `quickCapture.test.ts`, `QuickCapture.test.tsx`; no prototype counterpart.

