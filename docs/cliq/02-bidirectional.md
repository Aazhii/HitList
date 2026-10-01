# Cliq Commands: Push Signal and Durable Inbox

## Implementation Status

The local execution foundation is implemented, but inbound bot commands are not
enabled in the application. No push provider credentials, cloud inbox tables,
verified linking routes, or bot Message handler have been deployed.

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

The worker is deliberately not imported by Electron's main process yet. Its
`execute` dependency must use the transactional endpoint, not ordinary task
creation requests or an in-memory receipt cache. Acknowledgment adapters must
throw on non-success responses rather than treating any HTTP response as an ACK.

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

Results have `status: applied` or `status: expired`. Mutation results include a
bounded task summary; list results include summaries, page, and `hasMore`.
Validation/conflict errors use the existing API error responses and must be
classified by the desktop adapter. Local transport failures remain retryable;
they must not be acknowledged as successful execution.

Generation/device validity currently comes from the supplied envelope, not a
verified local link registry. The endpoint authenticates the desktop owner, but
does not prove that the cloud has registered or approved that device generation.
The future cloud fetch/result endpoints must enforce those associations.

## Remaining Integration Gates

1. Rotate the exposed Cliq webhook token through the owner-controlled secret
   workflow. Do not retrieve function environment values through MCP discovery:
   the function listing may include secrets in its response.
2. Verify the Cliq Message handler's trusted sender/organization fields, stable
   event ID, secure webhook authentication, and asynchronous reply behavior.
3. Implement expiring link challenges and desktop confirmation. Bind one Cliq
   identity, one Catalyst account, and one active installation generation.
4. Verify cloud atomic uniqueness, challenge consumption, and durable triggered
   retries before provisioning the command inbox and dispatcher. Check-then-insert
   alone is not safe deduplication under concurrency.
5. Evaluate Ably as the initial provider candidate: scoped subscribe-only tokens,
   REST publishing, renewal/revocation, packaged Electron compatibility, pricing,
   and data handling. Never embed a provider master key in the desktop.
6. Wire Electron to the authenticated cloud endpoints and local executor; map
   failures, emit UI refresh events, and retry known unacknowledged work. A batch
   limit or worker error requires a bounded retry or manual/reconnect recovery,
   not unconditional periodic inbox polling.
7. Add linking, intake, connection status, manual fetch, and unlink controls.
8. Validate queued/applied/failed bot replies and full create/list/edit/complete
   workflows on a real desktop before enabling the feature.

## Recovery and Privacy

The cloud inbox holds commands until acknowledged. Persist first, then publish
an opaque inbox-changed signal. Failed publishes and bot result replies need
durable retry state and request-triggered dispatch, not unawaited work after an
HTTP response. Catch-up on attach/reconnect protects against missed signals.

Local command receipts are not included in current workspace backups. Restore,
reinstall, or database replacement must establish a new installation generation
before command intake resumes; otherwise previously completed commands could
replay without their receipts. Do not enable intake until this boundary exists.

Tasks remain local; command payloads and list results necessarily pass through
cloud services. The broker sees only opaque signals. A closed app or sleeping
computer is not awakened. Broker connections, token renewals, retries and cloud
storage still incur usage; neither zero idle usage nor free operation is promised.

## Validation

```sh
cd functions/backup && npm test
cd desktop && pnpm test
mvn -f api/pom.xml test
cd web && pnpm design:check && pnpm exec tsc -b && pnpm exec eslint src test && pnpm vitest run
```

If Maven is not on PATH, the VS Code Java test runner can execute the API tests.
Live overdue delivery still requires a task crossing its deadline after baseline
and confirmation of the actual bot DM, not only successful mocked HTTP calls.