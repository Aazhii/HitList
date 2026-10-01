# HitList desktop-first with cloud backup: plan and status board

**Read this file first.** It holds the decision, the plan and the status. Like the design
migration, a task closes on a command's output or a check, not on a description.

## The decision in one paragraph

HitList runs on each person's own machine as the desktop app that already exists (`desktop/`:
Electron, a bundled Java runtime, the real `api/` jar, local SQLite). Nothing listens on a
server, so nothing burns the Catalyst free tier while people work. Catalyst is used only for
two things: **sign-in**, through Catalyst Authentication's hosted login, and **backup**, where
a snapshot of the local workspace goes to Catalyst a few times a day and comes back on a new
machine after sign-in. The web link (AppSail) stops being the way people use HitList.

## What already exists (so the plan does not rebuild it)

| Piece | Where | State |
|---|---|---|
| Desktop shell: starts the jar on a free local port, SQLite in the OS app-data folder, one instance only | `desktop/main.js` | works; `HitList-1.0.0-arm64.dmg` builds (≈197 MB) |
| Lossless workspace snapshot, and an import that only ever adds | `WorkspaceBackupService`, `GET/POST /api/backup` (P6.4) | done, tested |
| Rules, reminders and the automation engine run inside the jar | `AutomationEngine`, `AutomationScheduler` | done; runs while the app is open |
| Catalyst sign-in as the owner of a workspace | `AUTH_MODE=catalyst`, `/api/session`, `WorkspaceClaimService` | done for the web deploy; not wired to desktop |

## The gaps this plan closes

1. **Desktop sign-in.** The desktop has no Catalyst session: it owns data by a local cookie.
2. **Backup to Catalyst and restore from it.** The snapshot exists locally, but there is no
   upload, no schedule and no restore.
3. **Server-free cost.** Today people use the AppSail URL, and the AppSail answers every click.
4. **Distribution.** Only a macOS arm64 dmg, unsigned. No Windows build, no Intel Mac build, no updates.

## Phases

| Phase | Goal | Proof it is done |
|---|---|---|
| **D0** Measure | Get the free-tier numbers and turn them into a call budget per user per day | `01-BUDGET.md` filled in from the real plan |
| **D1** Desktop sign-in | The desktop signs in with Catalyst's hosted login and knows the user's id | sign in, quit, reopen: still signed in; sign out works |
| **D2** Backup service | One small Catalyst Function that stores and returns that user's snapshots | contract test: user A cannot read or overwrite user B's snapshot |
| **D3** Backup from desktop | Snapshot every 6 h while open, on quit, and on demand; only when something changed | three changes, one quiet day: exactly the uploads the rule says |
| **D4** Restore | A fresh install, after sign-in, offers the latest snapshot and restores it | delete app data, reinstall, sign in, restore: same tasks, notes, databases |
| **D5** Retire the web path | AppSail stopped or limited; the web link says "get the desktop app" | AppSail request count flat for a day of normal use |
| **D6** Ship | Signed builds for macOS (arm64 + Intel) and Windows, with auto-update | install on a clean machine of each kind without a warning dialog |

## Task board

