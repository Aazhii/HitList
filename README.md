# HitList — Kaizen Todo

A task manager built around the **Eisenhower Matrix**, with a block-based notes
editor and rule-driven reminders. React 19 + Vite on the front, Express on the
back. The same Express image uses **PostgreSQL 9.5-compatible storage locally**
and **Zoho Catalyst Data Store** in Catalyst/AppSail.

## Features

- **Tasks** — four-quadrant Eisenhower matrix (Do First / Schedule / Delegate /
  Eliminate), multiple colour-coded lists, a three-state status cycle, due dates
  and times, categories, and per-task notes.
- **Momentum** — completion streak, today's wins, and an all-time counter.
- **Notes** — a block editor with headings, lists, todos, quotes, code, dividers
  and tables, driven by a `/` command menu.
- **Automations** — reminder rules (due-date offset, overdue, recurring,
  status-change, daily digest) with a run history.
- **Reminders** — browser notifications plus an in-app notification centre.

## Requirements

- Node.js 20+ (developed on 24)
- pnpm 10 (`corepack enable pnpm`)
- A PostgreSQL 9.5 service for local persistence

## Getting started

```bash
cp .env.example .env.local
# set DATABASE_URL in .env.local
pnpm install
pnpm dev
```

`pnpm dev` runs two processes concurrently:

| Process | Port | What |
|---------|------|------|
| `vite`  | 9000 | the React app |
| `tsx server/notes-server.ts` | 3001 | the API |

Vite proxies `/api/*` to port 3001, so the frontend always uses relative URLs
and needs no configuration for local development.

## Scripts

| Script | Purpose |
|--------|---------|
| `pnpm dev` | Vite + API server together |
| `pnpm dev:ui` | Vite alone |
| `pnpm server` | API server alone |
| `pnpm build` | typecheck and build the frontend to `dist/` |
| `pnpm start` | build, then serve the API and `dist/` from one origin |
| `pnpm typecheck` | `tsc -b --noEmit` |
| `pnpm lint` | ESLint over `src/` |
| `pnpm test` | Vitest (jsdom) |

## Storage

The server persists through one of two backends, chosen at startup:

| Backend | When | Notes |
|---------|------|-------|
| PostgreSQL | outside Catalyst with `DATABASE_URL` | local-only; schema initializes idempotently |
| Catalyst Data Store | Catalyst/AppSail runtime signal | production Catalyst backend |

The server fails clearly at startup when neither configuration is available.
Local rows use `LOCAL_DEV_OWNER` (default `local-dev-user`); Catalyst keeps
request-scoped Catalyst owner isolation. JSON-file persistence is not supported.

## Docker and Catalyst AppSail

`Dockerfile` builds the production Express server and frontend in one image.
Compose deliberately starts **only HitList**; point `DATABASE_URL` at the
pre-existing PostgreSQL 9.5 service. On Docker Desktop use
`host.docker.internal` (for example,
`postgres://user:password@host.docker.internal:5432/hitlist`):

```bash
DATABASE_URL='postgres://user:password@host.docker.internal:5432/hitlist' docker compose up --build
```

Do not set `DATABASE_URL` in AppSail. Build and push an OCI Linux/amd64 image,
then deploy it as Docker AppSail:

```bash
docker buildx build --platform linux/amd64 -t registry.example/hitlist:tag --push .
catalyst deploy appsail --name hitlist-api --source docker://registry.example/hitlist:tag --port 9000
```

Catalyst injects `X_ZOHO_CATALYST_LISTEN_PORT`; the image exposes `/health` for
the AppSail health check and uses Catalyst Data Store rather than external
PostgreSQL.

## Layout

```
src/
  App.tsx            task UI and the top-level view switcher
  components/        matrix, task cards, panels, notes editor, automations
  hooks/             sync, notes, automations, notifications
  lib/               api client, storage, auth, notifications
  types/             Todo, Note and AutomationRule shapes
server/
  notes-server.ts    Express API
```
