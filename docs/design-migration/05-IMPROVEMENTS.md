# Phase 5 — Improvements beyond the design

**Nothing in this file is approved.** Each entry is a proposal to accept or reject.
They are held until Phase A (fidelity) closes, so that "matches the design" stays a
checkable claim right up to the moment we deliberately stop matching it.

**The brief.** Copy the design exactly, then *"improve the UI better such that no user
gets bored and they should use it every day"*, with Notion as the reference product to
beat.

**The honest starting position.** HitList will not beat Notion at being Notion — Notion
has a decade of head start on blocks, sharing and databases. It can beat Notion at
something Notion deliberately has no opinion about: **deciding what to do next, and
coming back tomorrow.** Notion will happily let you maintain a 400-row task database
and never tell you which row matters. Every proposal below leans on that gap, and on
capability the app already has but buries.

Each proposal states what exists today, so none of them is a rewrite dressed as an idea.

---

## P5.1 — Make the daily decision the front door

**Already built** `App.tsx` computes `nextId`; the matrix and list render a brand
`Badge` reading "Next up" on exactly one task. `lib/quadrantBuckets.ts` has
`compareTasks`. `lib/dueInfo.ts` has due tone logic.

**The gap** That signal is one small badge inside a grid of four panels. The app opens
to a grid, which is a *browsing* surface, and asks you to decide for yourself.

**Proposal** A "Today" surface as the default landing view: the one next task, large;
the two after it, small; everything overdue, counted and one click away. The matrix
stays — it becomes the planning view rather than the opening view.

**Why Notion cannot copy it** Notion has no priority model. Eisenhower quadrants are
already first-class here, so the ranking is derivable without asking the user for
anything new.

**How we'd know** Median time from app open to first status change goes down.

---

## P5.2 — Promote momentum from sidebar furniture to a reason to return

**Already built** `MomentumBar.tsx`, `StreakPanel.tsx`, `TodayHistoryPanel.tsx`, and a
real `/api/stats/momentum` endpoint. Phase 2's T2.3 gives the card its designed
treatment (flame, streak, blue track).

**The gap** It sits at the bottom of the sidebar, below the fold on short windows, and
the streak has no consequence.

**Proposal** A once-a-day moment: on first open each day, a small, dismissible line
that names yesterday's result and today's one thing. Not a modal, not a celebration
animation — the DS forbids bounce and decorative motion, and a daily tool that
congratulates you loudly gets muted fast.

**Risk** This is the proposal most likely to become annoying. If accepted, ship it
behind a preference that defaults to on and is one click to turn off forever.

---

## P5.3 — Data quality, applied to tasks

**Already built** `RecordTable.tsx:63` `fillCount` computes per-column fill, and the
design renders it as a 3px bar under each Databases column header (T3.17). The DS calls
`DataQualityBar` its hero component.

**The gap** Tasks get none of it. Nothing tells you that 40% of your tasks have no due
date, which is exactly why they never get done.

**Proposal** Apply the same valid/missing bar to task properties, and surface one
derived prompt — *"18 tasks have no due date"* — as a filter chip, not a nag.

**Why it fits** It reuses the DS's most distinctive visual and the existing computation.
Notion shows you empty cells; it never tells you that the emptiness is the problem.

---

## P5.4 — Keyboard-first for the table and board

**Already built** T4.2 adds ⌘K. `TaskTableView.tsx` already edits every cell in place.

**The gap** Beyond ⌘K, everything needs a mouse. Notion's database views are
mouse-heavy too — this is a winnable comparison.

**Proposal** Arrow-key cell navigation, Enter to edit, Tab to commit and move, `j`/`k`
row movement, `x` to toggle status, `[`/`]` to change quadrant. Scope it to the table
and board only; the notes editor has its own key handling and should not be touched.

---

## P5.5 — Let people choose their density

**Already built** Nothing — but the design bundle contains the explorations:
`Density A - Compact.dc.html` (8/12px padding, 14px), `Density B - Standard.dc.html`
(12/16px, 15px), `Density C - Roomy.dc.html` (16/16px, 15px). The prototype we are
implementing is tighter than all three.

**The gap** Phase A commits the whole app to one density, chosen by the designer, at
13px base. That is right for a data tool and wrong for a laptop at arm's length.

**Proposal** A three-way density preference driving the `--a-space-*` and `--a-text-*`
scales. This is only cheap **if** T1.7 landed properly and every size is on-scale — it
is the direct payoff for that task. If sizes are still ad hoc, this is not affordable.

**Depends on** T1.7 being genuinely clean, verified by `pnpm design:check`.

---

## P5.6 — Make the note↔task link bidirectional

**Already built** `Todo.sourceNoteId`, `notes/LinkedTaskChip.tsx`,
`notes/MentionMenu.tsx`'s @-to-quadrant flow, and a "Note" back-link on task rows. The
@ flow — turn a line in a note into a task in a chosen quadrant — is already a genuine
differentiator; Notion needs a database relation to do it at all.

**The gap** The link is one-directional in practice. A note does not show which of its
lines became tasks that are now done, so the note goes stale and you stop trusting it.

**Proposal** Live task state rendered inline in the note — the chip already exists,
give it status and due — plus a per-note roll-up: *"3 of 7 tasks from this note are
done."*

---

## P5.7 — Say the right thing in empty states

**Already built** T1.10 gives every empty state its mascot illustration and the
prototype's copy.

**The gap** The prototype's copy is written for a screenshot, not for a specific user.
A first-run empty state and a you-just-cleared-everything empty state are very
different moments and currently read identically.

**Proposal** Branch on why the state is empty: never had any / filtered to nothing /
finished everything. The third one is the good news a daily tool should actually
deliver. Stay in the DS voice — sentence case, verbs first, no emoji, warm but
directive.

**Cheapest item here.** Copy only, no new components.

---

# How to run Phase 5

1. Read this file with the user and mark each proposal **accepted / rejected / later**. That decision goes in `00-INDEX.md`.
2. Each accepted proposal is then *planned* as its own task set in the Phase 1–4 format — why, spec, files, accept, verify — before any code.
3. Once a proposal is accepted, the prototype is no longer the authority for that surface. Record the deviation in `CONVENTIONS.md` so `design:check` and future screenshot comparisons do not flag it as a regression.

**The one rule.** Phase A's value is that fidelity is checkable. Every accepted
improvement spends some of that. Spend it deliberately, one proposal at a time, and
write down what was spent.
