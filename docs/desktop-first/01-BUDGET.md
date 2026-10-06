# Free-tier budget

Numbers are from the Catalyst usage page the owner pasted on 2026-10-01 (Development environment). The owner confirmed
that **the counts reset every 30 days**, so the per-month figures below are the right unit. **Not known:** the Function
invocation and compute limits and the Authentication limits (neither was in the paste), and whether production has
different limits. Treat the user counts below as an upper bound until those are confirmed.

## Limits that matter (as pasted)

| Service | Limit | Used when pasted |
|---|---|---|
| Data Store: Insert | 5,000 requests | 1 |
| Data Store: Update | 1,000 requests | 0 |
| Data Store: Delete | 1,000 requests | 0 |
| Data Store: Fetch | 10,000 requests | 6 |
| Data Store: Storage | 2 GB | 0 |
| File Store: Upload | 2,000 requests | 1 |
| File Store: Download | 10,000 requests | 1 |
| File Store: Storage | 5 GB | 0 |
| Web Client: Fetch | 300,000 requests | 36 |
| API Gateway: Requests | 100,000 | 0 |
| Cache, Stratus, NoSQL, Search, Mail, Push | not used by this plan | n/a |

## What one person costs

A stored backup is: 1 Data Store insert, **1 Data Store fetch** (one index query serves both "unchanged?" and pruning),
1 File Store upload, and **1 batched Data Store delete per 7 backups** (old rows are removed 7 at a time once a user has
14). An unchanged workspace costs the cloud nothing: the desktop compares a content hash locally and does not call.
Restore is 1 fetch (list) plus 1 File Store download, and only happens on an empty install or just after sign-in.

Someone who works every day makes about 2 changed backups a day, about 60 a month.

| Limit | Per person per month | People it covers |
|---|---|---|
| File Store upload 2,000 | 60 | **about 33** (about 66 at one a day) |
| Data Store insert 5,000 | 60 | about 83 |
| Data Store fetch 10,000 | about 65 | about 150 |
| Data Store delete 1,000 | about 9 (one per 7 backups) | about 110 |
| File Store storage 5 GB | up to 13 files of roughly 1 MB | hundreds |

**The limit that bites first is File Store uploads: about 33 active people.** Ways to stretch it if needed: back up at
most once a day instead of every 6 hours (about 66 people), or store snapshots in the Data Store instead (storage is
2 GB but a row has a size limit, so only for small workspaces).

## Design choices that keep it small

- Nothing runs on a timer in the cloud. The old 5-minute server ping is gone; reminders and rules run in the desktop app.
- The AppSail (the web version) is not part of normal use and is stopped (D5), so it costs nothing.
- One backup is one file, however many tasks it holds.

## Historical plan: three-backup cap (superseded 2026-10-05)

The aim is to stay under every limit with room to spare, whatever anyone does:

| Guard | Where | Effect |
|---|---|---|
| At most **3 stored backups per person per rolling 24 hours** | the backup Function (cannot be bypassed by the app) | worst case 20 x 3 x 30 = **1,800 uploads of the 2,000** limit; realistic use (about 2 a day) is about 1,200 |
| No call at all when nothing changed | the desktop (content hash) | quiet days and idle people cost nothing |
| After the daily limit, no further calls until the time the server gave | the desktop | no repeated refused calls |
| After a server error, wait an hour before the next scheduled try | the desktop | a broken moment cannot become hundreds of calls |
| Offline attempts never reach the server | the desktop | free |
| Old backups removed in batches of 7 | the backup Function | 1 delete request per 7 backups |

Worst case at 20 people, per 30 days: uploads 1,800 / 2,000, inserts 1,800 / 5,000, fetches about 2,000 / 10,000, deletes
about 260 / 1,000, storage 20 people x 13 files x 1 MB = 260 MB / 5 GB. **Past about 22 people who all hit the cap every
day, uploads would run out**; lowering the cap to 2 a day (a one-line change) makes room for about 33.

## Update 2026-10-01: backups every 3 days, plus on sign-out

The owner decided that losing a machine is rare enough for a scheduled backup **every 3 days** (it was every 6 hours), plus
one when someone signs out (the "pre-logout" backup) and the *Back up now* button. There is no backup on quit any more.
If the person is offline when they sign out, the app says so and their data stays on the computer.

Account-isolation update (2026-10-04): each changed backup upload verifies cloud identity with one additional `GET /whoami` before sending private bytes. Restore list/download requests also verify identity. Unchanged local snapshots still make no upload or identity call. Pending local-save failures now cancel sign-out; cloud-backup failures remain best-effort and are reported after reload. See [02-ACCOUNT-ISOLATION.md](02-ACCOUNT-ISOLATION.md).

Per person per month: about 10 scheduled backups, plus a few sign-outs and manual ones, so **about 12–15 uploads**. At
15 uploads a person, File Store's 2,000 uploads cover about **130 people** (it was about 33), and the other limits cover more.
The server's cap was initially 3 stored backups per person per 24 hours (raised to 10 below). The cost of this choice is that up to
3 days of work can be lost if a computer is lost between backups.

## Update 2026-10-05: up to ten manual backups per rolling day

The owner requested up to 10 manual backups per day. The source now permits **10 successfully stored changed manual snapshots
per person per rolling 24 hours**. Login, logout, scheduled and update snapshots are exempt and consume no manual slots.
Unchanged snapshots consume no slot; failed attempts that store no snapshot consume no slot. The eleventh changed manual
backup returns the daily-limit response and retry time. Same-trigger concurrent clicks join one request; a different trigger
waits and runs under its own policy. Account switching/cancellation also cancels queued requests.

Pruning keeps the latest seven plus manual entries from the last 24 hours; recent manual entries must remain available for
allowance accounting. Pruning starts at fourteen retained entries and removes eligible entries outside that retention in a batch. The old fixed
one-delete-per-seven cost estimate is no longer guaranteed when a batch retains recent snapshots.

At maximum manual usage, one person can make **300 manual uploads per 30 days, plus automatic uploads**. Twenty people
reaching the manual cap every day can use **6,000 manual uploads and inserts**, above the recorded 2,000-upload and
5,000-insert allowances even before automatic backups. The upload allowance covers approximately six people at maximum
manual usage with no automatic uploads. Automatic triggers are uncapped by this policy, so there is no overall monthly
maximum derived from it. Typical 12-15 monthly uploads per person remain much cheaper; this is not a free-tier guarantee.

This is a source change, not a deployment. Add the optional `BackupReason` Text column to `Backups` before deploying the
updated function, with explicit authorization, and distribute a rebuilt desktop that sends `x-backup-reason`. Missing legacy
row reasons and older desktops' missing headers count as manual. Cached retry times apply only to the manual button in the
new desktop; automatic successes preserve that block. An older cloud function can still reject automatic backups under its
shared cap. Labels are client-reported, not lifecycle attestation. No cloud schema, live account limits or stored backups
were modified.

