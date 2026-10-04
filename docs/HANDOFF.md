# HitList: current state and flows (handoff)

Written 2026-10-04 for whoever continues the work (a person or an AI assistant). It describes what exists **now**, how it fits
together, what is finished, what is not, and the rules the owner insists on. Read this first, then the guides it links to.
It contains no secrets and must never get any (setting names only).

## 1. What HitList is
A tasks / notes / databases app. **The product is the desktop app** (Electron + a bundled Java server + local SQLite). Tasks live on
each person's computer and it works offline. Catalyst (Zoho's serverless platform) is used only for: sign-in, cloud backup, the Cliq
integrations, and shared workspaces. The web/AppSail path is being retired in favour of a static download page (`client/index.html`);
**do not stop the AppSail until the owner confirms the desktop tests**.

Repository: GitHub `Aazhii/HitList` (public). Working branch `master`. The owner pushes; **do not push without being asked**.

| Folder | What |
|---|---|
| `web/` | React + Vite + TypeScript UI. Design rules enforced by `pnpm design:check`. Tests: Vitest. |
| `api/` | Spring Boot 3 / Java 25 server. Local SQLite on desktop (Postgres/Catalyst mode exists for the old web path). Tests: JUnit via Maven. |
| `desktop/` | Electron shell: starts `hitlist.jar` on a random 127.0.0.1 port, injects account headers, backup/restore/Cliq/update/workspace engines. Tests: `node --test`. |
| `functions/backup/` | Catalyst Advanced I/O function "backup" (Node 20): backups, Cliq alerts + inbound, shared workspaces. |
| `functions/cliq-webhook/` | Second function: receives the Cliq bot's webhook (secret-authenticated). Prepared by `prepare.js`. |
| `client/` | Static pages deployed to the Catalyst web client: `index.html` (download page), `invite.html` (workspace invite helper). |
| `docs/` | Guides. This file, `INSTALL.md`, `building/`, `cliq/`, `workspaces/`, `desktop-first/`, `design-migration/`. |
| `scripts/` | `deploy-backup-function.sh`, `ci/compute-version.sh` (+tests). |
| `.github/workflows/build-desktop.yml` | Builds Mac/Windows/Linux, runs all tests, optionally publishes a GitHub Release. |

## 2. Identity and data (read before touching anything)
- **Owner partition.** Every stored row has an `owner_id` (a 43-char base64url string). All services take `owner` and scope by it
  (`EntityRepository`). Table `hitlist_storage_rows(row_id, table_name, owner_id, entity_key, data JSON, created_at)`, unique on
  `(table_name, owner_id, entity_key)`.
- **Desktop mode** (`AUTH_MODE=desktop`): the shell generates a per-launch `DESKTOP_TOKEN` and names the signed-in account with
  headers `X-Hitlist-Desktop-Token`, `X-Hitlist-Desktop-Owner` (= base64url(sha256("catalyst:"+userId))), `X-Hitlist-Desktop-User`
  (the Catalyst user id), and, for a shared workspace, `X-Hitlist-Workspace`. Without the token the headers are ignored (cookie
  workspace). `OwnerSessionFilter` + `OwnerResolver` do this.
- **Sign-in is optional.** The app works without an account. Signing in uses Catalyst hosted auth in a window; the shell stores
  `{userId,email}` in `account.json`. The uncommitted account-isolation changes stop automatic claiming of anonymous rows and
  legacy caches. Identity is established before mounting content hooks; personal/shared task caches are separate. See
  [the account-isolation audit](desktop-first/02-ACCOUNT-ISOLATION.md) for logout ordering and validation evidence. Unknown-origin
  data stays separate rather than being assigned to the next account. Existing mixed data is not automatically repaired.
- **Data folder.** Installed app and `pnpm start` share `~/Library/Application Support/HitList` (Windows `%APPDATA%\HitList`, Linux
  `~/.config/HitList`). A one-time COPY from the legacy `hitlist-desktop` folder happens only if `HitList` has no database.
- **Never lose data.** Any change to a stored shape needs an additive, safe migration. Imports/restores only add. A task already
  present under another id (same title, list, due day, quadrant) is not added again (counted, so real repeats still come in).
  The local-storage migration skips cards still being saved (`temp-` ids), treats a same-text server task as that task, and never
  resurrects a task it already moved and the server since deleted.

## 3. Flows

### 3.1 Backup and restore
Every 3 days and just before sign-out (not on quit), `desktop/backup.js` takes `GET /api/backup` (the whole workspace as JSON),
gzips it and `PUT`s it to the function's `/backup`. The function keeps at most 3 per person per 24 h, dedupes by hash, prunes at 14
keeping 7, stores bytes in File Store and a row in Data Store table `Backups`. Restore (`desktop/restore.js`) offers the latest
backup when the local workspace is empty (or on demand) and **only adds** rows (`POST /api/backup`). Free-tier numbers are in
`docs/desktop-first/01-BUDGET.md`.

