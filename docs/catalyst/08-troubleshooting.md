# Symptom → cause → fix

Keyed on the text you actually see. Most of these name something other than their real cause,
which is why they are worth a table.

`[VERIFIED]` observed here · `[DOCS]` official, untested.

---

## Errors that lie about their cause

| You see | It actually is | Fix |
|---|---|---|
| `CatalystAppError: unable to find the type of initialisation` `[VERIFIED]` | `initialize()` was given something that is not a request. A bare `{}` matches neither `headers` nor `catalystHeaders` | Pass the real `req`, or use `initializeApp()` with explicit credentials. **Do not catch this and fall back** — it means the call is malformed, not that Catalyst is down. [02](02-node-sdk.md#initialisation) |
| `404 {"error_code":"INVALID_ID","message":"No such Table with the given id exists"}` `[VERIFIED]` | The id was rounded by `JSON.parse` — Catalyst ids exceed `MAX_SAFE_INTEGER`. The table is fine | Quote 16+ digit literals before parsing; resolve tables by name. [03](03-datastore.md#ids-are-bigint) |
| `401 Authentication failed` / `401 INVALID_TOKEN` on a token you just minted `[VERIFIED]` | Wrong data centre. The region is part of the credential | Set `X_ZOHO_CATALYST_CONSOLE_URL` **before importing the SDK**. [01](01-credentials.md#data-centres) |
| `503 Execution failed. Please check the startup command or port.` `[VERIFIED]` | Almost never the command. Five candidates — missing `node_modules`, wrong `source`, wrong port, relative `build_path`, slow bind | Deploy a nine-line probe to separate platform from app. [05](05-appsail-deploy.md#the-503) |
| `server://net-issue` code 700 `[VERIFIED]` | *Any* non-2xx, including an ordinary signed-out 401 | The code tells you nothing — read the network tab for the real status and content-type. [04](04-auth-embedded.md#error-code-700) |
| `400 INVALID_INPUT` on a row write `[VERIFIED]` | The `{"data": […]}` wrapper the docs show | Send a **bare array**. [03](03-datastore.md#rest-payload-shapes) |
| `INVALID_REQUEST_METHOD` on a row update `[VERIFIED]` | `PUT /table/{name}/row/{id}` is not supported | `PATCH /table/{name}/row` with a bare array carrying `ROWID`. [03](03-datastore.md#rest-payload-shapes) |
| `403 INVALID_OPERATION … Column name cannot contain reserved keywords` `[VERIFIED]` | A reserved column name. `Priority` is one | Rename it. [03](03-datastore.md#reserved-column-names) |
| `400 environment_variables must not contain reserved keywords` `[VERIFIED]` | `CATALYST_` or `NODE_` prefix in `env_variables` | Rename the variable. [05](05-appsail-deploy.md#environment-variables) |
| `500 INTERNAL_SERVER_ERROR` creating a column `[VERIFIED]` | Intermittent; succeeds on retry | Retry 5xx only — never 4xx. [03](03-datastore.md#creating-tables) |
| `npm error Cannot read properties of null (reading 'edgesOut')` `[VERIFIED]` | npm 10 arborist crashing on `vitest@4`'s optional peer ranges | Commit a `package-lock.json`. [06](06-slate.md#the-npm-10-build-failure) |
| `EBADENGINE` on deploy `[VERIFIED]` | A stale `engines` constraint in the bundle's `package.json` | Match it to what you actually compile for. [05](05-appsail-deploy.md#ship-compiled-javascript-not-typescript) |
| `Uncaught ReferenceError: I18N is not defined` `[DOCS]` | `init.js` loaded before `catalystWebSDK.js` | Fix the script order. [04](04-auth-embedded.md#loading-the-web-sdk) |
| `[object Object]` in a log or a UI banner `[VERIFIED]` | The SDK throws plain objects, not `Error`s; `String(e)` on one gives this | Render `name`/`code`/`statusCode`/`message`. Do this **first** — it often reveals the real error immediately. [02](02-node-sdk.md#errors) |

---

## Wrong behaviour with no error at all

These are worse, because nothing fails loudly.

| You see | It actually is | Fix |
|---|---|---|
| Server rejects `DATABASE_URL` while running inside Catalyst | AppSail must use Catalyst Data Store, not an external local database | Remove `DATABASE_URL` from AppSail service configuration. |
| A signed-in user gets 401 on every API call `[VERIFIED]` | Identity resolved with `scope: 'admin'`, which is the project admin — not an app user — so `getCurrentUser()` returns null | Use `scope: 'user'` for identity, `admin` for data. [02](02-node-sdk.md#scope) |
| Writes rejected, error does not mention permissions `[DOCS]` | App User role has SELECT only by default | Use admin scope, or widen the role in the console. [03](03-datastore.md#table-permissions) |
| `signUp()` does nothing and no email arrives `[DOCS]` | Public signup is disabled — console-only, and it fails silently | Console → Authentication → Settings. [04](04-auth-embedded.md#prerequisites-you-cannot-do-from-code) |
| A user was created but no email arrived `[VERIFIED]` | Often a typo in the address — a valid unconfirmed user whose mail goes nowhere | Check the stored address before suspecting the platform. [04](04-auth-embedded.md#app-users-versus-collaborators) |
| `getCurrentUser()` returns null for the project owner `[DOCS]` | Console collaborators are not app users | Create an app user and confirm the invitation. [04](04-auth-embedded.md#app-users-versus-collaborators) |
| The login form shows every step at once, overflowing `[VERIFIED]` | `css_url` replaced Catalyst's stylesheet, removing the `display:none` rules that hide inactive steps | Build base + theme. [04](04-auth-embedded.md#styling-the-form) |
| The login iframe is invisible `[VERIFIED]` | It has no intrinsic height, and a `min-height` on the container does not help | Set a real height on the iframe element. [04](04-auth-embedded.md#the-iframe-has-no-intrinsic-height) |
| The login form scrolls internally; the email field is above the fold `[VERIFIED]` | Catalyst's `.signin_container` / `.signin_box` carry `min-height: 520px` plus a `margin-top` in an always-applied mobile query | Override those box metrics with `!important`. [04](04-auth-embedded.md#the-iframe-has-no-intrinsic-height) |
| Requests go out with **no `Authorization` header** `[VERIFIED]` | A duck-typed `{getToken}` credential — accepted by `initializeApp`, then ignored | Use `catalyst.credential.accessToken()` / `.refreshToken()`. [02](02-node-sdk.md#initialisation) |
| Works for an hour, then silently stops `[VERIFIED]` | The access token expired. `getAccessToken()` returns a cached token without checking expiry | Memoise with a TTL; force one refresh on rejection. [01](01-credentials.md#the-token-expiry-trap) |
| `400` with an **HTML** body from the API `[VERIFIED]` | Token refreshes are being throttled — not a malformed query | Stop forcing a refresh per call. [01](01-credentials.md#the-token-expiry-trap) |
| `/api/*` returns `200 text/html` `[VERIFIED]` | You are on Slate, which has no server; the SPA fallback answers everything | Deploy an API somewhere. [06](06-slate.md#slate-has-no-server) |
| The app says "offline" on a deployment that *has* an API `[VERIFIED]` | Reached via a hostname the bundle's absolute API URL does not match — a trailing dot is enough to make a different origin | Use relative URLs same-origin; normalise the trailing dot in CORS. [05](05-appsail-deploy.md#domains-and-cookies) |
| Every cross-origin request is a 401 `[VERIFIED]` | Missing `credentials: 'include'`, or `cors({origin:'*'})`, which cannot carry cookies | Allowlist plus credentials on both sides. [06](06-slate.md#pairing-slate-with-an-api) |
| A deploy "succeeds" but nothing changed `[VERIFIED]` | Slate deploys from **git** (needs a push); AppSail uploads the **local** bundle | Check which platform you are on. [05](05-appsail-deploy.md#deploying) · [06](06-slate.md#deploying) |
| AppSail cannot start the image | The image is not OCI Linux/amd64, the command exits, or the configured port is wrong | Build with `docker buildx build --platform linux/amd64`; ensure `/health` responds on AppSail's injected port. [05](05-appsail-deploy.md) |
| A column is shorter than you declared `[VERIFIED]` | `varchar` is clamped to 255 with no error | Query the column list after creating a table. [03](03-datastore.md#varchar-is-silently-clamped-to-255) |
| Numeric sorting is wrong — `"10"` before `"9"` `[VERIFIED]` | The column is `text`, not `int` | Use real column types. [03](03-datastore.md#column-types) |
| A stale file keeps being served after you deleted it `[VERIFIED]` | Vite does not remove files dropped from `public/` out of an existing `dist/` | Clean the output directory before building. |

---

## When you are stuck

The techniques that actually broke things open here, roughly in order of how often they worked:

1. **Print the error properly.** The SDK throws plain objects. A week-old mystery became a
   plain `400` the moment it was rendered with its `statusCode` and `message`.
2. **Read the network tab, not the error code.** Code 700 covers every failure; the underlying
   request's status and `content-type` tell you which one. `200 text/html` where you expect JSON
   means you are talking to a SPA fallback, not an API.
3. **Deploy a nine-line probe.** For anything where the platform might be at fault, an app with
   no dependencies separates "the platform is misconfigured" from "my app crashes". Disable any
   `predeploy` hook first, or it will overwrite your probe.
4. **Probe the API for the shape it wants.** Send the same row three ways and see which returns
   200. That is how the bare-array payload shape was established, and it takes a minute.
5. **Read Catalyst's own files.** The SDK source under `node_modules` and the published
   stylesheet are authoritative and citable by line number. Several answers that are in no
   documentation were sitting in them.
6. **Check the data before the code.** Empty UI with working auth was a tasks-reference-missing-
   lists problem, not a bug. Query the tables directly first.
