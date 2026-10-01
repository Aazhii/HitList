# How the app is put together

```
web/        the user interface (React + Vite). Built to static files.
api/        the backend (Spring Boot, Java 25). Its jar contains the built web app, so one jar = the whole app.
desktop/    the desktop shell (Electron). Starts the jar on a free local port, shows it in a window.
functions/  the Catalyst Function "backup" (Node): stores and returns each signed-in user's backups.
client/     the download page, served by Catalyst Web Client at /app/.
docs/       these docs.
```

## What runs on a user's computer

1. The Electron shell starts `java -jar hitlist.jar` using a Java runtime bundled in the app. Nothing needs installing.
2. The jar listens on `127.0.0.1` on a random free port and keeps data in a SQLite file in the user's data folder
   (`~/Library/Application Support/HitList`, `%APPDATA%\HitList`, or `~/.config/HitList`).
3. The shell opens a window on that address. The web app inside is the same one that used to run in a browser.
4. Reminders and automation rules run inside the jar while the app is open. No server is involved.

## What touches Catalyst, and when

- **Sign-in** (optional): Catalyst's hosted login page opens in its own window; when Catalyst lands it on `/app/`, the shell
  closes it and remembers the account.
- **Backup** (only when signed in): a gzipped snapshot is sent to the `backup` Function when something changed: about every three days,
  when the person signs out, and on *Back up now*; at most three stored per person per 24 hours. **Restore** downloads the newest one and adds what is missing.
- Nothing else. Using the app costs no Catalyst requests.

## Who owns data

Each account has its own workspace on the machine, keyed by a hash of its Catalyst user id. Signed out, the app uses the
browser-style cookie workspace it always had. The first sign-in moves that workspace under the account (rows are re-owned,
never copied or deleted).

## Why three Java runtimes

Each platform bundles its own: a small custom runtime made with `jlink` on a Mac (`scripts/prepare-jre.sh`), and the official
Temurin 25 runtime for Windows (`prepare-jre-win.sh`) and Linux (`prepare-jre-linux.sh`), because `jlink` cannot make a Windows
or Linux runtime on a Mac.