### 3.2 Updates (in-app, from GitHub Releases)
`desktop/updater.js` checks `Aazhii/HitList` releases (a minute after launch, then daily; also "Account → Check for updates"). It
picks the asset for this computer (Mac arm64 `.zip` for self-replace else `.dmg`; Windows `.exe`; Linux `.AppImage` else `.deb`),
**downloads with progress**, verifies it against the release's `SHA256SUMS.txt`, and stops at "ready". "Restart and update" then asks
`desktop/installer.js` to replace the app and restart:
- **Mac, folder around the app writable:** swap the whole `.app` (rollback on failure).
- **Mac, only the app itself is writable** (typical `/Applications` for a standard account): swap what is **inside** the app
  (`Contents`), old contents kept outside until the new app starts (verified with real `ditto`/`codesign`).
- **Windows:** a helper `.cmd` waits for the app to exit, runs the NSIS installer silently (`/S`), starts the app.
- **Linux AppImage:** replace the file, start it. A `.deb` install cannot replace itself.
When it cannot, the last step opens the installer **and the screen names why** (disk image, translocated, other disk, package).
A downloaded-but-not-installed update is replaced if a newer release appears. Stale installers are deleted.
Unsigned apps: users get the first-open warning (`docs/INSTALL.md`). A file our own code downloads is not quarantined, so the swapped
app opens without a prompt (proven on Mac with copies; **not yet proven with a real release-to-release update**).

### 3.3 Cliq alerts (overdue tasks → a Cliq DM)
Desktop checks every 15 min while open (`desktop/cliqAlerts.js`): newly overdue tasks → ONE batch, max 3 a day → `POST /notify/overdue`
on the function → Cliq bot REST (`cliq.zoho.<dc>/api/v2/bots/<bot>/message?zapikey=…`). The webhook token only lives in the
function's environment. Details: `docs/cliq/00-INDEX.md`, `01-setup.md`.

### 3.4 Cliq inbound (commands from Cliq → tasks)
Designed in `docs/cliq/02-bidirectional.md`: verified link between a Catalyst user and a Cliq sender, a durable inbox in Data Store
(`CliqLinks`, `CliqRecords`), Ably "doorbell" push, desktop pull + local transactional apply (`CliqCommandService`, receipts for
idempotency). Code is committed; **deployment/credentials status unknown, treat as untested against real Cliq**.

### 3.5 Shared workspaces (new, built 2026-10-04, **not yet run against the real cloud**)
Full guide: `docs/workspaces/00-INDEX.md`. Short version:
```
you edit ─> local server journals the change (same transaction) ─> ~3-5 s later ONE batch to the cloud
cloud: ordered change log in Data Store ─> Ably doorbell {seq} ─> other computers pull after their cursor and apply
```
- A shared workspace is **just another owner partition** (random 43-char id) on every member's computer. Only lists and tasks
  and explicitly shared notes/databases are shared; other personal content stays private. Personal-source `@` assignment selects a
  shared workspace and confirms whole-source access for ALL its members, then atomically shares a canonical copy and creates the task.
  The original stays a separate snapshot, not a competing synchronized copy. Source-sharing details and 2026-10-05 validation limits
  are in the workspace guide. Replicas converge by applying the cloud's ordered changes; different fields edited at
  once both survive; the same field: later change wins; a locally-pending field is never overwritten.
