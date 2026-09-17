# A local-first Mac desktop build — is it possible, and can one change cover both?

Written 16 September 2026, after reading the repo as it stands at `eacee95`.

Short answer to both questions: **yes to the desktop app, and yes to one
codebase — but only if you do one refactor first, and you should check the bill
before doing any of it.** The refactor is worth doing whether or not you ship a
desktop app, because the divergence it prevents is already happening.

---

## 1. Check the bill first — this may be a non-problem

`[UNVERIFIED]` I cannot see your Catalyst invoice, and nothing in the repo
reveals it.

Before spending weeks on this, look at what you are actually being charged.
HitList today is **one user with a few hundred rows**. Your own
`docs/catalyst/03-datastore.md` records the development-environment caps as
5,000 rows per table, 25,000 per project and 25 app users — you are nowhere near
them. The recurring cost of a solo workload is likely to be zero or close to it.

If the bill is in fact near zero, then "server cost" is not the reason to build
a desktop app — and you should decide on the real reasons instead, which are
good ones:

- **Speed.** No network on the critical path. Every read is local.
- **It works on a plane, in a lift, on hotel wifi.** Today the tasks path falls
  back to `mockApi` on a network error and **never promotes back** to the server
  until reload (`useCatalystSync`), so flaky connectivity is already a rough
  experience.
- **No login.** `CatalystAuthGate` currently stands between you and your own
  task list.
- **Your data sits in a file you own**, not in someone's datastore.
- **macOS local notifications** are genuinely better than web push for
  escalation — see §6.

Those justify the work. "Saving $0/month" does not. Decide on the honest reason,
because it changes what you build: cost-driven means *replace* the server,
speed-and-offline-driven means *add* a local store and keep the server for what
only a server can do.

---

## 2. Where you actually are — better and worse than you'd think

**Better:** the abstraction you need exists in two places already.

- **Server:** `catalystAvailable` switches between Catalyst and JSON files. The
  JSON-file path is not a toy — `readJson` quarantines a corrupt file to
  `<name>.corrupt.<ts>` rather than returning empty, and `writeJson` does
  `mkdirSync` + a per-process-unique temp name + `fsync` + atomic `rename` +
  `fsync` of the directory. Somebody thought about durability.
- **Client:** `useCatalystSync` holds `REAL` and `MOCK` behind one `Backend`
  type, and `mockApi.ts` is a real localStorage **write** path, not a read-only
  cache. Offline is already a first-class mode for tasks.

**Worse:** that dual-backend story covers **3 of your 11 tables**.

| Table | JSON-file / local support |
|---|---|
| `KaizenTasks` | ✅ full |
| `KaizenLists` | ✅ full |
| `KaizenNotes` | ✅ full (and already local-first — the server is never read) |
| `KaizenViews` | ❌ Catalyst only |
| `KaizenPropDefs` | ❌ Catalyst only |
| `KaizenTaskProps` | ❌ Catalyst only |
| `KaizenAutomationRules` | ❌ `503 datastore_unavailable` |
| `KaizenNotificationQueue` | ❌ `if (!catalystAvailable) return;` — no queue at all |
| `KaizenNotifications` | ❌ returns `[]` |
| `KaizenAutomationRuns` | ❌ returns `[]` |
| `KaizenTrialFeatures` | ❌ returns `ALL_ENABLED` |

`server/views.ts` contains **no JSON-file path whatsoever** — no
`catalystAvailable` check, no `readJson`. Same for `server/fields.ts`. And
`mockApi.ts` exports only `mockTaskApi`, `mockListApi` and `mockStatsApi` —
there is no `mockViewApi` or `mockFieldApi`.

So **if you ran HitList with no Catalyst credentials today**, you would get
tasks, lists and notes — and lose saved views, custom fields, every layout that
groups by a field, all automations, all reminders, all escalation, and the
notification inbox. That is essentially everything you have built in the last
two weeks.

---

## 3. The real problem, which is not the desktop app

**You already maintain the same logic twice, and it has already drifted.**

Task filtering exists in `server/notes-server.ts` (`GET /api/tasks`) and again
in `src/lib/mockApi.ts`. They do not agree, and the code says so out loud:

```ts
// src/lib/mockApi.ts:102
// priority is not stored on the local Todo type; skip filtering in mock fallback
```

This is the same failure your own `server/catalyst/schema.ts` header was written
to record:

> Previously the schema lived in three places that had already drifted: a doc
> comment at the top of notes-server.ts, a hardcoded column list used by the
> runtime column provisioner, and the browser Web SDK client, which used the
> column name TaskPriority where the server used Priority.

