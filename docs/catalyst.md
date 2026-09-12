# Catalyst Data Store setup

The Express server persists to Zoho Catalyst Data Store, falling back to JSON
files in `server/` when no credentials are configured. This document covers
getting the real backend running.

## This project

| | |
|---|---|
| Project name | HitList |
| Project ID | `69251000000061001` |
| Org ID | `60084215173` |

## How the SDK authenticates

There are exactly two ways in, and the server supports both
(`server/catalyst/init.ts`).

**Gateway** — the app runs behind Catalyst, as AppSail, a Function, or locally
under `catalyst serve`. The gateway injects the project credentials as request
headers (`x-zc-projectid`, `x-zc-project-key`, `x-zc-environment`), and
`catalyst.initialize(req)` reads them. Nothing to configure.

**Standalone** — the app runs as a plain Node process (`pnpm dev`) and
authenticates with an OAuth refresh token via `catalyst.initializeApp(...)`.
This is what lets you develop against the real project without the CLI in the
loop.

> The bundled Catalyst docs cover neither: every Node sample starts from an
> ambient `app`. The server used to call `catalyst.initialize({})`, which
> throws `unable to find the type of initialisation` — which is why it silently
> used JSON files on every run.

Both initialise with `scope: 'admin'`. The default is `user` scope, which
applies row-level permissions for the signed-in App User — and Catalyst grants
App User `SELECT` only by default, so every write would be rejected. The server
authenticates callers itself and scopes every query by `OwnerId`.

## Option A — Catalyst CLI (recommended)

```bash
npm install -g zcatalyst-cli
catalyst login                                                    # opens a browser
catalyst init --org 60084215173 -p 69251000000061001 -ni --dc in
pnpm catalyst:setup                                               # create the tables
pnpm dev
```

`catalyst login` is interactive and cannot be scripted. Everything after it is
automatic: the server and the setup script both borrow the CLI's stored login,
so no secrets are needed in the repo and `pnpm dev` talks to the real project.

The CLI encrypts that grant in its own config directory — **not** in a readable
`~/.catalystrc`, which is what `catalyst init` writes (project ids only, no
credentials). `server/catalyst/cliCredentials.ts` calls the CLI's own module to
decrypt it, so it is best-effort and falls back cleanly if the CLI changes.

Under these credentials the SDK is authenticated as **you**, not as an end
user, so there is no session for `getCurrentUser()` to read. Rows are scoped to
your CLI account (`cli:<ZUID>`), overridable with `CATALYST_DEV_OWNER`. This is
single-user by construction and applies only outside the gateway.

## Option B — standalone credentials

Mint an OAuth client at <https://api-console.zoho.com> (Self Client is enough)
with these scopes:

```
ZohoCatalyst.tables.READ
ZohoCatalyst.tables.rows.CREATE
ZohoCatalyst.tables.rows.READ
ZohoCatalyst.tables.rows.UPDATE
ZohoCatalyst.tables.rows.DELETE
```

Exchange the grant code for a refresh token, then put this in `.env.local`
(gitignored):

```
CATALYST_PROJECT_ID=69251000000061001
CATALYST_ORG_ID=60084215173
CATALYST_PROJECT_KEY=<from the Catalyst console>
CATALYST_ENVIRONMENT=Development
CATALYST_CLIENT_ID=<from api-console>
CATALYST_CLIENT_SECRET=<from api-console>
CATALYST_REFRESH_TOKEN=<from the token exchange>
```

Then `pnpm catalyst:setup && pnpm dev`.

Outside the US data centre, also set `X_ZOHO_CATALYST_CONSOLE_URL` and
`X_ZOHO_CATALYST_ACCOUNTS_URL` — see `.env.example`.

## Things that will cost you an afternoon

Learned the hard way getting this working; none are in the Catalyst docs.

**The data centre is part of the credential.** The SDK picks its API host once,
at module load, from `X_ZOHO_CATALYST_CONSOLE_URL`, defaulting to the US
endpoint. A token from another region fails with `401 Authentication failed`,
which looks like a bad token rather than a wrong host. `server/catalyst/region.ts`
sets it from the CLI's `active_dc` and **must be imported before the SDK**.
Passing `project_domain` to `initializeApp` does not affect the request host.

**`initializeApp` accepts a credential it will not use.** A duck-typed
`{ getToken() }` object passes validation and is then silently ignored —
requests go out with no `Authorization` header. Use
`catalyst.credential.accessToken(...)` or `.refreshToken(...)`.

