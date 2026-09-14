# The Node SDK

`zcatalyst-sdk-node` — use `^2.5.0` or later `[DOCS]`; this project runs `3.4.0`.

`[VERIFIED]` observed here · `[DOCS]` official, untested · `[DOCS-WRONG]` docs disagree with
observation · `[UNKNOWN]` not established.

Reference implementation: [`server/catalyst/init.ts`](../../server/catalyst/init.ts).

---

## Initialisation

There are exactly two entry points in the SDK. Everything else is a wrapper around one of them.

### `initialize(req)` — inside Catalyst

```js
import catalyst from 'zcatalyst-sdk-node';

app.get('/api/things', async (req, res) => {
  const app = catalyst.initialize(req, { scope: 'admin' });
  const rows = await app.zcql().executeZCQLQuery('SELECT ROWID FROM KaizenTasks LIMIT 1');
});
```

`[VERIFIED]` It reads the project credentials out of headers the gateway injects —
`x-zc-projectid`, `x-zc-project-key`, `x-zc-environment`, `x-zc-project-domain`,
`x-zc-project-secret-key`. The request object must carry `headers` (advancedio) or
`catalystHeaders` (basicio); nothing else is accepted.

> **`catalyst.initialize({})` cannot work.** A bare object matches neither shape, and it throws
> `CatalystAppError: unable to find the type of initialisation`.
>
> This is worth stating plainly because of how it fails in practice. Our startup probe called
> it inside a `try`, caught the error, and fell back to JSON files — so the server started
> cleanly, reported success, and stored nothing in Catalyst. It did that on every run for
> weeks. **If you catch this error, do not treat it as "Catalyst unavailable".** It means the
> call was malformed.

`[DOCS-WRONG]` Every Node sample in Catalyst's documentation begins from an ambient `app`
variable, and there is no "initialise outside a function" section anywhere in the bundled docs.
The gap is invisible until you read the SDK source.

### `initializeApp()` — anywhere

```js
import catalyst from 'zcatalyst-sdk-node';

const app = catalyst.initializeApp({
  project_id:  '69251000000061001',
  project_key: '60084215173',
  environment: 'Development',
  credential: catalyst.credential.refreshToken({
    client_id: '…', client_secret: '…', refresh_token: '…',
  }),
});
```

`[VERIFIED]` Three traps here, each of which produces a misleading symptom.

**A duck-typed credential is accepted and then ignored.** An object with a `getToken()` method
passes `initializeApp`'s validation, and requests then go out with **no `Authorization` header
at all**. There is no error. The only way we found it was tracing the outgoing HTTP request.
Use `catalyst.credential.accessToken(…)` or `.refreshToken(…)`.

**`initializeApp` refuses to reuse an app name**, throwing `duplicate_app`. If you need to
rebuild the app — to replace an expired token, say — pass a fresh name each time.

**`project_domain` does not control the request host**, despite appearances. It is used for JWT
exchange. The host comes from the environment variable below, and nothing else.

---

## Region must be set before the SDK is imported

`[VERIFIED]` The SDK resolves its API host **once, at module load**, from
`X_ZOHO_CATALYST_CONSOLE_URL`, defaulting to the US endpoint. Setting it afterwards has no
effect.

Get this wrong and every call goes to the US host with a credential minted elsewhere, and you
get `401 Authentication failed` — which reads as a bad token and sends you to re-mint a
perfectly good one.

```ts
// region.ts sets the env var. This import MUST come first.
import './region.ts';
import catalyst from 'zcatalyst-sdk-node';
```

Reference: [`server/catalyst/region.ts`](../../server/catalyst/region.ts), which derives the
region from the CLI's `active_dc`, and [`dc.ts`](../../server/catalyst/dc.ts) for the host map.

---

## Scope

`[VERIFIED]` **This is the single most expensive mistake in this document.** Scope decides
whose identity the SDK acts as, and the two uses need different answers.

| Scope | Use it for | Why |
|---|---|---|
| `'admin'` | Reading and writing rows | Table permissions never block a write. Catalyst grants the App User role SELECT only by default, so user scope breaks every insert. |
| `'user'` | Finding out who is calling | Under admin scope the SDK **is the project admin** — which is not an app user — so `getCurrentUser()` returns `null` even for a visitor with a valid session. |

Using admin scope for both is the obvious thing to do, and it produces a very confusing bug:
a user signs in successfully, the UI shows their name, and then every API call returns 401.
The session is real; you asked with the wrong identity.

```ts
// Data — admin
const dataApp = catalyst.initialize(req, { scope: 'admin' });

// Identity — user
const userApp = catalyst.initialize(req, { scope: 'user' });
const user = await userApp.userManagement().getCurrentUser();
if (!user?.user_id) return res.status(401).json({ error: 'unauthenticated' });
```

Both must be built **per request**, since only the request's own session distinguishes them.
Do not cache one app and reuse it.

---

## Under the gateway there is nothing to probe with

`[VERIFIED]` A startup probe cannot authenticate. Credentials arrive as per-request headers, so
at boot there is no request and therefore no credentials. A probe that calls
`initialize({})` fails, and if you treat that failure as "Catalyst is unavailable" you
downgrade the entire process to your fallback store — while running inside Catalyst.

That is exactly why our first successful deployment reported `backend: json-file`.

Detect the runtime instead and trust it, letting each request initialise from its own headers:

```ts
if (process.env['X_ZOHO_CATALYST_LISTEN_PORT']) {
  // AppSail. Credentials arrive per request; nothing to verify at boot.
  catalystAvailable = true;
}
```

---

## Deciding whether Catalyst is available at all

`[VERIFIED]` These environment variables signal a Catalyst runtime. **They are not all the same
kind of signal**, and treating them alike is a bug:

| Variable | Kind | Meaning |
|---|---|---|
| `CATALYST_CONFIG` | value | base64 JSON, injected by the Functions runtime |
| `X_ZOHO_CATALYST_LISTEN_PORT` | value | injected by AppSail |
| `ZOHO_CATALYST_PROJECT_KEY`, `CATALYST_PROJECT_KEY` | value | legacy names |
| `X_ZOHO_CATALYST_IS_LOCAL` | **boolean** | `"true"` under `catalyst serve` |

The last one holds a *string*. `!!"false"` is `true`, so a presence check on
`X_ZOHO_CATALYST_IS_LOCAL=false` switches Catalyst **on** and disables your fallback — the
opposite of what the value says. Parse booleans; check presence only for the value-carrying ones.

`NODE_ENV=production` is not a Catalyst signal and means nothing here.

---

## Errors

`[VERIFIED]` The SDK throws **plain objects**, not `Error` instances. `String(e)` on one gives
`"[object Object]"`, which is what our probe logged for a long time — hiding a perfectly
readable `400`.

```ts
function describeError(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    const parts = [o['name'], o['code'], o['statusCode'], o['message']]
      .filter((v) => v != null).map(String);
    if (parts.length) return parts.join(' | ');
    try { return JSON.stringify(e); } catch { /* fall through */ }
  }
  return String(e);
}
```

Do this before you start debugging anything else. The first useful thing we learned about a
week-old bug was visible the moment the error was printed properly.

---

## Service accessors

```js
app.datastore().table('KaizenTasks')   // → 03-datastore.md
app.zcql()                             // → 03-datastore.md
app.userManagement()                   // → 04-auth-embedded.md
app.cache().segment(id)                // → 07-other-services.md   [DOCS]
app.stratus().bucket(name)             // → 07-other-services.md   [DOCS]
app.nosql().table(name)                // → 07-other-services.md   [DOCS]
```
