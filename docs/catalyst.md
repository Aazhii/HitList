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
catalyst login                                              # opens a browser
catalyst init --org 60084215173 -p 69251000000061001 -ni
pnpm catalyst:setup                                         # create the tables
```

`catalyst login` is interactive and cannot be scripted. Afterwards
`pnpm catalyst:setup` picks up the grant from `~/.catalystrc`.

To run the app with gateway credentials injected, use `catalyst serve` rather
than `pnpm dev`. Its port is dynamic — do not hardcode it.

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

The Express app fits Catalyst **AppSail** (a persistent Node process), not
Functions. AppSail injects `X_ZOHO_CATALYST_LISTEN_PORT`, which the server
reads before `PORT`.

```bash
pnpm build
catalyst deploy
```