That lesson was learned for the *schema*. It has not yet been applied to the
*logic*. There are **33 `executeZCQLQuery` call sites across 10 server files**,
with no repository or storage interface between them and the domain code:

```
notes-server.ts 9 · queue.ts 6 · rules.ts 4 · runs.ts 3 · fields.ts 3
inbox.ts 3 · views.ts 2 · taskTriggers.ts 1 · trialFeatures.ts 1 · types.ts 1
```

**Adding a desktop target on top of that gives you a third implementation to
keep in sync, and it will drift the same way within a month.** That is the thing
to fix, and it is what makes your "change it once, it reflects everywhere"
requirement achievable rather than aspirational.

---

## 4. The architecture that makes one change cover both

The principle: **storage is the only thing that varies.** Everything above it —
validation, filtering, sorting, the Eisenhower bucketing, the automation engine,
recurrence, the sweep, dedupe keys, claim tokens — is written once and runs
unchanged in both targets.

```
              ┌──────────────────────────────┐
              │  React app  (src/, 28.6k LOC)│   unchanged, both targets
              └──────────────┬───────────────┘
                             │ HTTP to localhost or to AppSail
              ┌──────────────┴───────────────┐
              │  Express app + domain logic  │   unchanged, both targets
              │  routes · validation · rules │
              │  automations/ · notifications/│
              └──────────────┬───────────────┘
                             │  Store interface   ← the only new seam
                ┌────────────┴────────────┐
        ┌───────┴────────┐        ┌───────┴────────┐
        │ CatalystStore  │        │  SqliteStore   │
        │ (ZCQL, today)  │        │  (local file)  │
        └────────────────┘        └────────────────┘
             web / hosted              Mac desktop
```

The `Store` interface is narrow, because every one of those 33 call sites is
doing one of about six things:

```ts
interface Store {
  insert(table: string, row: Row): Promise<{ rowId: string }>;
  update(table: string, rowId: string, patch: Row): Promise<void>;
  delete(table: string, rowIds: string[]): Promise<void>;
  findById(table: string, idCol: string, id: string, ownerId: string): Promise<Row | null>;
  query(table: string, q: Query): Promise<Row[]>;   // where + order + limit + offset
  count(table: string, q: Query): Promise<number>;
}
```

Two things this buys you beyond the desktop app, which is why I'd do it anyway:

1. **The 300-row and 20-column ZCQL caps** (see `notion-parity-plan.md` §0.2)
   get enforced and paged in **one** place instead of being re-fixed at 33 call
   sites. A `SqliteStore` has neither cap, so the ceiling stops being a
   whole-app design constraint and becomes one adapter's problem.
2. **`mockApi.ts` can be deleted.** With a local store behind the same HTTP API,
   the client stops needing a second implementation of filtering at all, and the
   drift in §3 disappears rather than being managed.

**SQLite, not JSON files,** for the local store. Your JSON-file backend is
careful but it states its own limit — *"Two servers on the same files will still
lose each other's updates"* — and every handler is a full read-modify-write of
the whole file. SQLite gives you real indexes (so `FireAt <= now` stays cheap),
transactions (so `DELETE /api/lists/:id`'s currently non-atomic unbounded
cascade becomes atomic), and no row cap. `better-sqlite3` is synchronous and
fast; the `Store` interface stays `async` so the Catalyst adapter is unchanged.

---

## 5. Electron or Tauri

**Electron, for your specific situation — and the reason is your Express server.**

| | Electron | Tauri |
|---|---|---|
| App size | ~120–180 MB | ~10–20 MB |
| Main process | **Node** | Rust |
| Runs `notes-server.ts` as-is | **yes, unchanged** | no — needs a Node sidecar binary, or a Rust rewrite |
| Memory | heavier (own Chromium) | lighter (system WKWebView) |
| Mac look and feel | good | better |
| Rendering differences vs your web build | none — same Chromium | WKWebView; Tailwind v4 and modern CSS mostly fine, but you'd be testing two engines |

Tauri produces the nicer Mac app. But it cannot run your 8,533 lines of Express
and TypeScript server in its main process, and the two ways around that are a
bundled Node sidecar (extra build complexity, and you ship a Node binary anyway
so the size advantage narrows) or rewriting the server in Rust (which would
duplicate all the logic you are trying not to duplicate — the exact thing you
asked to avoid).

With Electron the desktop app is, approximately:

- **main process:** `import './server/notes-server.ts'` with
  `STORE=sqlite`, listening on a random localhost port
- **renderer:** the existing `vite build` output, pointed at that port
- **new code:** an Electron entry file, a builder config, and the `SqliteStore`

Your React app needs **zero** changes — it already speaks to a relative
`/api/*` base URL.

