# Automations

Rules that run while HitList is open: **when** something happens, **only if** conditions hold, **then** actions run. The page is
*Automations* in the sidebar; *New rule* offers ready-made templates and a builder (like Notion's database automations).

## What a rule can do (version 2)
- **Looks at:** your own tasks, or a shared workspace's tasks on this computer. Optionally only one task.
- **When** (any of up to 4): a due date is reached (with signed offsets, for example 1 hour before and at due time) · every day /
  weekday / week / month at a time (optionally as a summary of what is due) · a task is added · a task's fields change ·
  a task's status becomes … · you press *Run now*.
- **Only if** (up to 8, all must be true, read when the rule runs): a task field (title, status, quadrant, list, category, due
  date/time, note, priority) *is / is not / contains / starts with / is empty / is set / is before / is after* a value.
- **Then** (up to 5, in order): notify in HitList · desktop notification · **notify via the Cliq bot** · change the task's status.
- **Messages** can use words that are filled in per task: `{{title}} {{due}} {{when}} {{status}} {{list}} {{assignee}} {{rule}} {{count}}`.
- **Cliq action settings:** message text; one combined message for tasks that run together (lists up to 10, "and N more") or one
  per task; quiet hours (messages wait until they end); a daily limit per rule (default 30); *Send a test with this message*.
  It messages **you**, at the Cliq address saved in *Account → Cliq alerts* (never an address typed into a rule).
- **If HitList was closed:** moments up to a chosen age (not at all / 2 h / a day / a week) still run once; older ones are listed
  once in history as missed, never silently dropped. A new rule does not announce history unless you tick *also run for what is
  already due*.

## How it runs (one engine, checked every 60 seconds)
```
rule saved ──> each minute: PLAN  ──> hitlist_automation_queue (rule, item, moment, execute_at)
                           RUN   ──> claim rows where now >= execute_at (120 s lease) ─ conditions on the item as it is now ─
                                     actions ─ run record ─ row done      (all in ONE transaction)
Cliq action ──> hitlist_action_outbox ──> desktop (reserve → validate → /notify/message → ack | retry) ──> Cliq bot ──> DM
```
- **Execute-at.** A moment is stored with its execute-at time and runs once `now >= execute_at`. The key (rule, item, moment) is
  unique, so a moment never runs twice, across ticks or restarts. A crash mid-run leaves nothing half done: the lease runs out and the
  row is tried again (up to 5 times), then the rule shows "Stopped after 5 tries".
- **Events** (added / edited / status) are found by comparing with what the rule saw last time; the first look only records.
  A value that changes and changes back within one minute is not seen.
- **Time zones:** due dates carry no zone, so each rule reads them in the zone saved with it (the browser's at save time).
- The queue and outbox tables are SQLite-only (the desktop app). Outside SQLite the older computed sweep still runs, once a minute.
- **Cliq messages** pass through the Catalyst function (`POST /notify/message`: cleaned text up to 2,000 characters, domain
  allow-list, 60 messages a minute per person). The Cliq token never leaves the function.

## Older rules
A rule saved before this existed is read in the same shape (due-date offsets become *a due date is reached*, recurring/digest become
*every …*, channels become actions) and keeps its two-hour catch-up window. Nothing is rewritten until you save it. The old
`overdue` type keeps firing.

## Where the code is
| Part | Files |
|---|---|
| Rule shape and checks | `api/.../domain/AutomationSpecs.java`, `web/src/lib/automationSpec.ts` |
| Queue, execute-at, outbox | `api/.../storage/AutomationQueue.java` |
| Planner + runner | `api/.../domain/AutomationRunner.java`, `AutomationScheduler.java` (60 s) |
| Outbox for the desktop | `api/.../web/AutomationOutboxController.java`, `desktop/cliqAlerts.js` (`runOutbox`, `sendMessage`) |
| Function route | `functions/backup/index.js` (`/notify/message`), `cliq.js` (`cleanMessage`), `rateLimit.js` |
| Screens | `web/src/pages/AutomationsPage.tsx`, `components/automations/RuleBuilder.tsx`, `RuleTemplates.tsx`, `AutomationList.tsx` |

## Not built yet
- Database **records** as a source (triggers/conditions/actions on a database's rows), *create a task/record* action, a button
  trigger, webhooks, "assigned to me" trigger.
- Messaging a *different* person (assignee or members); today it is always you.
- Verified Cliq linking (the saved address is typed by the person; the function limits it to the company domain).
- A preview of "what would run in the next 7 days".
