# HitList desktop app (macOS)

A normal, Dock-launchable macOS app built with Electron. It wraps the existing
Express server and the production Vite build — same code, same `/api/*`
routes — so nothing about the web app's behavior changes. This document
covers prerequisites, the dev workflow, building a DMG, where your data lives,
and what is (and isn't) implemented.

## How it fits together

- **One process tree, one origin.** The Electron main process spawns the
  bundled server (`electron/dist/server.cjs`) as a child process on a free
  localhost port, with `KAIZEN_STORE=sqlite` and `KAIZEN_SQLITE_PATH` pointed
  at a database file under `app.getPath('userData')`. It waits for
  `GET /api/health` to report `ok: true`, then loads a `BrowserWindow` at that
  same `http://127.0.0.1:<port>` origin — so the renderer's existing relative
  `/api/*` calls work completely unchanged from the web build, and the server
  is the one already serving the built SPA (`server/notes-server.ts`'s
  `DIST_DIR` static handler).
- **Local sessions, no login screen.** `CatalystAuthGate` now checks
  `/api/health`'s `backend` field first; for `sqlite`/`json-file` backends
  (i.e. everywhere outside real Catalyst hosting) it uses a local session
  instead of requiring the Catalyst Web SDK, which never initializes outside
  Catalyst-hosted deployment. This also fixes plain `pnpm dev` locally, not
  just the desktop app.
- **A background sweep runner for when the app is closed.** A macOS
  LaunchAgent (installed/removed from the app menu) runs
  `electron/dist/reminder-sweep.cjs` on a timer. That script opens the SQLite
  database directly, runs one delivery sweep, shows a best-effort native
  notification for anything it delivers, and exits — no HTTP server, no
  Electron, no GUI.

See `electron/main.ts` for the exact dev-vs-prod branching and security
defaults, and `electron/launchAgent.ts` / `electron/reminder-sweep.ts` for the
closed-app runner.

## Prerequisites

- macOS (Apple Silicon or Intel — `electron-builder` targets `arm64` by
  default; pass `--x64` too if you need an Intel DMG).
- Node.js ≥ 22.5 for local tooling (`pnpm install`, `pnpm build`, etc. — the
  packaged app itself bundles its own Node via Electron, see below).
- pnpm (version pinned in `package.json`).
- No Xcode/Apple Developer account required to build and run locally. Signing
  is out of scope — see [Limitations](#limitations).

Install dependencies once:

```sh
pnpm install
```

If Electron's binary wasn't fetched by `postinstall` (pnpm sometimes skips
build scripts):

```sh
node node_modules/electron/install.js
```

## Development workflow

Electron in dev mode spawns **nothing** — it points a `BrowserWindow` straight
at your existing dev stack, so you run that stack the normal way first:

```sh
pnpm dev                # vite + the notes server on :3001, as today
pnpm electron:dev        # in a second terminal: bundles main/preload, launches Electron
```

`electron:dev` builds only the thin `electron/` sources (main, preload) with
esbuild — it does **not** rebuild the frontend or spawn a server — then opens
a window at `http://localhost:9000` (Vite's dev server, already proxying
`/api` to `:3001`; see `vite.config.ts`). Auth in this mode goes through the
same local-backend bypass described above, since `pnpm dev` defaults to a
non-Catalyst backend.

Typecheck/lint the Electron sources with everything else:

```sh
pnpm exec tsc -b --noEmit   # electron/ is its own project reference (tsconfig.electron.json)
pnpm exec eslint src/
```

## Building the DMG

```sh
pnpm run dist:mac
```

This runs, in order: `pnpm build` (Vite production build to `dist/`),
`pnpm run electron:build` (esbuild bundles `electron/main.ts`,
`electron/preload.ts`, `server/notes-server.ts`, and
`electron/reminder-sweep.ts` into four self-contained `.cjs` files in
`electron/dist/`, each with all npm dependencies inlined — no `node_modules`
ships in the app at all — then copies the built `dist/` frontend directly
into `electron/dist/` so the bundled server's existing static-file resolution
finds `index.html` next to itself), then `electron-builder --mac dmg`.

Output: `release/HitList-<version>-arm64.dmg` and the unpacked
`release/mac-arm64/HitList.app`. Double-click either to install/run normally
— this is a real, Dock-launchable `.app`, not a dev-only shim.

To exercise the exact production code path without a full DMG build:

```sh
pnpm run electron:preview
```

(`KAIZEN_ELECTRON_FORCE_PROD=1` forces the prod branch even though
`app.isPackaged` is `false` when running from source.)

## Data location

The SQLite database lives under Electron's per-user app-data directory, never
inside the repo or the read-only `.app` bundle:

```
~/Library/Application Support/HitList/hitlist.sqlite
```

(plus `-wal`/`-shm` companion files while the app or the LaunchAgent has it
open). Use **HitList → Reveal Data Folder** in the app menu to open it in
Finder. This is the same `server/store/sqlite.ts` backend and schema used by
`KAIZEN_STORE=sqlite` anywhere else — there is nothing desktop-specific about
the data format, so the file is portable to another machine or back to a
server deployment.

Uninstalling: delete `HitList.app` and, if you don't want the data,
`~/Library/Application Support/HitList/`. If you enabled background
reminders, disable them first (menu item, or see below) so no LaunchAgent is
left pointing at a database that no longer exists.

## Background reminders while the app is closed

**HitList → Enable Background Reminders…** installs a
`~/Library/LaunchAgents/com.kaizen.hitlist.remindersweep.plist` LaunchAgent
(via `launchctl bootstrap`) that runs the bundled sweep script every 5 minutes
using the packaged app's own executable as a Node runtime
(`ELECTRON_RUN_AS_NODE=1`) — no dependency on a system Node install, and no
HTTP server is started for this. **Disable Background Reminders** removes it
(`launchctl bootout` + deletes the plist). Both actions use `execFile` with
argument arrays (never a shell) and XML-escape all interpolated values, so
untrusted paths can't inject into the generated plist or the `launchctl`
invocation.

Uninstalling the app without disabling this first will leave a harmless but
stale LaunchAgent (it will fail silently once `HitList.app` no longer exists
at its recorded path — nothing else on the system depends on it). Re-run
`launchctl bootout gui/$(id -u)/com.kaizen.hitlist.remindersweep` manually if
you need to remove it after the fact.

## Limitations

- **Unsigned, unnotarized build.** `electron-builder.yml` sets
  `identity: null`; there is no Apple Developer identity configured in this
  environment. Gatekeeper will warn on first launch of a DMG built this way
  outside this machine. Signing/notarization is a scoped gap, not attempted.
- **Native notifications, two tiers of coverage, not one:**
  - *Client-scheduled per-task reminders* (`src/lib/notifications.ts`) use the
    standard web `Notification` API. Chromium/Electron maps this to real
    macOS notifications automatically — no extra code needed, and it works
    fully with `contextIsolation: true` / `nodeIntegration: false`.
  - *Server-side, queue-driven reminders* (automations) only write to the
    in-app bell (`KaizenNotifications`) by design of the existing sweep. While
    the app is **open**, `electron/main.ts` polls `/api/notifications` and
    turns new entries into native banners. While the app is **closed**, only
    the LaunchAgent's `osascript`-based banner exists for whatever the sweep
    delivered — it has no click-to-open action, and there is no delivery
    receipt if the Mac was asleep/off across a reminder's fire time (the sweep
    runs on the LaunchAgent's own timer, not a wake-triggered one).
  - **Email and web-push are unavailable on the SQLite backend** —
    `server/store/sqlite.ts`'s `app.email()` / `app.pushNotification()` throw
    intentionally, matching the existing Catalyst-only implementation of
    those channels. This is a pre-existing scope boundary of the SQLite store
    used by `KAIZEN_STORE=sqlite`, not something the desktop packaging
    changes.
- **No cross-device sync.** Each installed copy has its own SQLite file. Use
  the same file (copy it under the app's `userData` path) to move data
  between machines; there is no built-in sync.
- **macOS only.** `electron-builder.yml` only configures a `mac`/`dmg` target;
  the LaunchAgent lifecycle (`electron/launchAgent.ts`) is macOS-specific by
  design (`launchctl`).
