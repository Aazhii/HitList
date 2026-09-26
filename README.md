# HitList — Kaizen Todo

React 19 + Vite powers the frontend. The supported backend is a **Java 25
Spring Boot service** that serves the built SPA and `/api` from the same origin
and uses **PostgreSQL only** for persistence.

## Requirements

- Node.js 20+ (developed on 24)
- pnpm 10 (`corepack enable pnpm`)
- Java 25 + Maven 3.9+, or Docker
- PostgreSQL 9.5-compatible `DATABASE_URL`

## Getting started

```bash
cp .env.example .env.local
pnpm install
```

### Frontend against the Java backend

Run Spring Boot on `:8080`, then start Vite:

```bash
pnpm server
pnpm dev:ui
```

Vite proxies `/api/*` to `http://localhost:8080` by default.

## Docker

The production image is a standard multi-stage container: Vite builds `dist/`,
Maven packages the Spring Boot jar, and the Java runtime serves everything on
port `8080`.

```bash
DATABASE_URL='postgres://user:password@host.docker.internal:5432/hitlist' \
OWNER_COOKIE_SECRET='replace-with-a-random-32-byte-or-longer-secret' \
docker compose up --build
```

## Scripts

| Script | Purpose |
|--------|---------|
| `pnpm dev` | Vite UI dev server |
| `pnpm dev:ui` | Vite only |
| `pnpm server` | Spring Boot API + static asset server |
| `pnpm start` | Spring Boot API + static asset server |
| `pnpm build` | Typecheck and build the frontend |
| `pnpm lint` | ESLint over `src/` |
| `pnpm test` | Vitest |
| `pnpm typecheck` | `tsc -b --noEmit` |

## Backend behavior

- `DATABASE_URL` is required for the PostgreSQL runtime.
- `SERVER_PORT` controls `server.port`; default is `8080`.
- `/health` and `/api/health` remain available for health checks.
- Tasks, lists, notes, views, fields, databases, and the unified task/database
  calendar stay supported on `/api`.
- Reminders, automations, and Zoho Calendar import remain unavailable in the
  PostgreSQL-only migration; the frontend now hides those workflows instead of
  offering nonfunctional actions.
- Every browser receives a cryptographically random, signed `HttpOnly`,
  `SameSite=Lax` owner cookie. The server never accepts an owner identity header.
  Set an at-least-32-byte high-entropy `OWNER_COOKIE_SECRET` in deployments so browser workspaces
  survive restarts. Local development intentionally generates an ephemeral secret
  when this variable is omitted.
- Same-origin static SPA serving remains enabled through Spring Boot.

## One-time remote export import

`POST /api/migrations/remote-export` imports a **single neutral JSON export**
into the **current session-resolved owner only**. The request body must be:

```json
{
  "schema": "hitlist.remote-export.v1",
  "exportedAt": "2026-09-25T18:00:00Z",
  "collections": {
    "lists": [{ "id": "list-1", "name": "Inbox", "color": "emerald", "listOrder": 0, "createdAt": "2026-09-25T17:55:00Z", "updatedAt": "2026-09-25T17:55:00Z" }],
    "tasks": [{ "id": "task-1", "title": "Ship import", "status": "DONE", "quadrant": "DO", "taskOrder": 0, "reminderEnabled": false, "reminderMinutesBefore": null, "completedAt": "2026-09-25T17:56:00Z", "createdAt": "2026-09-25T17:55:00Z", "updatedAt": "2026-09-25T17:56:00Z", "listId": "list-1" }],
    "notes": [{ "id": "note-1", "title": "Plan", "blocksJson": "[]", "emoji": "📝", "pinned": false, "createdAt": 1727286900000, "updatedAt": 1727286900000 }],
    "views": [{ "id": "view-1", "name": "All", "layout": "list", "scopeListId": null, "filters": {}, "showDone": true, "display": { "hidden": [], "order": [], "widths": {} }, "viewOrder": 0, "createdAt": 1727286900000, "updatedAt": 1727286900000 }],
    "fields": [{ "id": "field-1", "databaseId": "", "name": "Estimate", "kind": "number", "options": [], "showOnCard": true, "fieldOrder": 0, "createdAt": 1727286900000, "updatedAt": 1727286900000 }],
    "taskFieldValues": [{ "taskId": "task-1", "fieldId": "field-1", "value": 3 }],
    "databases": [{ "id": "db-1", "name": "Books", "icon": "📚", "dateFieldId": "", "dbOrder": 0, "createdAt": 1727286900000, "updatedAt": 1727286900000 }],
    "databaseRows": [{ "id": "row-1", "databaseId": "db-1", "title": "Dune", "rowOrder": 0, "createdAt": 1727286900000, "updatedAt": 1727286900000 }],
    "recordFieldValues": []
  }
}
```

Rules:

- `schema` must be exactly `hitlist.remote-export.v1`.
- Only the collections above are accepted.
- `*At` timestamps may be ISO-8601 instants or epoch milliseconds.
- `OwnerId`, `ROWID`, `ownerId`, `rowId`, and source-owner metadata are rejected.
- Task reminders must be disabled (`reminderEnabled: false`, `reminderMinutesBefore: 0/null`).
- DONE tasks must carry `completedAt`, and that timestamp is preserved.
- Automations, reminder queues, notifications, and calendar credentials are **not**
  imported. Put them in neither `collections` nor non-empty `unsupported` sections.
- The importer writes a one-time owner-scoped marker. A second call for the same
  owner returns `409 Conflict` instead of duplicating data.

Safe procedure:

1. Set an at-least-32-byte high-entropy `OWNER_COOKIE_SECRET` in the target deployment.
2. Obtain a browser/session cookie for the **target owner**:

   ```bash
   curl -c hitlist-cookie.txt https://your-host/api/setup
   ```
3. Export the supported collections from the legacy deployment, assemble the
   envelope above, and remove any unsupported reminder/automation/calendar data.
4. Import once with that same browser/session cookie:

```bash
curl -X POST https://your-host/api/migrations/remote-export \
  -H 'Content-Type: application/json' \
  -b hitlist-cookie.txt \
  --data @remote-export.json
```

5. Keep the JSON export until you verify tasks, lists, notes, views, fields,
   databases, rows, and field values in the new deployment.

## Layout

```text
src/                 React app
src/main/java/       Spring Boot API
src/main/resources/  Spring configuration + static assets
```
