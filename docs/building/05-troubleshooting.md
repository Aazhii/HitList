# Troubleshooting

Problems we have already met, and the fix.

## Building

| Symptom | Cause and fix |
|---|---|
| Mac app: "HitList is damaged and can't be opened" | The packed app's signature did not match its contents. `desktop/scripts/afterPack.js` re-signs it ad-hoc; if you see this on a new build, check that `afterPack` is set in `electron-builder.yml`. For a user: `xattr -cr /Applications/HitList.app` |
| `catalyst serve` / Docker: nothing builds, "name resolution" errors | The VPN (FortiClient) cuts Docker off. Disconnect it, build, reconnect. Do not restart Colima |
| `catalyst serve` says the image should be amd64 | Catalyst runs amd64 images: `docker buildx build --platform linux/amd64 …`. Docker also needs `ZC_DOCKER_SOCK_PATH=$HOME/.colima/default/docker.sock` |
| AppSail container: `exec: "java": executable file not found` | Catalyst's runner drops the image's PATH. The `Dockerfile` uses the full path `/opt/java/openjdk/bin/java` |
| Windows installer: errors about Wine or executable metadata | `signAndEditExecutable: false` in `electron-builder.yml` keeps the executable edit off Wine. Building the *installer* on Linux still needs Wine (to make the uninstaller): `wine process failed ENOENT`. Build it on a Windows machine (CI does) or a Mac |
| The build changes nothing in the app | The jar is stale. Rebuild it (`02-build-on-your-computer.md` step 1) and copy to `desktop/resources/hitlist.jar` |

## Catalyst

| Symptom | Cause and fix |
|---|---|
| Browser: blank page, scripts 403 "Invalid CORS request" | The backend allowed only localhost origins. The AppSail image sets `ALLOWED_ORIGINS` to its own address |
| Sign-in works but `/whoami` says "no user in the answer" | `getCurrentUser()` returns null for app users here. Use the check in `functions/backup/index.js` `callerOf` |
| Function: "No such Table with the given name exists" | Create the `Backups` table in the console (04-catalyst.md) |
| After `catalyst deploy`, the first request still gets the old behaviour | A deploy takes a few seconds to take over; retry |
| `…/app` shows `INVALID_URL_PATTERN` | Use `…/app/` with the trailing slash |
| Sign-in: "You have not set a password for this account. Set password now." | An account with no password (added in User Management, or made through social login) gets this from Zoho's page; "Set password now" starts the email reset. The sign-in window now opens on a first screen with a clear *Set or reset my password* button. Original note: | Open the reset-password page (`SPIKE_PAGE=reset pnpm exec electron auth-spike.js` or the hosted URL) and set one |
| Signed in but backups are refused (401) | The account is not in User Management as an App User |

## The apps

| Symptom | Cause and fix |
|---|---|
| App opens empty after installing | The installed app and `pnpm start` used different data folders in the past; both now use the `HitList` folder and copy from `hitlist-desktop` once. Or use Account, Restore from backup |
| Linux `apt` prints `N: Download is performed unsandboxed as root…` | Harmless; the install worked |
| Linux AppImage mentions FUSE | `sudo apt install libfuse2` (Ubuntu 24.04: `libfuse2t64`) or run with `--appimage-extract-and-run` |
| Ubuntu 24.04: the app will not start | The system blocks Chromium's sandbox; the app detects it and starts without the sandbox in that case |
| "Back up now" says the daily limit is reached | Ten changed manual backups per rolling 24 hours per person is the cap; the server supplies a retry time. Login/logout/scheduled/update uploads are exempt and do not clear or inherit the cached manual block. Legacy cached limits remain manual-only until expiry. This needs the new `BackupReason` column, updated function and rebuilt desktop; an old function still enforces its shared cap, while old desktops omit the trigger header and count every upload as manual. |
