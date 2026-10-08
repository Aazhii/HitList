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
gzips it and `PUT`s it to the function's `/backup`. The function allows at most 10 changed **manual** backups per person per
rolling 24 h. Login (`signed-in`), logout (`sign-out`), scheduled and update triggers bypass this allowance and consume no
manual slots. A cached manual rejection does not block those triggers; their success does not clear the manual rejection.
Different in-flight trigger types wait and run separately, with cancellation/account-switch guards preserved.
It dedupes by hash and prunes at 14, retaining the latest 7 plus recent manual entries so pruning cannot reset the allowance.
It stores bytes in File Store and a row in Data Store table `Backups`. The pending rollout requires an additive optional
`BackupReason` Text column before deploying the function, then a rebuilt desktop. Missing legacy reasons/headers count as
manual. Trigger labels are client-reported, not server-attested lifecycle events. No schema change or deployment has been
performed. An older deployed function can still reject automatic triggers under its shared cap.
Restore (`desktop/restore.js`) offers the latest
backup when the local workspace is empty (or on demand) and **only adds** rows (`POST /api/backup`). Free-tier numbers are in
`docs/desktop-first/01-BUDGET.md`.

Manual-only backup policy validation (2026-10-05, uncommitted source on base `5361875`): macOS 26.6.2 arm64, Node 24.19.0,
Java 25. `node --test functions/backup/test.backupReasons.js`: 2 passed, including the authenticated route and persistence
adapter. `node --test desktop/test.backup.js desktop/test.auth.js desktop/test.restore.js desktop/test.main.js`: 48 passed
before adding the shell-header test; the subsequent `node --test desktop/test.main.js`: 13 passed. The complete final
`node scripts/ci/validate-desktop.cjs` and `sh scripts/ci/compute-version.test.sh` passed with Java 25 and the cached Maven
3.9.12 executable. This includes frontend checks, API tests, a fresh embedded jar/local Java smoke, 27 two-replica assertions
and 16 version cases; scratch replica processes/storage were cleaned up. Native platform helper skips remain skips.
No new distributable artifact, installed GUI/login/logout/account-switch test, native Windows/Linux run or live Catalyst
schema/policy check was performed during that local validation. The backup-policy source was subsequently committed as
`62f16d1`.

Authorized Development rollout (2026-10-05): read-only metadata first confirmed the cloud function was last modified
October 4 and `Backups` lacked `BackupReason`. Added optional `BackupReason` Text column
`75733000000021016` to table `75733000000032007`; Catalyst reported max length 10,000 instead of the requested 100.
Existing rows were not rewritten. `node --test functions/backup/test.backupService.js functions/backup/test.backupReasons.js`:
12 passed. `catalyst deploy --only functions:backup --org 60090109165 -p 75733000000013053 --dc in -ni`: successful.
The CLI omitted environment replacement; post-deploy metadata confirmed all 11 expected setting names remain present and
the environment configuration update timestamp was unchanged. The function modification timestamp advanced to October 5,
and the public `/server/backup/health` returned HTTP 200 with `{"ok":true}`. No other function or client was deployed.
The function-list `is_deployed: false` field remained inconsistent with the successful CLI result; downloaded artifact
hashes and live authenticated allowance/login/logout behavior were not verified. Three incidental bulk-read jobs were
started during a schema-tool routing failure; no export output was downloaded and no backup records were modified by them.
Cached manual retry times on installed desktops were not cleared and can still suppress manual retries until expiry.
No new desktop build, push or release publication was performed.

### 3.1.1 Cloud inspection: no new bulk operations
Owner restriction (2026-10-05): do not start Data Store Bulk Read or Bulk Write jobs, including through MCP, SDKs,
REST APIs, scripts or console exports. This restriction concerns bulk database operations, not ordinary application builds.
Do not create a bulk job to inspect schema, troubleshoot updates, check quotas or test MCP connectivity.

- For schema inspection, use table/column metadata APIs such as `Get_Table_By_Id` and `List_All_Columns`.
- For necessary record inspection, use `Get_Rows` or bounded, paginated ZCQL SELECT queries; scope to the relevant account
  and fetch only the needed rows/columns. These consume ordinary read quota, not Bulk Read quota.
- Check the actual tool name and argument schema before invoking it. Never substitute `Create_Bulk_Read_Job` or
  `Create_Bulk_Write_Job` when the intended read-only tool is unavailable or fails. Stop and report the limitation instead.
