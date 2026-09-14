# AppSail — deploying a server

AppSail runs a persistent process: a normal Express app, not a stateless handler. Use it when
you have a long-lived server. Not Slate (static files only) and not Functions (stateless).

`[VERIFIED]` observed here · `[DOCS]` official, untested · `[DOCS-WRONG]` docs disagree with
observation · `[UNKNOWN]` not established.

---

## `app-config.json`

Lives in the **source directory**, which AppSail treats as the app root.

```json
{
  "command": "node server.js",
  "build_path": "./build",
  "stack": "node24",
  "memory": 512,
  "catalyst_auth": false,
  "env_variables": { "ALLOWED_ORIGINS": "https://example.onslate.in" },
  "scripts": { "predeploy": "npm run build:appsail", "preserve": "npm run build:appsail" }
}
```

| Field | Notes |
|---|---|
| `command` | Startup command, run from the app root |
| `build_path` | The deployable directory. `[DOCS]` Never `/` — it resolves to the filesystem root and tries to zip the whole disk |
| `stack` | `node24`…`node12`, `java25`…`java8`, `python_3_13`…`python_3_10` `[DOCS]` |
| `memory` | 256–2048 MB, default 512 `[DOCS]` |
| `catalyst_auth` | `[VERIFIED]` `true` wraps the service in Catalyst's own login and **intercepts your API**. Keep `false` if you handle auth yourself |
| `env_variables` | See the reserved prefixes below |
| `scripts` | `predeploy` / `preserve` run **locally**, before upload |

`catalyst.json` records the link:

```json
{ "appsail": [ { "source": "./build", "name": "hitlist-api" } ] }
```

### The CLI overwrites this file

`[VERIFIED]` `catalyst appsail:add` rewrites `app-config.json` from its own template — dropping
`scripts`, `catalyst_auth` and `env_variables`, and lowering `memory` to 256.

Losing `scripts` is the dangerous one: `build_path` points at `./build`, and with no
`predeploy` nothing creates it, so the deploy **uploads an empty directory** and succeeds. Check
the file after running `appsail:add`.

---

## Deploying

```bash
catalyst appsail:add --name hitlist-api --stack node24 \
  --source "$(pwd)" --build ./build --command "node server.js"

catalyst deploy appsail --name hitlist-api
```

`[DOCS]` **Always pass `--name`.** Without it the CLI defaults the service name to `AppSail` and
can target the wrong service.

`[VERIFIED]` `catalyst deploy appsail` uploads your **local** `build_path`. It does not deploy
from git — so you do not need to push, and a colleague's pushed commit does not reach it. (Slate
is the opposite; see [06-slate](06-slate.md).)

The URL is printed on success and is otherwise only visible in the console.
`pnpm run appsail:url` ([`scripts/appsail-url.mjs`](../../scripts/appsail-url.mjs)) prints it
again, with the service's running state:

```
HitList (69251000000061001) — in

  hitlist-api  [node24]  running
  https://hitlist-api-50045863073.development.catalystappsail.in
```

---

## The 503

```
503 {"status":"failure","data":{
  "message":"Execution failed. Please check the startup command or port.",
  "error_code":"INTERNAL_SERVER_ERROR"}}
```

`[VERIFIED]` **This message is misleading.** It names the startup command, but in five separate
incidents here the command was fine. It means "the process did not come up and bind the
expected port" — and the cause is almost always something else.

There are no runtime logs exposed through the CLI or the REST API, so the fastest way to make
progress is to **deploy a nine-line HTTP server** and see whether *that* works. That single test
separates "the platform is misconfigured" from "my app is crashing", and it is what finally
broke this open:

```js
import http from 'node:http';
const PORT = process.env.X_ZOHO_CATALYST_LISTEN_PORT || 9000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ probe: true, node: process.version, port: String(PORT) }));
}).listen(PORT, '0.0.0.0');
```

If the probe returns 200, the platform is fine and your app is crashing at startup. Note the
probe has **no dependencies** — which is itself diagnostic, given cause 1 below.

> When you run that probe, **disable the `predeploy` hook first**. Ours regenerated the bundle
> and overwrote the probe on every attempt, which cost two deploy cycles of confusion.

### The five causes, in the order they bit us

**1. AppSail does not run `npm install`.** `[VERIFIED]` On a managed Node runtime it starts the
uploaded directory as-is. A bundle with only `package.json` dies on `import express`, and the
platform reports it as a startup-command problem. **Vendor `node_modules` into the bundle.**
The documented AppSail layout includes `node_modules/` for exactly this reason.

> `[DOCS-WRONG]`-adjacent: the **Slate** deployer *does* run `npm install` (see
> [06-slate](06-slate.md)). Both statements are true; they are different platforms. Do not carry
> an assumption from one to the other.

**2. `source` pointed at the wrong directory.** `[VERIFIED]` AppSail treats the source directory
as the app root and expects `package.json` and the entry point at its top level, beside
`app-config.json`. Pointing `source` at the repo root gave a working directory with no
`server.js`, and `node server.js` failed — with the same message regardless of the app's
contents.