- Cloud (`functions/backup/workspaces*.js`, routes under `/ws`, off until `WS_ENABLED=true`): create, invite by email (single-use,
  hashed token, 7 days, only the invited email can accept), accept, remove/leave, push a batch, pull after a cursor, one
  subscribe-only Ably token covering the caller's workspaces. Data Store tables: `Workspaces`, `WsMembers`, `WsInvites`,
  `WsChanges` (exist; columns in the guide; uses Catalyst's own created time, no `CreatedAt` on two of them).
- Local server: `SyncJournal` (journals shared fields only), `SyncService`/`SyncController` (`/api/sync/*`: register, outbox + ack,
  apply, seed, assigned), task fields `assigneeUserId/assigneeName/assignedBy/assignedAt` (`assignedBy` comes from the signed-in
  account only).
- Desktop engine: `desktop/workspaceSync.js` + `workspacePush.js` (Ably, no data in the message), wired in `main.js`/`preload.js`
  (`window.hitlistDesktop.workspaces`). The open workspace is remembered per account and sent as `X-Hitlist-Workspace` on
  tasks/lists/stats and source-editor requests. Notes/database cache identities include the active workspace.
- UI: sidebar `WorkspaceSwitcher`, `ShareWorkspaceDialog`, `JoinWorkspaceDialog`, `@` card people section, task "Assigned to",
  assignee chip, `AssignedPage`. Switching workspace reloads the page.
- **End-to-end proof without Catalyst:** `node desktop/e2e/workspaces.e2e.js` (two real servers + real engine + real cloud logic over
  memory) passes. The real Catalyst/Ably/Mail path is **untried**.
- **Verified 2026-10-04:** the Development `backup` ZIP still lacks `workspaceRoutes.js`, `workspaces.js`, `workspacesStorage.js`,
  and `workspaceDelivery.js`; its `index.js` has no `/ws` handler. `WS_ENABLED` is already true. The four live table schemas match
  the code, including unique keys and `WsChanges.Ops` at 10,000 characters. This is a code-deployment mismatch, not a missing table.
  Table permissions still need independent verification. No deployment or cloud data writes were performed during diagnosis.
- The scratch two-replica test exposed a same-field convergence bug: skipping one's own cloud echoes left replicas with different
  titles. `SyncService` now applies every echo in cloud order while preserving newer locally queued fields and suppressing journaling.
  API tests: 47 passed; desktop: 122; function: 55; web: 595 plus design/types/lint; scratch E2E: 16/16. Scratch servers and data were
  cleaned up. This is not proof of live Catalyst/Ably synchronization.
- Free-tier cost: one Data Store insert per batch (≈5,000 inserts per 30 days for the whole project).
- Workspace live-sync recovery now retries known subscription/channel failures with backoff and catches up without logout. The
  workspace menu exposes status and **Sync now**. Failed publish results are returned as `signalDelivered: false`; desktop retains
  the batch for deduplicated republishing. Account-scoped operation-ID checkpoints preserve batch identity across restart and new
  edits. No idle polling or independent cloud retry worker was added. These source changes need a desktop rebuild and separately
  approved backup deployment. Verify Ably server permissions include Publish/Subscribe on `hitlist:ws:*`; an inbox-only key is
  insufficient. Live two-account recovery has not been verified by the assistant.

### 3.6 Notes: Tab / Shift+Tab indent
`NoteBlock.indent` (optional, 0-6). Pure helpers in `web/src/lib/noteBlocks.ts` (`indentBlock`, `outdentBlock`, `normalizeIndents`,
`moveBlockWithChildren`, indent-aware numbering). Editor rules in `NoteEditor.tsx` (Enter on an empty nested item outdents, Backspace
at the start outdents, code blocks keep real Tab). Stored inside the note's `blocksJson` (server limit 10,000 characters).

## 4. Catalyst resources (names only)
- Project "HitList" (org id in `.catalystrc`). Functions: `backup`, `cliq-webhook` (both Advanced I/O, Node 20). Web client at
  `https://hitlist-60090109165.development.catalystserverless.in/app/` (trailing slash needed). Function URL
  `…/server/backup/`.
- Data Store tables: `Backups`, `CliqLinks`, `CliqRecords`, `Workspaces`, `WsMembers`, `WsInvites`, `WsChanges`.
- `backup` function environment variable **names**: `CLIQ_BOT`, `CLIQ_TOKEN`, `CLIQ_ALLOWED_DOMAINS`, `CLIQ_DC`, `CLIQ_LINKS_TABLE`,
  `CLIQ_RECORDS_TABLE`, `CLIQ_INBOUND_ENABLED`, `CLIQ_WEBHOOK_SECRET`, `ABLY_API_KEY`, `WS_ENABLED`, `WS_MAIL_FROM`,
  optional `WS_ALLOWED_DOMAINS`, `WS_INVITE_URL`.
- **The deployment script explicitly REPLACES the function's whole environment** with the git-ignored local file
  `functions/backup/.env.cliq`. The script refuses to deploy without `ABLY_API_KEY` and warns about omitted settings. Never read or
  print that file to diagnose a failure. A direct code-only `catalyst deploy --only functions:backup` omits environment updates when
  the local config omits `deployment.env_variables`, as the current config does. Verify saved setting names after any deployment.
- Catalyst MCP can discover Data Store tables, schemas, and permissions; avoid function/env listing tools that return secrets.
  Console actions are a fallback when the necessary MCP tool is unavailable. Free tier resets every 30 days
  (File Store upload 2,000; Data Store insert 5,000, fetch 10,000, delete 1,000).
- `getCurrentUser()` returns null for app users here; identity is `callerOf(req)` (user-scope SDK init + admin lookup, role
  "App User"). Use `zcatalyst-sdk-node` for Data Store/File Store, not mixed `@zcatalyst/*` packages. ids are 17 digits: text.

## 5. Build, release, test
- Versions come from the GitHub Actions form (`compute-version.sh`): `<main>.<second>.<third>[-alpha|beta N]`, tag `<Name>_<version>`,
  third defaults to the run number so every build is unique. Tick **publish** to create a Release (needed for in-app updates).
- Mac artifacts: `.dmg` (first install) and `.zip` (what an installed app updates itself with); Windows `.exe` (built on
  windows-latest); Linux `.AppImage` and `.deb`. All unsigned. Intel Macs are not built.
- Commands: `cd desktop && pnpm test` (120+), `cd functions/backup && npm test` (55), `cd web && pnpm design:check && pnpm exec tsc -b &&
  pnpm exec eslint src test && pnpm vitest run` (595), Java: `mvn -B -f api/pom.xml test` (44; Maven is at
  `~/.m2/wrapper/dists/apache-maven-*/…/bin/mvn`). Scratch servers started for checks must be stopped afterwards.
- `desktop/dist-*/` is git-ignored: never commit local Mac build folders (one 385 MB mistake was already undone).

## 6. Rules the owner insists on
1. **No data loss.** Additive migrations; imports only add; never delete or overwrite user rows silently; check before overwriting.
2. **No secrets** in git, docs, chat or logs. The Cliq token, Ably key and webhook secret were pasted in chat before: regenerate.
3. **Do not push**, and do not stop the AppSail, without being asked/confirmed.
4. Read a file before editing; prefer the existing helper over new code; keep comments to the file's style; no dead controls
   (`pnpm design:check` enforces font sizes, radii, tokens, stroke 1.75, no raw hex).
5. Say plainly what was verified and what was not. Never claim Windows/Linux updates or the real cloud path work until tried.
6. Free-tier limits matter (about 20 users): batch writes, no polling of Catalyst on a timer.
7. Pronouns: use they/them unless told.

## 7. Open work, in priority order
1. **Deploy the cloud side for shared workspaces and try it for real** with two Catalyst accounts: fill `.env.cliq` completely
   (values live only in the Catalyst console), `sh scripts/deploy-backup-function.sh`, `catalyst deploy --only client` (invite page).
  Read-only diagnosis confirmed that the deployed function lacks `/ws`, although the flag and schemas are present. An older
  installed UI may show only a generic failure. Get explicit owner approval before a code-only deployment, and never overwrite
  console secrets with an incomplete local environment file. Confirm Ably (free-tier limits, token
   capability format), Catalyst Mail sender verification (and any development-environment sending limits), the Data Store column
   names/types exactly as in `docs/workspaces/00-INDEX.md`, and that `Ops` (Text) holds 10,000 characters.
2. **Prove the in-app update on a real release**: build and publish version N+1 (publish ticked), install N, update through the app on
   Mac (both Applications-writable and read-only cases), then Windows and Linux on real machines. Nothing past unit tests and
   Mac copy-swaps has been seen.
3. **Cliq inbound**: verify the deployed `cliq-webhook`, tables and settings, test `link <32-character code>` with a real bot; fix what
   real Cliq reveals. Same caution about secrets.
4. **Shared-workspace follow-ups**: `hitlist://` invite links, change-log compaction (snapshots), a "shared writes used this month"
   counter, sharing notes/databases, conflict UI if ever needed, tests for `ensurePush` restart when membership changes, a way to
   refresh members after someone joins without reopening the dialog.
5. **Windows/Linux UX checks** of the whole app (the owner reported Windows "behind Mac"; cause found: uncommitted work only run
   on the Mac. Re-check after publishing a fresh build).
6. Static download page: replace the WorkDrive link flow, then retire the AppSail once the owner confirms.
7. Optional: duplicates tool ("merge duplicate tasks", shows pairs, removes only what the owner confirms). Near-duplicate titles seen
   earlier were real separate tasks, not copies; no code path that copies a task on edit/reinstall was found.

## 8. Known weaknesses (be aware, do not hide)
- The Cliq email is typed by the person; domain allow-list limits the damage (verified linking is the planned fix).
- Offline edits in a shared workspace resolve last-writer-wins per field; there is no merge UI.
- A task text field over ~4,900 characters is not shared (it stays complete locally); one batch holds ~8.5 KB.
- Alerts (Cliq) only go out while the app is open.
- `ably` is a runtime dependency of the desktop app; confirm it packs correctly on every platform build.
- The web build in the jar and the desktop shell are versioned together; the old cookie/web mode still exists in code.
