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