- If a tool unexpectedly starts a job, do not retry it. Record the returned job ID, timestamp, environment and operation
  without credentials or record contents, and tell the owner. Status checks for an existing job must not create another job.

Review evidence: no Bulk Read/Write API calls were found in the application source searched. The rollout record above
documents three accidental Bulk Read jobs during agent tooling, not application update checks. The reported four dataset
units have not been fully reconciled against job IDs and usage records; do not claim the fourth unit's origin is known.
In-app updates query GitHub Releases, not Catalyst Data Store. The generic update-server error alone does not establish
offline status or a Catalyst quota failure.

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
Desktop checks every minute while open (`desktop/cliqAlerts.js`), selecting local SQLite schedules with `due_at <= now`.
`DueScheduleStore` maintains indexed task schedules and account/workspace delivery receipts through `EntityRepository` task
writes, including sync and restore. Date-only tasks use 23:59:59 local time; clearing a date also clears its time and schedule.
The worker reserves and revalidates at most 20 tasks, sends one bounded batch per minute, then acknowledges the local receipt.
There is no daily batch cap or baseline skip: pending tasks catch up after enable, reopen or offline recovery.
Settings are account/workspace scoped; shared workspaces default off. All enabled workspaces remain checked regardless of the
active view. Account transitions cancel in-flight work. Detection and scheduling stay local; only messages go to
`POST /notify/overdue` on the existing function for Cliq bot delivery. No cloud scheduler or bulk operation was added.
Normal local deduplication does not guarantee exactly-once delivery across send/ack crashes or multiple devices.
Details: `docs/cliq/00-INDEX.md`, `01-setup.md` (older cadence/cap descriptions are superseded by this section).

Provisional commit evidence (2026-10-05, source base `62f16d1`): macOS 26.6.2 (25G83) arm64; Node 24.19.0, Java 25.0.4,
cached Maven 3.9.12. Tested from the repository with scratch SQLite data, not the installed HitList profile.
Passed focused checks: `node --test desktop/test.cliqAlerts.js desktop/test.main.js`;
`node web/node_modules/vitest/vitest.mjs run --root web test/TaskDetailPanel.test.tsx test/CliqAlertsDialog.test.tsx test/cliqMessage.test.ts`;
Maven `-B -f api/pom.xml -Dtest=DueScheduleStoreTest,ApiContractTest test`.
Passed mandatory gates: `node scripts/ci/validate-desktop.cjs` and `sh scripts/ci/compute-version.test.sh` with Java 25
and `HITLIST_MVN=$HOME/.m2/wrapper/dists/apache-maven-3.9.12/6068d197/bin/mvn`. The validator built fresh embedded frontend
assets, packaged the jar, passed the real HTTP overdue lifecycle smoke and all 27 two-replica E2E assertions; its scratch
processes/data were cleaned up. The separate browser-preview terminal was stopped; preview scratch data was not removed.
Tested `api/target/hitlist.jar` SHA256: `4d4ea8b70d69724c03d11229411b9e2538681c43c5a45110787f1625514735a4`.
Native macOS/Windows/Linux package checks: NOT RUN. Installed GUI/login/logout/account-switch/manual lifecycle checks and
live HitListBot delivery: NOT RUN; native helper skips are not passes. No distributable was built or published.
Owner explicitly approved a provisional commit despite these unavailable checks; release remains blocked until verified.
No cloud deployment, infrastructure change, Bulk Read/Write operation or push was performed for this scheduler change.

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

### 3.5b Automations (rebuilt 2026-10-06)
Full guide: `docs/automations/00-INDEX.md`. One engine: rules plan their moments into `hitlist_automation_queue` (execute-at), a 60-second
worker claims rows where `now >= execute_at`, runs conditions and actions in one transaction, and Cliq messages go through an outbox the
desktop delivers (`/notify/message`). Rule model v2 (`spec`), template gallery and builder in the UI. Verified: Java engine tests on SQLite
(`AutomationRunnerTest`), desktop outbox tests, web builder tests, and a real run (a task due in 90 s fired within a minute of its due
time). **Not yet tried:** a real Cliq delivery end to end (needs the deployed function), and database records as a source.

