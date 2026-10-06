# Cliq Commands: Push Signal and Durable Inbox

## Implementation Status

The inbound command workflow is implemented in source, including linking controls,
cloud routes, and desktop intake. It is not live: provider credentials and inbox
tables are not configured, the webhook is not deployed, and the actual Cliq
Message handler parameter mapping still needs verification. The installed app
also needs a fresh UI/backend build before these controls are visible.

Implemented:

- `desktop/cliqInbox.js`: injected subscription, inbox fetch, execution, and
  acknowledgment interfaces. It attaches before catch-up, serializes drains,
  checks account/device/generation on each step, and cancels on stop. Signals
  and reconnects request a drain; no periodic polling is created.
- `desktop/cliqPush.js`: official Ably SDK adapter with authenticated scoped
  token renewal, opaque channel validation, reconnect signals, cancellation,
  and redacted errors. Ably is approved and the owner has an application;
  secure server configuration and live provider validation are still pending.
- `POST /api/cliq/commands`: local Java endpoint requiring the Electron desktop
  token and an owner matching the supplied Catalyst account. Browser-cookie
  authentication alone cannot call this endpoint.
- Transactional, owner-scoped SQLite receipts: task mutations and their result
  commit together. Replaying the same envelope returns the recorded result;
  reusing its command identity with different content is refused.
- Create, list, edit, and complete executors. Edits and completion require the
  task's exact `expectedUpdatedAt`; lists contain at most ten task summaries.
- Cliq outgoing requests have a ten-second timeout and reject redirects. CI
  now runs the whole function test script, including Cliq sender tests.

`desktop/cliqConnection.js` now wires the worker into Electron. It verifies the
local workspace before starting, persists the installation per account, and
executes through the transactional endpoint. Acknowledgment adapters reject
non-success HTTP responses. Intake starts only after linking and explicit opt-in.
Existing enabled links resume after app navigation; there is no inbox poll timer.

Cloud code lives in `functions/backup`: the strict parser, durable storage adapter,
linking/inbox service, Ably delivery adapter, authenticated routes, and secret-
authenticated webhook handler. `functions/cliq-webhook` is a separate CLI-generated
Advanced I/O function. Its prepare script copies the shared modules for deployment;
the backup function's Catalyst authentication must not be weakened for bot calls.

The push adapter's `requestToken(identity, {signal})` dependency must call an
authenticated cloud endpoint returning `accountId`, `deviceId`, `generation`,
an opaque `hitlist:inbox:<channel-id>` channel, and a temporary `token` string.
The server must issue subscribe-only capability for that exact channel;
channel-name validation alone is not authorization. Renewal cannot change the
account/device/generation or channel. No master key is passed to the SDK.

## Command Contract

Each command envelope has exactly these fields:

```json
{
  "id": "command-unique-id",
  "accountId": "75733000000033001",
  "deviceId": "installation-unique-id",
  "generation": 1,
  "schemaVersion": 1,
  "type": "create",
  "payload": { "title": "Prepare report", "dueDate": "2026-10-05" },
  "expiresAt": 1791244800000
}
```

`expiresAt` is a positive safe-integer epoch timestamp in milliseconds, not ISO
text. Account IDs remain strings. The cloud adapter must enforce the local
identifier limits before accepting commands (64 characters for command/device
IDs). The local request uses `X-Hitlist-Desktop-Token`,
`X-Hitlist-Desktop-Owner`, and a valid `X-Timezone` for list commands.

| Type | Payload |
| --- | --- |
| `create` | `title`, optional `dueDate` and `dueTime` |
| `list` | `filter`: `open`, `today`, or `overdue`; optional positive `page` |
| `edit` | `taskId`, `expectedUpdatedAt`, and one or more of `title`, `dueDate`, `dueTime` |
| `complete` | `taskId`, `expectedUpdatedAt` |

Results have `status: applied`, `status: failed`, or `status: expired`. Mutation results include a
bounded task summary; list results include summaries, page, and `hasMore`.
Validation/conflict errors use the existing API error responses and must be
classified by the desktop adapter. Local transport failures remain retryable;
they must not be acknowledged as successful execution.

Generation/device validity currently comes from the supplied envelope, not a
verified local link registry. The endpoint authenticates the desktop owner, but
does not prove that the cloud has registered or approved that device generation.
The cloud fetch/result endpoints enforce the confirmed link associations.

## Bot Commands and Linking

The first release requires the same allowed work email in HitList and Cliq.
Choose Link Cliq in the desktop dialog, send the displayed `link <code>` in the
bot chat, then confirm in HitList. The code is a random 32-character token valid
for ten minutes, not a six-digit PIN. A separate desktop-only nonce is never
shown to the bot. Switch on Receive tasks from Cliq after confirmation.

Supported grammar:

```text
help
add "Prepare report"
add "Prepare report" --due 2026-10-05 --time 17:00
list open
list overdue --page 2
done TASK_ID --version UPDATED_AT
edit TASK_ID "Updated title" --version UPDATED_AT
status COMMAND_ID
```

The bot handler must send a POST with `x-hitlist-cliq-secret` and this exact body,
using trusted sender metadata rather than IDs/email supplied in message text:

```json
{
  "eventId": "stable-upstream-message-id",
  "sender": { "id": "trusted-user-id", "orgId": "trusted-org-id", "email": "person@yourcompany.com" },
  "text": "add \"Prepare report\""
}
```

Live diagnostics verified `user.id`, `user.email`, `user.organization_id`, and
`message`. Recent history entries have `sender,time,text,id,type`, but the
triggering message could not be matched. Never select an older history entry as
the current event or manufacture an event ID from the execution timestamp.

