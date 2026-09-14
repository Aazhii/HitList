# Scheduling and delivery — crons, email, push

How to run work on a schedule and get a message to a user. Everything here was probed against
the live project, because almost none of it is documented.

`[VERIFIED]` observed here · `[DOCS]` official, untested · `[DOCS-WRONG]` docs disagree with
observation · `[UNKNOWN]` not established.

---

## A cron can call your AppSail service directly

`[VERIFIED]` **This is the useful one.** You do not need a separate Cron *function* to run
scheduled work — a cron can POST straight to an endpoint on the AppSail service you already
deploy. No jobpool needs to be created first.

```bash
POST {apiHost}/baas/v1/project/{projectId}/cron
```

```json
{
  "cron_name": "hitlist_notification_sweep",
  "description": "Drains the notification queue",
  "cron_type": "CronExpression",
  "cron_expression": "*/5 * * * *",
  "cron_status": true,
  "cron_detail": { "timezone": "Asia/Kolkata" },
  "job_meta": {
    "job_name": "notification_sweep",
    "target_type": "AppSail",
    "target_id": "69251000000070009",
    "url": "/api/internal/tick",
    "request_method": "POST",
    "headers": { "x-tick-secret": "…" }
  }
}
```

`url` is **relative**; Catalyst resolves it against the service. `target_id` (the service id
from `GET /appsail`) and `target_name` both work.

Verified end to end: created (`200`, the stored record echoes `target_type: AppSail` and the
expression verbatim) and deleted (`200`). The project had **no jobpools at all** at the time,
which is what proves none is required.

### Three validation rules that are not in any doc

`[VERIFIED]` All three are rejected with `400 INVALID_INPUT` and a message that does name the
problem, so they cost minutes rather than hours — but only if you read it:

| Rule | Error |
|---|---|
| `cron_name` and `job_name` accept **only alphanumerics and underscores** — no hyphens | `cron_name must contain only alphanumeric and underscore` |
| `request_method` is **required** on an AppSail or Webhook target | `The Request Method value cannot be empty` |
| A `Periodic` cron cannot run more often than **once an hour** | `Invalid input value for Periodic Schedule.Minimum Schedule time must be 60 minutes` |

The hyphen rule bites because service names *may* contain hyphens — `target_name` is
`hitlist-api` while `cron_name` cannot be.

**The 60-minute floor is the one that changes designs.** `Periodic` looks like the obvious type
for "every five minutes" and is not usable for it. `CronExpression` has no such floor:
`*/5 * * * *` is accepted and stored verbatim. If you want a sub-hourly schedule, that is the
only cron type that will give you one.

### Cron types

`[DOCS]` From the SDK's `CRON_TYPE` enum:

| Type | `cron_detail` | Use |
|---|---|---|
| `Periodic` | `{ hour, minute, second, repetition_type: 'every', timezone? }` | Every N **hours** — see the 60-minute floor above `[VERIFIED]` |
| `OneTime` | `{ time_of_execution }` (epoch **ms**, as a string) `, timezone?` | A single event at an exact moment |
| `Calender` | daily / monthly / yearly variants | Fixed calendar times |
| `CronExpression` | `{ timezone? }` plus a top-level `cron_expression` | UNIX expression — **the only way to run sub-hourly** `[VERIFIED]` |

`OneTime` with millisecond precision is genuinely useful for "remind me at 15:45" — but note
that it creates a cloud object per reminder, which then has to be kept in step with every edit
and deletion of the thing it reminds about. A periodic sweep over a queue avoids that whole
class of drift; see the note on scale below.

`[DOCS]` Target types: `Function`, `Circuit`, `AppSail`, `Webhook`. Also available
programmatically via `app.jobScheduling().cron().createCron(...)`, with
`getAllCron` / `getCron` / `updateCron` / `pauseCron` / `resumeCron` / `deleteCron`.

### Why this matters for AppSail specifically

`[VERIFIED]` AppSail auto-scales **1–5 instances**. An in-process `setInterval` therefore runs
on *every* instance, so scheduled work fires up to five times. It is free, and it is wrong.

An external cron calling one endpoint is single-writer by construction. If you also need
protection against retries or overlapping ticks, make the work idempotent — a status transition
in the database (`PENDING → SENDING → SENT`) plus a unique dedupe key is reliable in a way that
in-memory state on a multi-instance service can never be.

---

## Email

```bash
POST {apiHost}/baas/v1/project/{projectId}/email/send
```

```json
{
  "from_email": "verified@yourdomain.com",
  "to_email": "someone@example.com",
  "subject": "…",
  "content": "…",
  "html_mode": true
}
```

SDK: `app.email().sendMail({ from_email, to_email, subject, content, cc, bcc, reply_to,
html_mode, display_name, attachments })`. `to_email` takes a string or an array.

### The sender must be registered first

`[VERIFIED]` This is a console step with no API, and it fails with an error that points at the
wrong thing:

```
404 {"error_code":"INVALID_ID","message":"No such from_email with the given id exists"}
```

`INVALID_ID` on a `404` reads like a bad project or route. It means **the `from_email` address
is not a registered sender for this project**. Register it in the console
(Catalyst → Email/Mail settings) and verify it before expecting any send to work.

Do not build an email channel and then debug it against an unregistered sender — check this
first, with one send to yourself.

---

## Web push

`[VERIFIED]` Recipients are **Catalyst app users**, addressed by email. There is no subscription
endpoint to manage and no token table to keep:

```bash
POST {apiHost}/baas/v1/project/{projectId}/project-user/notify
{ "message": "…", "recipients": ["user@example.com"] }
→ 200 {"status":"success","data":true}
```

SDK: `app.pushNotification().web().sendNotification(message, recipients)`.

That simplifies a notification system considerably — Catalyst already knows who your users are
from [authentication](04-auth-embedded.md), so the push channel needs no state of its own.

`[UNKNOWN]` **A `200` here means Catalyst accepted the request, not that a notification
appeared.** Actual delivery still depends on the browser having granted permission and the Web
SDK having registered for push. We have confirmed the API accepts and acknowledges; we have not
yet confirmed a notification rendering in a browser. Treat email as the channel that always
works and push as the enhancement.

`[DOCS]` Mobile push is separate: `app.pushNotification().mobile(appId)` with a registered
mobile application.

---

## Other background primitives

`[DOCS]`, from the installed SDK — none exercised here:

| Service | Accessor | Use |
|---|---|---|
| Jobs | `app.jobScheduling().job()` | `submitJob` / `getJob` / `deleteJob`. **Note:** the job meta has no delay or schedule field, so jobs run when submitted. For "later", use a cron. |
| Jobpools | `app.jobScheduling().getAllJobpool()` | Capacity pools for job execution |
| Circuits | `app.circuit()` | Multi-step orchestration |
| Queue | `lib/queue` | Present in the SDK; not documented in the bundled skills |
| Cache | `app.cache().segment(id)` | TTL in **hours**; `delete()` nulls the value rather than removing the key |

---

## A note on scale

`[VERIFIED]` reasoning, from building on this:

The instinct is to have the sweep examine every candidate — every task, every rule — on each
tick. That cost grows with the size of your database rather than with the amount of work due,
and it never stops growing.

Materialising due work into a queue inverts it: the tick runs one indexed query that normally
returns **zero rows**, whatever the total row count. The tick stays cheap, which matters when
you are paying per invocation, and the same property is what lets it scale.

It also makes the system self-healing. Selecting `FireAt <= now` rather than `FireAt == now`
means a missed tick delays delivery instead of dropping it — so an outage, a redeploy, or a
paused cron costs latency, not data.