| ID | Task | Status | Proof |
|---|---|---|---|
| D0.1 | Paste the free-tier limits into `01-BUDGET.md` | **done 2026-10-01** | `01-BUDGET.md`: the pasted limits and what a person costs |
| D0.2 | Per-user daily call budget: sign-in, backup, restore, list | **done 2026-10-01** | table in `01-BUDGET.md`: File Store uploads are the first limit, about 33 active people at 2 backups a day |
| D1.0 | Spike: can a desktop window sign in with Catalyst's hosted login and call a Function as that user? | **done 2026-10-01** | `desktop/auth-spike.js` printed SPIKE PASSED: the window's session reaches the `backup` Function, which returned the user id and email; a call with no cookies is refused |
| D1.1 | Desktop opens Catalyst's hosted login in its own window, keeps the session cookie in the app's partition | **built, awaiting a click-through** | `desktop/auth.js`: the window closes itself on /app/, the account is remembered in `account.json`, sign-out clears the session; `test.auth.js` (4) |
| D1.2 | The jar learns the signed-in user: Electron passes it in, the jar runs in `cookie` mode locally with that user as owner | **built** | `AUTH_MODE=desktop`: the shell names the owner on its own local requests with a per-launch secret; a wrong or missing secret falls back to the cookie workspace; `ApiContractTest` desktop case |
| D1.3 | First sign-in brings the existing local (cookie) workspace under the account (reuse `WorkspaceClaimService`) | **built** | same Java test: claimed once, another account sees nothing, the cookie no longer holds it |
| D1.4 | Works offline: no network means the app opens as before; sign-in only when backing up or restoring | **built** | the account is read from disk at launch; the network is used only to sign in and to back up |
| D2.1 | Catalyst Function `backup` (Advanced I/O): `PUT` a snapshot, `GET` the latest, `GET` the list; user from the request, never from the body | **done 2026-10-01** | `desktop/backup-smoke.js` printed SMOKE PASSED against the deployed Function: upload stored, same content skipped, list, download matches, signed-out calls refused |
| D2.2 | Storage: snapshot JSON in File Store/Stratus, one index row per snapshot in Data Store (`Backups`: user, time, size, counts, file id) | **done 2026-10-01** | files in one File Store folder `backups` (made by the Function); index in the Data Store table `Backups` (UserId, BackedUpAt, Hash, SizeBytes, FileId; mandatory, PII-flagged); seen in the console after the smoke test |
| D2.3 | Keep the last N snapshots per user (say 7), delete older ones | **done (unit-tested, not yet exercised live)** | `functions/backup/test.backupService.js`: 5 tests incl. per-user isolation and pruning to 7 |
| D3.1 | Scheduler in the desktop shell (not the jar): every 6 h while open, on quit, and "Back up now" in the Account menu | **built, awaiting a click-through** | `desktop/backup.js` + `test.backup.js` (8): due only after 6 h, a 15-minute local check, a last backup on quit and on sign-out capped at 8 s |
| D3.2 | Skip the upload when nothing changed since the last one (hash of the snapshot) | **built** | the hash ignores export time and row order; unchanged means no cloud call at all |
| D3.3 | Compress (gzip) before upload; show "Backed up 2 h ago" in the Account menu | **built** | Account menu: Back up now plus the last-backup time (`useDesktopAccount`, `backupMessage`) |
| D4.1 | After sign-in on an empty install: "Restore from backup (Oct 1, 9:40 AM)?" | **built, awaiting a click-through** | `desktop/restore.js` + `test.restore.js` (8); the app offers a Restore toast on an empty install or just after sign-in (`RestoreOffer`), and Account → Restore from backup on demand; a normal launch with data makes no cloud call |
| D4.2 | Restore into a non-empty install only adds (the P6.4 rule), never overwrites | **built** | restore posts the backup to the local server's add-only import (existing rows are left as they are, nothing is deleted); a damaged download changes nothing |
| D5.1 | Stop the AppSail, or keep it with a page that links to the download | todo | |
| D5.2 | Host the download page and the hosted-login page as a static Web Client (no compute) | todo | |
| D6.1 | Windows x64 and macOS x64 builds; bundled JRE per platform | todo | |
| D6.2 | Code signing (Apple Developer ID + notarisation; a Windows certificate) | todo, costs money | |
| D6.3 | Auto-update from a static release feed | todo | |

## Rules for whoever does a task

- No data loss (the standing rule): restore and claim only ever add; a backup is never deleted
  until a newer one is safely stored.
- Every network call has a budget line in `01-BUDGET.md` before it is written.
- The desktop must work with no network at all. Cloud is backup, not a dependency.

## What the spike taught us (read before building D1.1 and D2)

- **Who is calling.** `functions/backup/index.js` `callerOf`: the SDK must accept the request's user token (`zcAuth.init(req, { scope: 'user' })`; an anonymous caller is refused), and Catalyst's gateway id (`x-zc-user-id`) must resolve, by an admin `getUserDetails`, to an actual App User. Not used, on purpose: `getCurrentUser()` (answers null even for a signed-in app user), `x-zc-user-type` (the gateway passes a caller-supplied one through), and the gateway id alone (for an anonymous caller it is the project owner's id).
- **Who counts as a user.** Only people in Authentication → User Management with role App User. The project owner's own Zoho/Gmail login is *not* one until it appears in that list (it did, after setting a password through the hosted page).
- **How the desktop calls.** Any of these works: a call from the signed-in window's page, Electron's `session.fetch` from the main process, or a plain `Cookie` header built from the window's cookies. Use `session.fetch` (browser-style cookie handling, no page needed).
- **After sign-in** Catalyst lands the window on `/app/` ("Site Not Found" until a web client is deployed). The desktop should detect that URL and close the login window itself.
- **Gotchas found:** a deploy takes a few seconds to take over, so the first request after `catalyst deploy` can still be answered by the previous version; `x-zc-*` headers on a Function request are the gateway's, never the caller's, except `x-zc-user-type`.
- **SDK versions (D2):** do not mix `@zcatalyst/*` packages. The File Store package is an older line (0.0.2) with its own copy of auth, which cannot see the credentials the newer auth package (1.0.0) sets up; the symptom was "Unable to get the app credentials" / "Unable to process the project credentials". The backup Function uses `@zcatalyst/auth` only to identify the caller, and `zcatalyst-sdk-node` for Data Store and File Store.
- **File Store has no "list files in a folder"** in the SDK, which is why backups are indexed in a Data Store table.
- **Catalyst creates tables only from the console** (no CLI or API for it), so the `Backups` table was created by hand: UserId text, BackedUpAt bigint, Hash text, SizeBytes bigint, FileId text; unique off, search index off, mandatory on, PII on. Ids are 17 digits, past JavaScript's exact-number range (16), so they are text.

