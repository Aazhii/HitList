# Prompt for an AI coding assistant (copy everything below the line)

---

You are continuing work on **HitList**, a local-first tasks/notes/databases desktop app, in the repository at the current workspace
(GitHub `Aazhii/HitList`, branch `master`). A lot was built quickly by a previous assistant; your job is to **analyse it carefully,
verify it, fix what is wrong, finish what is open, and report back plainly**. Do not assume anything is correct because it is
documented: check the code and run the tests.

## Step 0: read, in this order, before changing anything
1. `docs/HANDOFF.md` (current architecture, flows, Catalyst resources, rules, open work). It is the source of truth for state.
2. `docs/workspaces/00-INDEX.md` (shared workspaces), `docs/INSTALL.md` (installing and updating), `docs/building/*` (CI/release),
   `docs/cliq/*` (Cliq alerts and inbound), `docs/desktop-first/*` (strategy and free-tier budget).
3. The code the docs point to. Start with `desktop/main.js`, `desktop/updater.js`, `desktop/installer.js`, `desktop/workspaceSync.js`,
   `functions/backup/workspaces.js`, `api/src/main/java/com/hitlist/domain/{SyncJournal,SyncService,EntityRepository,TaskService}.java`,
   `web/src/lib/workspaceStore.ts`, `web/src/components/shell/{WorkspaceSwitcher,ShareWorkspaceDialog,JoinWorkspaceDialog,UpdateDialog}.tsx`.
Then write me a short summary of what you understood and any place where the docs and the code disagree.

## Product and strategy (so you decide well)
- The **desktop app is the product** (Electron + bundled Java + local SQLite). Catalyst (Zoho serverless) is used only for sign-in,
  backup, Cliq, and shared workspaces. Sign-in is optional. About 20 users, so the Catalyst free tier matters: batch writes, no
  timer polling of Catalyst.
- Apps are **unsigned** on Mac, Windows and Linux. In-app updates must download with visible progress, verify the checksum, then
  **replace the installed app and restart by themselves**, with no dragging or manual installer, on all three systems.

## Hard rules (the owner will be upset if you break these)
1. **No data loss.** Stored-shape changes need additive migrations. Never delete or overwrite a user's rows silently. Check a target
   before overwriting or deleting.
2. **No secrets** in code, docs, commits, logs or chat. Setting NAMES only. If you see a secret anywhere, say so and tell me to
   regenerate it. Never print values from `functions/backup/.env.cliq`.
3. **Do not `git push`, do not deploy to Catalyst, and do not stop the AppSail** unless I tell you to. Commit in small, clear
   commits. Never `git add -A` blindly: `desktop/dist-*/` (local Mac builds) must never be committed.
4. Read a file before you edit it. Reuse existing helpers. Match the surrounding style and comment density.
5. Follow the UI rules enforced by `cd web && pnpm design:check` (allowed font sizes, radii, tokens, stroke 1.75, no raw hex, no dead
   controls).
6. Be honest: state what you **ran and saw** versus what you only read. Never claim Windows, Linux, real Catalyst, real Ably, real
   Cliq or a real release-to-release update works unless you actually exercised it. If something cannot be tested from here, say
   exactly what I must do and how to check it.
7. Stop any scratch server or process you start. Use scratch data folders, never the real `~/Library/Application Support/HitList`.

## Verification you must run (and report numbers for)
- `cd desktop && pnpm test`  (about 120)
- `cd functions/backup && npm test`  (about 55)
- `cd web && pnpm design:check && pnpm exec tsc -b && pnpm exec eslint src test && pnpm vitest run`  (about 595)
- `mvn -B -f api/pom.xml test`  (about 44; Maven lives under `~/.m2/wrapper/dists/apache-maven-*/*/bin/mvn` if not on PATH)
- `node desktop/e2e/workspaces.e2e.js` (two real local servers + the real sync engine + the real cloud logic over memory; needs
  `api/target/hitlist.jar` built first with `mvn -f api/pom.xml -DskipTests package`; takes about 45 s)

## What to do (in this order; stop and ask me if a step needs a secret or a console action)
**A. Audit what was built (read-only first, then fix).** Look for real bugs, races, security holes and doc/code mismatches in:
1. **Shared workspaces** (cloud `functions/backup/workspaces*.js`, local `SyncJournal`/`SyncService`/`OwnerSessionFilter`, desktop
   `workspaceSync.js`/`workspacePush.js`, UI). Specifically check: membership checks on every route; invite token single-use and
   email-bound; the `X-Hitlist-Workspace` header cannot reach a workspace the account did not join; removed members stay read-only and
   cannot push; sequence-number retry logic against Catalyst Data Store (no transactions: uniqueness comes from unique columns);
   journaling of deletes (including list deletes cascading to tasks); idempotent apply; the offline outbox cannot grow unbounded or
   jam; push restart when membership changes (a newly joined workspace's channel is not in an old token); first-join bootstrap of a
   big change log; what happens at 5,000 inserts a month. Fix what you find and add tests.
2. **In-app update** (`desktop/updater.js`, `installer.js`, `UpdateDialog`): the Mac replace and contents-swap helpers, the Windows
   `.cmd` helper (NSIS silent install, relaunch, paths with spaces, antivirus/SmartScreen), the Linux AppImage replace, rollback on
   failure, leftover cleanup. Windows and Linux were never run on real machines: review very carefully, simulate what you can, and
   write a precise manual test checklist for me.
3. **Duplicate-task protections** (import/restore/claim/local-storage migration): confirm no path can copy a task or bring back a
   deleted one; extend tests if you find a gap.
**B. Finish the open work** listed in `docs/HANDOFF.md` section 7, items 4 and 5 first (follow-ups and Windows/Linux checks that need
no secrets): `hitlist://` invite links, change-log compaction, a visible shared-writes counter, refreshing members without reopening
the dialog, a test for the push restart on membership change. Items 1 to 3 need me (deploy, real accounts, a published release):
prepare everything so I can do them in minutes and tell me exactly what to run.
**C. Docs.** Keep `docs/HANDOFF.md` and the guides true: update them in the same commits as the code. Remove anything stale.

## How to report back
Finish with a short report in plain language (no jargon dumps): what you verified and how (with test counts), what you changed and
why (commit hashes), what is still unproven or needs me (with exact steps), and any risk you found. Keep it honest and specific.
