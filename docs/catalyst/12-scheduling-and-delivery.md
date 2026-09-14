# Scheduling and delivery — crons, email, push

How to run work on a schedule and get a message to a user. Everything here was probed against
the live project, because almost none of it is documented.

`[VERIFIED]` observed here · `[DOCS]` official, untested · `[DOCS-WRONG]` docs disagree with
observation · `[UNKNOWN]` not established.

---

## Crons: what runs, and what only looks like it does

`[VERIFIED]` **Read this before designing around Catalyst crons.** Three things
create cleanly and then never do what the payload says. All of the following was established by
watching a live project, not from documentation.

### The summary

| You want | Does it work? |
|---|---|
| `Periodic`, every N **hours** (N ≥ 1) | Yes |
| `Periodic`, under 60 minutes | **Rejected at creation** |
| `CronExpression`, e.g. a 5-minute step | **Created, enabled, and never fires** |
| `OneTime` at an exact instant | Yes — fires at the moment given |
| `target_type: "Webhook"` | Yes |
| `target_type: "AppSail"` | **Created, fires, and fails every time** |

No jobpool is needed for any of this. The project used here had none
(`GET /job_scheduling/jobpool` returned `[]`) and the webhook crons ran regardless.
Creating one is not an option from an ordinary CLI token anyway —
`POST /job_scheduling/jobpool` answers `401 OAUTH_SCOPE_MISMATCH`.

### CronExpression is accepted and never runs

`[VERIFIED]` A cron created with a five-minute step expression comes back looking perfect: the
expression echoed verbatim, `cron_status: true`, an id returned. It also comes back with

```json
"cron_detail": { "hour": 0, "minute": 0, "second": 0, "timezone": "Asia/Kolkata" }
```

After 25 minutes it had **`success_count: 0, failure_count: 0`** — never invoked once. The
scheduler evidently reads `cron_detail`, which a `cron_expression` does not populate, so the cron
is scheduled for an interval of zero and never runs.

**`success_count` and `failure_count` on the cron record are the only honest signal.** A 200 from
`POST /cron` means the payload validated, nothing more.

### An AppSail target fires and fails

`[VERIFIED]` Two `OneTime` crons, scheduled ninety seconds apart, pointed at the same endpoint:

| Target | Result |
|---|---|
| `target_type: "AppSail"`, `target_id`, relative `url` | `failure_count: 1` |
| `target_type: "Webhook"`, absolute `url` | `success_count: 1`, and the request reached the server |

So use **Webhook with the service's absolute URL**, even when the target is your own AppSail:

```json
{
  "cron_name": "hitlist_notification_sweep",
  "cron_type": "Periodic",
  "cron_status": true,
  "cron_detail": {
    "hour": 1, "minute": 0, "second": 0,
    "repetition_type": "every", "timezone": "Asia/Kolkata"
  },
  "job_meta": {
    "job_name": "notification_sweep",
    "target_type": "Webhook",
    "url": "https://<service>.development.catalystappsail.in/api/internal/tick",
    "request_method": "POST",
    "headers": { "x-tick-secret": "…" }
  }
}
```

### What to do when you need a sub-hourly schedule

You cannot get one from a Catalyst cron. Run the schedule **inside your AppSail service** and keep
an hourly cron as the backstop that wakes a stopped container.

The usual objection is that AppSail auto-scales to 1–5 instances, so an interval runs on all of
them. That is only a problem if the work is not idempotent. Claim each unit of work in the
database before acting on it — write a token, re-read it, and proceed only if yours won — and N
concurrent sweeps deliver exactly once. Concurrency then costs a duplicate query, not a duplicate
notification. See `server/notifications/scheduler.ts` and `queue.ts`.

### Three validation rules that are not in any doc

`[VERIFIED]` All are rejected with `400 INVALID_INPUT` and a message that does name the problem:

| Rule | Error |
|---|---|
| `cron_name` and `job_name` accept **only alphanumerics and underscores** — no hyphens | `cron_name must contain only alphanumeric and underscore` |
| `request_method` is **required** on an AppSail or Webhook target | `The Request Method value cannot be empty` |
| A `Periodic` cron cannot run more often than **once an hour** | `Invalid input value for Periodic Schedule.Minimum Schedule time must be 60 minutes` |

The hyphen rule bites because service names *may* contain hyphens — `target_name` is
`hitlist-api` while `cron_name` cannot be.

### Cron types

`[DOCS]` From the SDK's `CRON_TYPE` enum:

| Type | `cron_detail` | Use |
|---|---|---|
| `Periodic` | `{ hour, minute, second, repetition_type: 'every', timezone? }` | Every N **hours**. The only repeating type proven to run `[VERIFIED]` |
| `OneTime` | `{ time_of_execution }` (epoch **ms**, as a string) `, timezone?` | A single event at an exact moment |
| `Calender` | daily / monthly / yearly variants | Fixed calendar times |
| `CronExpression` | `{ timezone? }` plus a top-level `cron_expression` | **Never fires** — see above `[VERIFIED]` |

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
