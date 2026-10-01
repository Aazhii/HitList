# HitList and Zoho Cliq

**Goal (phase 1):** when a task becomes overdue, HitList sends a message to the person through a Cliq bot.

| Phase | What | Status |
|---|---|---|
| A | Owner creates the Cliq bot and a webhook token, and proves the message endpoint with one curl ([01-setup.md](01-setup.md)) | **waiting on the owner** |
| B | Catalyst Function route `POST /notify/overdue` (holds the token, checks the caller and the email domain) | not started |
| C | Desktop notifier: every 15 minutes, one message for tasks that became overdue; at most 3 a day | not started |
| D | Account menu, "Cliq alerts": switch, Cliq email, "Send test message" | not started |
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