**3. The port.** `[VERIFIED]` AppSail injects `X_ZOHO_CATALYST_LISTEN_PORT`; **9000** is the
documented fallback. A local-dev default like 3001 means the process listens where the gateway
never probes.

```js
const PORT = process.env.X_ZOHO_CATALYST_LISTEN_PORT || process.env.PORT || 9000;
```

Validate it. `parseInt(undefined, 10)` is `NaN`, and `listen(NaN)` **silently binds a random
free port** — the server comes up somewhere nobody is looking.

**4. `build_path` must be absolute** when passed as a CLI flag. `[DOCS]` Relative paths are
accepted with no error and the app then fails at runtime with this same 503.

**5. Binding too slowly.** `[VERIFIED]` AppSail expects the port bound promptly. Doing slow work
— a Catalyst probe, a migration — *before* `listen()` can trip the health check. Bind first,
then settle, holding requests behind a readiness gate if they must not see a half-configured
backend.

---

## Environment variables

`[VERIFIED]` **`CATALYST_` and `NODE_` are reserved prefixes.** A deploy carrying them fails:

```
400 environment_variables must not contain reserved keywords
```

So `CATALYST_APP_OWNER` cannot be set on a deployment — we renamed ours to `APP_OWNER_ID`. Read
both names if you also support local `.env.local` files, where the prefixed name is fine.

`NODE_ENV` is also rejected, which has a consequence worth thinking about: a deployment may well
have **no** `NODE_ENV`. Default to production-safe behaviour rather than assuming development:

```ts
const IS_PRODUCTION = (process.env['NODE_ENV'] ?? 'production') !== 'development';
```

Otherwise a production service echoes raw datastore errors to clients.

---

## Building a bundle

`[VERIFIED]` Pointing `build_path` at a repo root uploaded ~310MB and installed 635 packages,
almost none of which production runs. A staged bundle:

```
before   ~310MB, 635 packages
after      1.2MB,  73 packages, install in 371ms
```

Script: [`scripts/build-appsail.mjs`](../../scripts/build-appsail.mjs). It stages `dist/`, the
compiled server, a slim `package.json` with only runtime dependencies, and vendored
`node_modules`.

Three guards worth copying, because a slim bundle fails at *runtime*, not at build time:

- Scan the server for bare imports and **refuse to build** if one is missing from the runtime
  dependency list. Otherwise adding a dependency silently produces a bundle that crashes on start.
- Copy only what runs. An earlier filter shipped a whole unrelated Java tree.
- Refuse to build without `dist/index.html`, rather than deploying a server with no frontend.

### Ship compiled JavaScript, not TypeScript

`[VERIFIED]` `node server.ts` works locally on Node 24 (native type stripping) but makes the
deployment depend on the platform's Node being 23.6+. When that assumption is wrong the only
symptom is the same opaque 503. Compiling with esbuild (`target: node18`, `format: esm`,
`packages: external`) removes the assumption.

Two related traps:

- An `engines` field left at `>=23.6` can be rejected at install time with `EBADENGINE`.
- `crypto.randomUUID()` as a bare global only exists from Node 19. Import it from `node:crypto`.

If you do run TypeScript directly, set `erasableSyntaxOnly` in tsconfig — an enum or parameter
property runs fine under `tsx` locally and crashes the deployed server.

### Path resolution differs between layouts

`[VERIFIED]` `__dirname` is not the same in `server/notes-server.ts` and a bundled `server.js`
sitting beside `dist/`. A hardcoded `../dist` made every non-API route 404 after bundling.
Resolve both candidates.

---

## Gateway identity

`[VERIFIED]` **The gateway injects admin-scope `x-zc-*` headers onto every request, including
anonymous ones.** Two consequences:

1. `catalyst.initialize(req)` **always succeeds**, so it is useless as an auth check.
2. `getCurrentUser()` is the real check — and it returns `null` for anonymous callers, because
   the injected identity is the project admin rather than an app user.

```js
const user = await catalyst.initialize(req, { scope: 'user' }).userManagement().getCurrentUser();
if (!user?.user_id) return res.status(401).json({ error: 'Unauthorized' });
```

If you run without end-user authentication you have no identity to attribute rows to. Scoping
everything to one shared owner works, but **make it opt-in** — defaulting to it silently turns a
multi-user app into a public one.

---

## Domains and cookies

`[DOCS]` Session cookies do not cross Catalyst's service domains:

| Pattern | Service |
|---|---|
| `*.catalystappsail.*` | AppSail |
| `*.catalystserverless.*` | Functions |
| `*.onslate.*` | Slate |

A login function on one will not authenticate requests to another. Host the auth flow on the
same origin as the app, or use domain mapping.

`[VERIFIED]` **A trailing dot makes a different origin.** `https://example.catalystappsail.in.`
is a valid FQDN that resolves identically, but the browser treats it as a separate origin. An
app reached that way finds its own absolute-URL API calls are cross-origin, CORS refuses them,
and it falls back to offline mode — on the one deployment that *does* have a working API.

Two defences: use **relative** URLs for a same-origin deployment (correct by construction, and
immune to this), and normalise the trailing dot before matching your CORS allowlist.