**Ids are BigInt and JSON.parse rounds them.** `table_id` 69251000000063001
parses to `...63000`, above `Number.MAX_SAFE_INTEGER`. Every later call with
the rounded id fails as `404 INVALID_ID`, which reads as "table does not
exist". The setup script quotes long integer literals before parsing. The same
applies to `ROWID` in anything that parses raw Catalyst JSON.

**`Priority` is a reserved column name.** Catalyst rejects it with
`INVALID_OPERATION`; the column is `TaskPriority`.

**Column creation returns intermittent 500s.** It succeeds on retry, so the
setup script retries 5xx — but not 4xx, which is a real answer.

**App User gets SELECT only by default.** Every write fails until the table
permissions are widened, and the error does not point at permissions.

## Schema

`server/catalyst/schema.ts` is the single definition; `pnpm catalyst:setup`
applies it and `pnpm catalyst:setup --dry-run` reports without changing
anything. Three tables, each with an `OwnerId` column that scopes every row to
its author:

| Table | Holds |
|-------|-------|
| `KaizenTasks` | tasks, with `TaskId` as the client-facing id |
| `KaizenLists` | lists |
| `KaizenNotes` | notes, with the editor blocks as JSON |

`ROWID` stays internal to Catalyst; the API exposes `TaskId`/`ListId`/`NoteId`.

### Permissions

After creating the tables, grant the **App User** role INSERT, UPDATE and
DELETE on all three in the console (Data Store → table → Permissions). Catalyst
grants SELECT only by default, and the resulting failures look like unrelated
write errors.

## Verifying

```bash
pnpm dev
curl localhost:3001/api/health
```

Look for `"backend":"catalyst"`. If it says `json-file`, the server did not
authenticate — the startup log names the reason. `catalystMode` reports whether
the request would use `gateway`, `standalone` or neither.

Then create a task in the UI and confirm the row in the Catalyst console. The
proof that it reached Catalyst rather than localStorage is clearing site data
and reloading: the task should come back.

## Deploying

Deploy to **AppSail**, which runs a persistent Node process. Not Slate: Slate
serves static files only, so `/api/*` would 404 there and the app would fall
back to localStorage with none of the persistence above working. Not Functions
either — this is a long-lived server.

One AppSail service hosts both halves. The server already serves `dist/` from
the same origin, so there is a single origin, no CORS, and no split-cookie
problem.

`app-config.json` holds the configuration:

| Field | Value | Why |
|-------|-------|-----|
| `command` | `node server/notes-server.ts` | Node 23.6+ strips types natively, so production ships no transpiler. `tsconfig.server.json` sets `erasableSyntaxOnly` to keep the server compatible — an enum would run under tsx locally and crash here. |
| `stack` | `node24` | Needed for native type stripping. |
| `build_path` | `.` | Never `/` — it resolves to the filesystem root and tries to zip the whole disk. |
| `catalyst_auth` | `false` | `true` wraps the service in Catalyst's own login and intercepts API requests. This app handles its own auth. |
| `scripts.predeploy` | `npm run build` | Produces `dist/` for the server to serve. |

First deploy:

```bash
catalyst appsail:add            # registers the service in catalyst.json
catalyst deploy appsail --name <service-name>
```

Then `catalyst deploy appsail --name <service-name>` for subsequent deploys.
Always pass `--name`; without it the CLI defaults to `AppSail` and can target
the wrong service.

### Identity on AppSail — read this before deploying

The gateway injects admin-scope `x-zc-*` headers onto **every** request,
including anonymous ones. So `catalyst.initialize(req)` always succeeds and is
useless as an auth check — `getCurrentUser()` is the real check, and it returns
`null` for an anonymous caller because the injected identity is the project
admin, not an app user.

That leaves a choice, and it is deliberately explicit rather than defaulted:

- **Catalyst authentication enabled.** Users sign in, `getCurrentUser()`
  returns them, every row is scoped per user. Nothing to configure.
- **No Catalyst authentication.** There is no user to attribute rows to, so
  every request gets a 401 until you set `CATALYST_APP_OWNER` in the AppSail
  environment. That runs the deployment as one shared owner: **everyone who can
  reach the URL shares one dataset.** It is opt-in because defaulting to it
  would silently turn a multi-user app into a public one.

### Dependencies

The Catalyst deployers run `npm install`, so `package-lock.json` is committed
even though local development uses pnpm. Keep them in step:

```bash
pnpm install && pnpm run lock:npm   # after any dependency change
pnpm run check:lockfiles            # fails if either lockfile has drifted
```

Without the npm lockfile the Slate/AppSail image (npm 10.9.2) crashes with
`Cannot read properties of null (reading 'edgesOut')` while resolving
`vitest@4`'s optional peer dependencies.
