# HitList — Kaizen Todo

A task manager built around the **Eisenhower Matrix**, with a block-based notes
editor and rule-driven reminders. React 19 + Vite on the front, Express on the
back, persisting to **Zoho Catalyst Data Store**.

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

## Getting started

```bash
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
| Catalyst Data Store | Catalyst credentials present | the real backend |
| JSON files | no credentials | `server/*-db.json`; local development only, gitignored |

See `docs/catalyst.md` for the Catalyst project setup, table schema and
deployment. Copy `.env.example` to `.env.local` and fill it in.

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
