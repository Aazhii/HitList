# Credentials, tokens and data centres

`[VERIFIED]` observed here · `[DOCS]` official, untested · `[DOCS-WRONG]` docs disagree with
observation · `[UNKNOWN]` not established. See [README](README.md#how-claims-are-marked).

---

## Data centres

Catalyst is partitioned by region, and **the region is part of the credential**. A token minted
in one data centre is rejected by another.

`[VERIFIED]` The rejection is `401 Authentication failed` (seen through the SDK) or
`401 INVALID_TOKEN` (seen through REST). Both read as "your token is bad", which sends you off
to re-mint a perfectly good token. If a token that should work does not, check the host first.

| DC | API host | Accounts host |
|---|---|---|
| `us` | `https://api.catalyst.zoho.com` | `https://accounts.zoho.com` |
| `eu` | `https://api.catalyst.zoho.eu` | `https://accounts.zoho.eu` |
| `in` | `https://api.catalyst.zoho.in` | `https://accounts.zoho.in` |
| `au` | `https://api.catalyst.zoho.com.au` | `https://accounts.zoho.com.au` |
| `ca` | `https://api.catalyst.zohocloud.ca` | `https://accounts.zohocloud.ca` |
| `jp` | `https://api.catalyst.zoho.jp` | `https://accounts.zoho.jp` |
| `sa` | `https://api.catalyst.zoho.sa` | `https://accounts.zoho.sa` |

**This project is `in`.**

`[VERIFIED]` Some assets are *not* region-specific. The embedded sign-in stylesheet is
byte-identical from the `.com` and `.in` hosts — both 30,030 bytes. So a 200 from a `.com` URL
does not prove your region is right.

The SDK reads its host from `X_ZOHO_CATALYST_CONSOLE_URL` (and `X_ZOHO_CATALYST_ACCOUNTS_URL`)
**once, at module load**. Setting them later has no effect — see
[02-node-sdk](02-node-sdk.md#region-must-be-set-before-the-sdk-is-imported).

---

## Three ways to authenticate

Which one applies is decided by *where the code runs*, not by preference.

| Mode | When | How credentials arrive |
|---|---|---|
| **Gateway** | Running inside Catalyst — AppSail, a Function, or local `catalyst serve` | Injected per request as `x-zc-*` headers |
| **Standalone** | Any Node process, anywhere | An OAuth client + refresh token you supply |
| **CLI-backed** | A developer machine where someone ran `catalyst login` | Borrowed from the CLI's own stored grant |

The third is not an official mode. It is a technique, and it is what makes local development
against the real project possible without putting secrets in the repo. It reaches into another
package's internals, so treat it as best-effort.

---

## The CLI

```bash
npm install -g zcatalyst-cli
catalyst login                                                    # interactive; cannot be scripted
catalyst init --org 60084215173 -p 69251000000061001 -ni --dc in
catalyst whoami                                                   # confirm
```

### What `catalyst init` writes

`[VERIFIED]` A project-local `.catalystrc` holding **identifiers only — no credentials**:

```json
{ "projects": [{
    "id": "69251000000061001",
    "name": "HitList",
    "domain": { "id": "50045863073", "name": "hitlist-60084215173.development" },
    "timezone": "Asia/Kolkata",
    "env": [{ "id": "60084215173", "name": "Development", "type": 3 }]
}] }
```

Two things worth noting: `domain.id` is the **ZAID** you need for the Web SDK, and the org id
lives at `env[0].id` — the org and environment share that field.

### Where the login actually lives

`[VERIFIED]` `catalyst login` stores an **encrypted** OAuth grant in the CLI's own config
directory, *not* in `.catalystrc`. Reading `.catalystrc` looking for a token finds nothing —
an earlier version of our setup script did exactly that.

| Platform | Path |
|---|---|
| macOS | `~/Library/Preferences/zcatalyst-cli-nodejs/zcatalyst-cli-v1.json` |
| Linux | `~/.config/zcatalyst-cli-nodejs/zcatalyst-cli-v1.json` |
| Windows | `%APPDATA%/zcatalyst-cli-nodejs/Config/zcatalyst-cli-v1.json` |

Shape: `active_dc` at the top, then per-DC `credential` (encrypted) and `user.ZUID` / `user.Email`.

### Borrowing it

The CLI ships the module that decrypts it. Reference implementation:
[`server/catalyst/cliCredentials.ts`](../../server/catalyst/cliCredentials.ts).

```js
const Credential = require(`${npmRootGlobal}/zcatalyst-cli/lib/authentication/credential.js`).default;
const store = JSON.parse(fs.readFileSync(cliConfigPath, 'utf8'));
Credential.init(store[store.active_dc].credential);
const token = await Credential.getAccessToken();   // see the trap below
```

This depends on another package's internal layout. Guard it and fall back rather than assuming
it works.

### The token-expiry trap

`[VERIFIED]` Two failure modes, and the obvious fix for the first causes the second.

1. `getAccessToken()` returns its **cached** token whenever one is present and only refreshes
   when it is absent — **it never checks expiry**. The token decrypted from the CLI's config
   may already be dead, so calls fail with no hint that a refresh would fix it.
2. `getAccessToken(true)` forces a refresh — but calling it on *every* request gets throttled,
   and the rejection arrives as **`400` with an HTML error page**. That reads as a malformed
   query, not a throttled credential, and sends you debugging the wrong thing entirely.

What works: memoise the token (we use 45 minutes, comfortably inside its ~1 hour life) and
force exactly one refresh when Catalyst rejects what you have.

`[VERIFIED]` Catalyst access tokens last about an hour.

---

## Standalone credentials

Mint an OAuth client at <https://api-console.zoho.com> — a Self Client is enough — with these
scopes `[DOCS]`:

```
ZohoCatalyst.tables.READ
ZohoCatalyst.tables.rows.CREATE
ZohoCatalyst.tables.rows.READ
ZohoCatalyst.tables.rows.UPDATE
ZohoCatalyst.tables.rows.DELETE
```

Exchange the grant for a refresh token, then:

```bash
CATALYST_PROJECT_ID=69251000000061001
CATALYST_PROJECT_KEY=<from the console>
CATALYST_ENVIRONMENT=Development
CATALYST_CLIENT_ID=<from api-console>
CATALYST_CLIENT_SECRET=<from api-console>
CATALYST_REFRESH_TOKEN=<from the exchange>
```

The refresh exchange is `POST {accountsHost}/oauth/v2/token` with `grant_type=refresh_token`.
**The client must be issued in the same data centre as the project** — a mismatch here produces
the same misleading `invalid_client` you would get from a genuinely wrong secret.

`[VERIFIED]` Treat a *partial* configuration as an error, not as a reason to fall back. Silent
fallback is how this project ran for weeks appearing configured while storing nothing.

### Loading them

`[VERIFIED]` `tsx` does **not** read `.env` files, and there is no implicit dotenv. A
`.env.local` full of correct `CATALYST_*` values is simply ignored, and the app falls back to
local storage while looking configured. Node 20.6+ solves it with no dependency:

```bash
node --env-file-if-exists=.env.local --import tsx server/notes-server.ts
```

---

## REST calls with an admin token

```bash
curl -s -X POST \
  -H "Authorization: Zoho-oauthtoken $TOKEN" \
  -H "CATALYST-ORG: 60084215173" \
  -H "Environment: Development" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT ROWID FROM KaizenTasks LIMIT 1"}' \
  "https://api.catalyst.zoho.in/baas/v1/project/69251000000061001/query"
```

The shape is always
`{apiHost}/baas/v1/project/{projectId}{path}`, with `Authorization`, `CATALYST-ORG` and
`Environment`. Note the auth scheme is `Zoho-oauthtoken`, not `Bearer`.

`[VERIFIED]` A CLI **token generated by `catalyst token:generate`** is *not* an OAuth token and
is rejected by this API with `401 INVALID_TOKEN` under both `Zoho-oauthtoken` and `Bearer`. Use
the decrypted access token instead.

---

## Identity under admin credentials

`[VERIFIED]` With CLI or standalone credentials the SDK is authenticated as **you** — a project
collaborator — not as an app user. There is no end-user session for `getCurrentUser()` to read,
so it returns null and every request looks unauthenticated.

This is not a bug to fix; it is what those credentials mean. Either accept a single-owner mode
(scope rows to a fixed id) or run under the gateway with real app-user sessions. See
[04-auth-embedded](04-auth-embedded.md#app-users-versus-collaborators).