The initial Message handler template is [message-handler.dg](message-handler.dg).
It uses an explicit request label for commands instead of an unverified message
ID. The handler strips the suffix before forwarding the strict command text:

```text
add "Prepare report" --request report-001
list open --request list-001
done TASK_ID --version UPDATED_AT --request complete-001
```

Retry with the SAME label and identical command. Use a NEW label for a new
request, even when its title matches an earlier task. Labels are scoped to the
trusted sender/organization; they do not grant authorization. A changed command
using an existing label returns a conflict. Link commands use their random
pairing code as a retry-stable identifier and do not need a request suffix.

Create a Cliq Custom Service with API Key authentication, Actual Parameter
`x-hitlist-cliq-secret`, and Param Type Header. Create its connection with link
name `hitlist_webhook`, using the same separately generated secret configured
as `CLIQ_WEBHOOK_SECRET` on the webhook function. Use owner-managed credentials,
not credentials supplied by each bot user. Restrict this connection's use and
editing to authorized integration maintainers; never reuse it with arbitrary URLs.
See [Cliq Connections](https://www.zoho.com/cliq/help/platform/connections.html).
Do not embed the secret in the Deluge source or diagnostic logs.

The template intentionally has an empty `webhookUrl`; populate only with the
verified deployed HTTPS webhook URL, never the authenticated backup endpoint.
Validate the template in the Cliq editor after creating the connection. No local
Deluge runtime is available, so Node tests validate the webhook contract, not
execution of the Deluge script. The function returns queued only after
persistence; the desktop result is replied separately. Typing commands before
deployment does not store a task.

Authenticated desktop routes are POST `/cliq/link`, `/cliq/link/start`,
`/cliq/link/confirm`, `/cliq/link/unlink`, `/cliq/token`, `/cliq/pending`, and
`/cliq/ack`. GET `/cliq/link?deviceId=...` is also supported.

The proposed `CliqLinks` table needs unique `UserId` and `SenderKey` columns, plus
`LinkId` and JSON `Value`. `CliqRecords` needs unique `RecordKey`, JSON `Value`,
`AccountId`, `DeviceId`, `Generation`, `Status`, and `CreatedAt`. Uniqueness is a
database requirement; never replace it with check-then-insert. Restrict direct
App User access: all reads/writes must go through account-scoped function routes.

## Remaining Integration Gates

1. Rotate the exposed Cliq webhook token through the owner-controlled secret
   workflow. Do not retrieve function environment values through MCP discovery:
   the function listing may include secrets in its response.
2. Verify the Cliq Message handler's trusted sender/organization fields, stable
   event ID, secure webhook authentication, and asynchronous reply behavior.
3. Provision and verify unique-key inbox tables with restricted permissions.
4. Verify cloud atomic uniqueness, challenge consumption, and durable triggered
   retries before provisioning the command inbox and dispatcher. Check-then-insert
   alone is not safe deduplication under concurrency.
5. Evaluate Ably as the initial provider candidate: scoped subscribe-only tokens,
   REST publishing, renewal/revocation, packaged Electron compatibility, pricing,
   and data handling. Never embed a provider master key in the desktop.
6. Test the wired desktop against deployed authenticated cloud endpoints. A batch
   limit or worker error requires a bounded retry or manual/reconnect recovery,
   not unconditional periodic inbox polling.
7. Configure the server-only `ABLY_API_KEY`, rotated `CLIQ_TOKEN`, allowed domains,
   bot name/region, `CLIQ_ORG_ID`, and separate `CLIQ_WEBHOOK_SECRET` of at least
   32 characters. Set `CLIQ_LINKS_TABLE`, `CLIQ_RECORDS_TABLE`, and enable
   `CLIQ_INBOUND_ENABLED=true` only after validation. Never paste secrets in chat.
8. Validate queued/applied/failed bot replies and full create/list/edit/complete
   workflows on a real desktop before enabling the feature.

## Recovery and Privacy

The cloud inbox holds commands until acknowledged. Persist first, then publish
an opaque inbox-changed signal. Repeated webhook events safely retry failed pushes;
repeated ACKs safely retry failed bot replies. There is not yet an independent
durable dispatcher, so a failed push may wait for webhook retry, reconnect,
startup, or Fetch now. A failed result DM needs an ACK retry. Do not claim
guaranteed prompt delivery during provider outages. There is no unawaited
background dispatch after a response and no cron or empty-inbox polling.

Local command receipts are not included in current workspace backups. Restore,
reinstall, or database replacement must establish a new installation generation
before command intake resumes; otherwise previously completed commands could
replay without their receipts. The desktop invalidates its link and rotates its
device before the app's restore action. External database replacement remains an
operator responsibility: unlink before replacing it, then relink afterward.

Tasks remain local; command payloads and list results necessarily pass through
cloud services. The broker sees only opaque signals. A closed app or sleeping
computer is not awakened. Broker connections, token renewals, retries and cloud
storage still incur usage; neither zero idle usage nor free operation is promised.

## Validation

```sh
cd functions/backup && npm test
cd functions/cliq-webhook && npm ci && npm test
cd desktop && pnpm test
mvn -f api/pom.xml test
cd web && pnpm design:check && pnpm exec tsc -b && pnpm exec eslint src test && pnpm vitest run
```

If Maven is not on PATH, the VS Code Java test runner can execute the API tests.
Live overdue delivery still requires a task crossing its deadline after baseline
and confirmation of the actual bot DM, not only successful mocked HTTP calls.