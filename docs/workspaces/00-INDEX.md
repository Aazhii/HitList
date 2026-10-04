# Shared workspaces

Several people work in one workspace: the lists and tasks are shared, every person keeps their own notes and databases, and a task
can be given to a member (`@` → pick a person). Everything stays local-first: each computer holds a full copy and works offline.

## What a person does
1. **Create:** the workspace name at the top of the sidebar → *New shared workspace* → name it, tick the lists to copy in (the
   originals stay in your own workspace) → *Create workspace*.
2. **Invite:** the workspace name → *Members and invites* → type an email → *Send invite*. The person gets an email with a link and
   you also get the link to copy. It works once, for 7 days, and only for that email address.
3. **Join:** the invited person opens HitList, signs in with the invited email, workspace name → *Join with an invite*, pastes the
   link. (The link opens `…/app/invite.html`, which explains the same steps.)
4. **Assign:** in a note line or a database text cell type `@`, pick the person under *Assign to* (or type the start of their
   name), choose a quadrant and list, *Add task for …*. Or open any task and set *Assigned to*. The person gets a desktop
   notification and the task appears under *Assigned to me*.
5. **Leave / remove:** members can leave; the owner can remove members. A person who left keeps a read-only copy on their computer.

## How it works (no polling)
```
you edit ──> local server journals the change (same transaction) ──> a few seconds later ONE batch goes to the cloud
cloud: ordered change log (Data Store) ──> Ably "something changed" doorbell ──> the other computers pull after their cursor
```
- Source of truth for a shared workspace = an ordered change log in Catalyst Data Store; each computer keeps a replica in its local
  SQLite and a cursor (the last change it applied). Changes apply in the cloud's order, so every copy ends the same.
- **Different fields** edited at the same moment both survive. The **same field** edited at the same moment: the later change wins on
  every computer. A field you changed that has not been sent yet is never overwritten by an incoming change.
- Own cloud echoes are applied too, in sequence, once a field has no newer pending local edit. Skipping these echoes can make
   two replicas disagree after simultaneous edits. Incoming application suppresses journaling so it does not enqueue another write.
- The doorbell carries only a number. After a reconnect, at start and after being offline, the app pulls everything it missed.
- Nothing runs on a timer while idle. A failed send is retried after 30 s, 1, 2, then 5 minutes, only while something is waiting.
- Only lists and tasks are shared. Links from a task to someone's own note or database row stay on their computer.
- Free allowance: every batch is one Data Store insert (about 5,000 inserts per 30 days for the whole project). Batches are sent at
  most once every 5 seconds per computer and join everything changed in between.
- A text field over 4,900 characters (a very long task note) is not shared; it stays complete on your computer. One batch holds
  about 8.5 KB, bigger edits are split.

## Setting it up (once, by the project owner)
1. **Data Store tables** (Catalyst console; names and columns are case-sensitive). Catalyst's own created-time column is used for
   when a row was made, so there is no `CreatedAt` column on `Workspaces` or `WsChanges`.

   | Table | Columns |
   |---|---|
   | `Workspaces` | `WorkspaceId` (unique), `Name`, `OwnerUserId` |
   | `WsMembers` | `MemberKey` (unique), `WorkspaceId`, `UserId`, `Email`, `Name`, `Role`, `JoinedAt` (Big Int) |
   | `WsInvites` | `TokenHash` (unique), `WorkspaceId`, `Email`, `InvitedBy`, `ExpiresAt` (Big Int), `Status` |
   | `WsChanges` | `ChangeKey` (unique), `BatchKey` (unique), `WorkspaceId`, `Seq` (Big Int), `AuthorUserId`, `DeviceId`, `Ops` (Text, 10,000) |

2. **Function settings** on `backup`: `ABLY_API_KEY` (the Ably key), `WS_ENABLED=true`, `WS_MAIL_FROM` (an address verified under
   Catalyst Mail; without it invites are not emailed but the link is still shown to copy), optional `WS_ALLOWED_DOMAINS`
   (comma list) and `WS_INVITE_URL` (defaults to the project's `/app/invite.html`).
   **The deployment script replaces the function's whole environment** with `functions/backup/.env.cliq`, so every setting above
   (and the Cliq ones) must be in that local, git-ignored file when using the script. It refuses deployment without `ABLY_API_KEY`
   and warns about omitted settings. Direct code-only deployment can preserve console settings when `deployment.env_variables`
   is omitted from the local function config. Do not use an empty map or an incomplete file as a replacement environment.
3. Deploy: `sh scripts/deploy-backup-function.sh`, and upload `client/invite.html` with the web client
   (`catalyst deploy --only client`).
4. Everyone must sign in to HitList (a Catalyst account) with the email the invite was sent to.

## Diagnosed creation failure (2026-10-04)

Read-only inspection of the Development `backup` download found an older handler without `/ws` routes or any workspace modules.
`WS_ENABLED` was already true. The live four-table schemas match this guide, including the required unique columns and 10,000
characters for `Ops`; missing tables are not the creation blocker. Permissions remain unverified.

The current source contains the missing routes. After owner approval, deploy only `backup` with a complete environment or the
code-only configuration described above; do not deploy all functions merely to fix workspace creation. Then verify an authenticated
`GET /ws` before creating a workspace. Changing a flag or rebuilding only the desktop cannot add routes to the cloud function.

Local verification passes: 122 desktop tests, 55 function tests, 47 Java tests, 595 web tests with design/types/lint, and all 16
scratch end-to-end assertions. The latter uses real local servers and memory-backed cloud logic, not real Catalyst/Ably. It now
checks both replicas against the cloud's winning title and removes its scratch data/processes on completion.

## Where the code is
| Part | Files |
|---|---|
| Cloud (members, invites, change log, push token) | `functions/backup/workspaces.js`, `workspacesStorage.js`, `workspaceRoutes.js`, `workspaceDelivery.js` |
| Local server (partitions, journal, apply, assignee) | `api/.../domain/SyncJournal.java`, `SyncService.java`, `web/SyncController.java`, `auth/OwnerSessionFilter.java`, `TaskService.java` |
| Desktop engine | `desktop/workspaceSync.js`, `workspacePush.js`, wiring in `main.js` / `preload.js` |
| Screens | `web/src/components/shell/WorkspaceSwitcher.tsx`, `ShareWorkspaceDialog.tsx`, `JoinWorkspaceDialog.tsx`, `pages/AssignedPage.tsx`, `lib/workspaceStore.ts`, the `@` card (`notes/MentionMenu.tsx`) |
| End-to-end check | `node desktop/e2e/workspaces.e2e.js` (two real servers, the real engine, the real cloud logic over memory; needs the jar built) |

## Not built yet
- Shared notes and databases (only lists and tasks are shared in this version).
- `hitlist://` links (the invite page has a copy button instead).
- Compacting the change log (a long-lived busy workspace will replay a long log on a new member's first join).
- A visible "writes used this month" counter.
- Not yet tried against the real Catalyst project and Ably (needs the setup above); the end-to-end check uses an in-memory cloud.