### 3.6 Notes: Tab / Shift+Tab indent
`NoteBlock.indent` (optional, 0-6). Pure helpers in `web/src/lib/noteBlocks.ts` (`indentBlock`, `outdentBlock`, `normalizeIndents`,
`moveBlockWithChildren`, indent-aware numbering). Editor rules in `NoteEditor.tsx` (Enter on an empty nested item outdents, Backspace
at the start outdents, code blocks keep real Tab). Stored inside the note's `blocksJson` (server limit 10,000 characters).

### Update to a chosen version or from a file
`desktop/updater.js`: `checkVersion(text)` finds a release by tag (`1.1.27` or `HitList 1.1.27`) and stages it like a normal update
(`requested`, `direction` newer/older/same; the daily check does not replace it, `check({force:true})` does). `useFile(path)`
validates the file name per platform, Mac architecture, SHA256SUMS if present (`verified`), and never touches the user's file.
`installer.js` also installs a `.dmg` (hdiutil attach, bundle id must be HitList, ditto, detach). UI: `UpdateDialog.tsx`
(older version needs a confirmation). Not verified on real Windows/Linux machines.

### Weekly update (progress log + Monday prompt)
See `docs/weekly-update.md`. New table `KaizenWorkLog`, `/api/worklog`, page `WeeklyUpdatePage`, `l`/⌘L dialog, a `weekly-update` rule template.
No LLM is called; the app only builds a prompt for the owner to paste.
Evidence (2026-10-06, macOS arm64, Java 25.0.4, Maven 3.9.12, scratch data): `node scripts/ci/validate-desktop.cjs` and `sh scripts/ci/compute-version.test.sh` exit 0 on the final source; web 716 tests, API 73. Not run: native Windows/Linux/macOS package checks, real Monday firing, a real LLM paste.

### Task notes in Cliq messages
An overdue message shows the task's note under it (`   ↳ note`, at most 300 characters, shorter when the message nears 1,800). The note is read live from the task at reserve and validate time (`DueScheduleStore`), sent by the desktop, cleaned in `functions/backup/cliq.js`. Automation Cliq messages do the same, and `{{note}}` works in templates. **The backup function must be redeployed** for the overdue path to show notes (owner's step).

### Fewer Data Store reads (shared-workspace sync)
Found from the real function log (2026-10-07): a full refresh (`GET /ws`, `POST /ws/token`, a pull) every 5 minutes, all day, because the live signal (Ably) never connected on this computer even though the token request returned 200, plus a pull every 5 s during edits. Now: an edit syncs only workspaces with something queued (`syncQueued`); a doorbell whose number this computer already has is ignored; with only the live signal down the retry is a single pull every 5 minutes and the full refresh every 30 minutes; the reason the live signal is down is kept (`status().pushError`, and logged). **The underlying cause of the live signal failing is not yet known**; the log line `[hitlist] shared-workspace live signal unavailable: …` in a new build will say.

### Toggle blocks, and a database in a note
`toggle` is a note block type with `collapsed?` (additive; stored in the opaque blocks JSON, so no server change). Its children are the blocks after it that are indented deeper (the same `indent` model as Tab / Shift+Tab); a closed toggle hides them (`noteBlocks.hiddenBlockIds`), Enter in a toggle adds another toggle: level with it when it holds nothing (or is closed, after everything inside), as its first inner line when it is open and holds lines; Enter on an empty toggle ends the run; ⌘/Ctrl+↵ opens or closes. An older HitList that does not know the type shows it as plain text and keeps the indent. A database block now starts where the note's text starts and its grid scrolls out over the left margin (`--note-inset`, `RecordTable`, `RecordBoard`, `DatabaseBlock`).

### Needs first (task prerequisites)
See `docs/needs-first.md`. Task row key `NeedsFirstIds`, API `needsFirst`, a completion gate in `App.tsx` (`useNeedsFirstGate`), picker in the detail panel, Add task dialog and quick add (`>`). **Release order: deploy `functions/backup` first.** Not extended: the desktop two-replica E2E (the sync path is covered by `SharedWorkspaceTest` and `functions/backup/test.workspaces.js`).

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

### Split pasted lines into items
A paste into a note stays one block with line breaks. Selecting several lines inside a paragraph, bullet, numbered or to-do block shows a **Split lines** button in the selection toolbar (`NoteEditor.handleSplitLines`): each non-empty line, trimmed, becomes its own block of the same type; text before/after the selection stays on the first/last line. Nothing stored changes shape (ordinary blocks). Test: `web/test/NoteSplitLines.test.tsx`.