Revisit Tauri later if size becomes a real complaint. Nothing in this plan
blocks a swap, because by then the app is "a web build plus a local server" and
the shell is the least interesting part.

---

## 6. What still genuinely needs a server

Being clear about this stops you building a desktop app that quietly loses your
best feature.

| Capability | Works purely local? |
|---|---|
| Tasks, lists, notes, views, fields, all layouts | ✅ yes, entirely |
| The sweep, queue, claim tokens, dedupe, recurrence | ✅ yes — it is plain TypeScript over a store, and the `setInterval` driver already exists |
| **Reminders while the app is running** | ✅ yes, and **better** than the web version — native macOS notifications through Electron's `Notification`, no service worker, no browser permission dance |
| **Reminders while the app is closed** | ⚠️ only with a macOS `launchd` LaunchAgent running the sweep in the background. Doable, but it is real work and it is the piece people underestimate |
| **Email escalation** | ❌ needs a sender. Catalyst's `sendMail`, or SMTP credentials on the machine |
| **Sync between your Mac and your phone** | ❌ needs a server, by definition |
| **Web push** | ❌ n/a — replaced by native notifications, which is an upgrade |

**This is the fork that matters.** Your genuine advantage over Notion is
escalation — a reminder that keeps getting louder. A desktop-only build gives
you that *while the app is open*, which for a Mac you leave running all day is
most of the value. But "email me if I still haven't done it after 30 minutes"
needs something that is awake when you are not.

So I would not frame this as **desktop instead of server**. I would frame it as:

> **Local SQLite is the source of truth. The server becomes optional, and does
> only the two things a local app cannot: delivery you can't do yourself, and
> sync between devices.**

That is a much smaller server than the one you run now — and if you ever do want
to cut the bill, a delivery-and-sync-only service is far cheaper than a full
datastore, because it stores almost nothing.

---

## 7. A staged path

Each stage is shippable and none of it is wasted if you stop early.

**Stage 1 — Extract the `Store` interface. No desktop app yet.**
Move the 33 ZCQL sites behind it, implement `CatalystStore` first, verify the
web app is byte-for-byte unchanged in behaviour. *Effort: medium-large, ~1–2
weeks of evenings. Value on its own: the 300-row cap gets fixed in one place.*

**Stage 2 — `SqliteStore`, still headless.**
Run `pnpm server` with `STORE=sqlite` and exercise the whole API against it.
Your existing Vitest suite is the proof — it should pass against both adapters,
and that test-both-adapters rule is what mechanically prevents the drift in §3.
*Effort: medium. Value: the JSON-file fallback gets replaced by something real.*

**Stage 3 — Electron shell.**
Entry file, builder config, native notifications, app icon, `.dmg`. The React
build and the server are both unchanged. *Effort: small-medium — this is the
part that feels like the whole project and is actually the smallest.*

**Stage 4 — Decide about the server.**
With stages 1–3 done you can honestly compare: keep Catalyst for sync and email,
or drop it and accept app-must-be-open reminders. **Make this decision with the
app in your hands, not now.**

**Stage 5 (optional) — sync.**
The hard one. Two devices editing offline needs conflict resolution, and your
current answer is last-write-wins on `updatedAt` with a client-supplied clock —
which means a device with a skewed clock can pin a note permanently. Do not
start here.

---

## 8. Honest estimate and the one risk

Stages 1–3: **roughly 3–6 weeks of solo evenings.** Stage 1 is most of it, and
Stage 1 is the part that has value even if you never ship the desktop app.

**The risk worth naming:** this competes directly with the build plan in
`notion-parity-plan.md`. You are mid-flight on that — saved views, custom
fields, board/table/calendar layouts all landed in the last two weeks. Stopping
to re-plumb storage now means those features sit unpolished while you refactor
underneath them, and refactoring under half-finished features is how you get
both half-finished.

My suggestion: **finish the layout work you have in flight, then do Stage 1**,
because Stage 1 is also the clean way to fix the 300-row ceiling that plan needs
anyway. Do not start Stage 1 this week.

---

## What I could not verify

- `[UNVERIFIED]` Your actual Catalyst bill. §1 — this decides whether cost is a
  real driver or a phantom one, and it is a two-minute check that could save
  weeks.
- `[UNVERIFIED]` Whether the Vitest suite passes against a non-Catalyst store
  today. `src/test/helpers/fakeCatalyst.ts` exists, so the seam is partly there
  already — worth reading before designing `Store`, since it may already be the
  right shape.
- `[UNVERIFIED]` Whether Catalyst's email sender can be used from a desktop app
  without the AppSail gateway supplying credentials per request. `channels.ts`
  gets its app from the request context; a desktop build has no such request.
