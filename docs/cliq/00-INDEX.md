# HitList and Zoho Cliq

**Goal (phase 1):** when a task becomes overdue, HitList sends a message to the person through a Cliq bot.

| Phase | What | Status |
|---|---|---|
| A | Owner creates the Cliq bot and a webhook token, and proves the message endpoint with one curl ([01-setup.md](01-setup.md)) | **done 2026-10-02**: bot `hitlistbot`, region `.in`, the "connection check" message arrived in Cliq |
| B | Catalyst Function routes `POST /notify/overdue` and `/notify/test` (hold the token, check the caller and the email domain) | **built and deployed** (`functions/backup/cliq.js`, 6 tests; signed-out calls refused). Settings come from a local, git-ignored `functions/backup/.env.cliq` through `scripts/deploy-backup-function.sh` |
| C | Desktop notifier: every 15 minutes, one message for tasks that became overdue; at most 3 a day | **built** (`desktop/cliqAlerts.js`, 10 tests); awaiting a click-through |
| D | Account menu, "Cliq alerts": switch, Cliq email, "Send test message" | **built** (`CliqAlertsDialog`, 4 tests + 3 for the wording); awaiting a click-through |
| 2 | Verified linking through the bot (`link 123456`), replacing the typed email | later |

## How it fits together

```
HitList desktop --(newly overdue, one batch)--> Catalyst Function --(webhook call with the token)--> Cliq bot --> DM
```

- Overdue is known only on the desktop (tasks are local), so **alerts go out only while HitList is open**.
- The webhook token never ships in the app; only the Catalyst Function holds it.
- Everyone must have signed in to Cliq at least once and be able to see the bot.
- Out of scope for now: creating tasks from Cliq chat, buttons, widgets.

The full plan is in the planning notes; this folder holds the setup guide and, as things are built, the status.
