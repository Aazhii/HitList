# Slate — frontend hosting

Git-based static hosting with framework detection and preview deploys.

`[VERIFIED]` observed here · `[DOCS]` official, untested · `[DOCS-WRONG]` docs disagree with
observation · `[UNKNOWN]` not established.

---

## Slate has no server

`[VERIFIED]` **This is the whole story, and it is worth being blunt about**, because the failure
is silent.

Slate serves static files with an SPA fallback. It has no backend. So `/api/anything` returns
your `index.html` with `200 text/html`:

```
GET https://example.onslate.in/api/health
200  content-type: text/html
<!doctype html><html lang="en">…
```

A frontend deployed there cannot reach a server unless you give it one somewhere else. In this
project the symptom was an app that loaded perfectly, showed "Working offline", stored
everything in `localStorage`, and made exactly **one** network call — the health check — because
the client correctly detected that an HTML response was not an API and stopped asking.

That detection is worth building deliberately. A `Content-Type` guard turns this into a clean
offline fallback instead of `Unexpected token '<'` crashes scattered through the app:

```ts
function isJsonResponse(res: Response): boolean {
  const ct = res.headers.get('content-type') ?? '';
  return ct.includes('application/json') || ct.includes('text/json');
}
```

---

## Pairing Slate with an API

Two arrangements work:

**Same origin — simplest.** Serve the built frontend from the AppSail server itself
(`express.static(dist)` plus an SPA fallback). One origin, no CORS, no cookie-domain problem,
and nothing can drift out of sync. This is what this project settled on.

**Slate plus AppSail — two origins.** Keep Slate's CDN and preview deploys, and point the
frontend at the AppSail URL:

```bash
# .env.production — Slate build only
VITE_API_BASE_URL=https://hitlist-api-50045863073.development.catalystappsail.in
```

Then on the API side: allow that origin explicitly, and send credentials from the client.

`[VERIFIED]` `cors({ origin: '*' })` **cannot work** here — the wildcard is incompatible with
credentialed requests, so the browser never attaches the session cookie. An allowlist is
required, not merely tidier. And the client needs `credentials: 'include'`; the default
`same-origin` silently drops the cookie cross-origin and every request becomes a 401.

Verified working:

```
OPTIONS /api/tasks   Origin: https://…onslate.in  → 200
GET     /api/health  Origin: https://…onslate.in  → access-control-allow-origin: https://…onslate.in
                                                     access-control-allow-credentials: true
```

`[DOCS]` Note the cookie-domain caveat from [05-appsail-deploy](05-appsail-deploy.md#domains-and-cookies):
`*.onslate.*` and `*.catalystappsail.*` are different domains, so a Catalyst session established
on one does not automatically authenticate the other. Same-origin avoids this entirely.

### Build profiles must be separate

`[VERIFIED]` A subtle trap. Vite applies `.env.production` to **every** production build — so
adding it for Slate also changed the AppSail build, which then called its own API through an
absolute URL instead of a relative path. That is only equivalent while the hostname matches
exactly, and it broke the moment the app was opened with a trailing dot.

Use a separate mode for the same-origin build:

```bash
vite build --mode appsail    # loads .env.appsail, where VITE_API_BASE_URL is empty
```

Relative URLs are correct by construction for a same-origin deployment: immune to trailing
dots, custom domains, and the hostname change that comes with promoting to Production.

---

## Deploying

`[VERIFIED]` **Slate builds from git.** A commit must be pushed before it can deploy — unlike
AppSail, which uploads your local bundle. Mixing the two up wastes a lot of time: "I deployed
and nothing changed" usually means the commit is still local.

`[DOCS]` Commands:

```bash
catalyst deploy slate                     # to Development
catalyst deploy slate --production        # to Production
```

`[DOCS]` Slate URLs are `https://<subdomain>.onslate.<tld>`, per data centre — `.com`, `.eu`,
`.in`, `.au`, `.ca`.

---

## The npm 10 build failure

`[VERIFIED]` Worth recording because the error names nothing useful and the fix is not obvious.

The deploy log:

```
Installing the dependencies using pnpm...
Command failed: npm install
npm error Cannot read properties of null (reading 'edgesOut')
```

Note the contradiction in those two lines — the deployer reports pnpm and then runs `npm
install`. The image (Slate deployer v0.0.4, npm 10.9.2) has no documented install-command
override, so `npm install` has to work.

Bisected to `vitest@^4.1.11` alone. vitest 4 declares optional peers with `*` ranges (`jsdom`,
`happy-dom`, `@edge-runtime/vm`) alongside self-referential ones pinned to its own version, and
`jsdom` is also a direct devDependency. That shape crashes npm 10's arborist while building the
ideal tree. **npm 11 handles it**, which is why nothing failed locally.

The fix is a committed `package-lock.json` — with a lockfile npm skips that resolution path:

```
before   fails after 42s
after    635 packages, 3s
```

`[VERIFIED]` Two consequences if your project uses pnpm:

- You now carry **two lockfiles**, and drift is dangerous: add a dependency with pnpm alone and
  the deploy silently ships the old tree. Check them against each other in CI
  ([`scripts/check-lockfiles.mjs`](../../scripts/check-lockfiles.mjs)).
- npm's arborist cannot read a pnpm-created `node_modules` — it fails with a different
  null-property error. Generate the npm lockfile in a scratch directory
  (`pnpm run lock:npm`).
