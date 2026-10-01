# Free-tier budget

**Blocked:** paste the Catalyst free-tier limits here. The message that proposed this plan had
only a placeholder (`[Pasted text #12 +126 lines]`), not the text.

## How the budget is worked out

For each service the plan touches, one line: what one user costs per day, times the number of
users we expect, against the monthly free allowance.

| Service | What uses it | Per user per day (estimate) | Free allowance | Users it covers |
|---|---|---|---|---|
| Authentication | sign-in, about once a week per device; session checks only before a backup | < 1 | _from the plan_ | |
| Functions (invocations) | backup up to 4/day + list/restore rarely | ≤ 5 | _from the plan_ | |
| Functions (compute time) | each call reads or writes one compressed file | ≤ 5 short calls | _from the plan_ | |
| Data Store (rows / API calls) | one index row per snapshot, last 7 kept | ≤ 4 writes, ≤ 4 deletes | _from the plan_ | |
| File Store or Stratus (storage) | 7 compressed snapshots per user, typically tens of KB to a few MB each | — | _from the plan_ | |
| AppSail | nothing, once D5 is done | 0 | _from the plan_ | |

## Why it stays small

- Nothing runs on a timer in the cloud. The old 5-minute server ping and cron-style checks go
  away; reminders and rules run inside the desktop app.
- A backup is **one** file upload, not one Data Store write per task: a workspace with 2,000
  tasks is still one call.
- No upload when nothing changed since the last backup.
