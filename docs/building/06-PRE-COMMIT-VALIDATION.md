# Mandatory Validation Before Commit and Release

Applies to all contributors and agents through the root `AGENTS.md`. The product
is Electron + a bundled Java 25 backend + SQLite + the frontend embedded in the
jar. A working development browser or system Java does not prove a desktop
package works. Do not change a working platform based only on another platform's
result. These gates reduce risk, not guarantee zero failures.

## 1. Before Editing

Record the reported error, OS/version/architecture, build tag/commit and install
location. Reproduce with a scratch profile and choose a focused failing check.
Read the owning implementation and neighboring tests; keep the fix scoped.
Preserve unrelated work and account-isolation changes. If the reported Windows
error is unavailable, distinguish confirmed defects from suspected causes.

## 2. Local Pre-Commit Gate

Prerequisites: Node 24, Java 25, Maven, and dependencies installed from committed
locks. Use pnpm 10.25.0 (declared in the web package), not an arbitrary global
pnpm. Install with `pnpm --dir web install --frozen-lockfile` and
`pnpm --dir desktop install --frozen-lockfile`; use `npm ci` in each changed
function directory. Do not regenerate locks just to bypass a local tool mismatch.

From the repository root on macOS/Linux:

```sh
node scripts/ci/validate-desktop.cjs
sh scripts/ci/compute-version.test.sh
```

For Maven not on PATH, set `HITLIST_MVN` to its absolute executable path.
The validator checks unstaged/staged whitespace, JS/shell syntax, all desktop
tests, backup and Cliq webhook function tests, frontend types/design/lint/tests/build,
API tests, fresh frontend copied into generated API output, API packaging,
local Java/jar smoke, two-replica workspace E2E and version tests. It stops on
failure. It never writes generated assets into source. The local smoke uses
Java selected by `HITLIST_JAVA`, `JAVA_HOME` or PATH, so it does not substitute
for the separate bundled-JRE gate in native packaging.
`--check` is syntax/whitespace only, NOT approval to commit.

The full validator currently requires a POSIX host. On Windows run the same
Node/frontend checks individually, `mvn -B -f api/pom.xml test`, and the native
lifecycle command below; obtain the complete gate from a POSIX runner. The
Mac helper tests require `/bin/sh` and must not be reported as Windows tests.
For changes to the Cliq webhook also run `npm test` in `functions/cliq-webhook`.

| Change Surface | Required Focused Evidence In Addition To The Local Gate |
|---|---|
| Tasks/lists/workspace sync | API contract + workspaceSync/workspacePush tests + real two-replica E2E; live two-account push if cloud behavior changed |
| Notes/storage/UI | Relevant Vitest tests, types/design/lint; pending save/logout and account switch checks |
| Auth/logout/backup/restore | Desktop auth/backup/restore/main tests + UI identity/logout tests; delayed A response must never modify B |
| Shell/startup/data paths | Main/dataDir/buildSmoke tests; native package smoke on all three runners; cold/reopen/quit checks |
| Installer/updater | Installer/updater/nativeInstaller tests; old-to-new update on every supported artifact, failure/cancel checks |
| Build scripts/JRE/dependencies/lockfiles | Fresh embedded frontend jar, all native packages, bundled-runtime smoke, version tests and checksum verification |
| Cloud functions/config | Relevant function tests, compatibility with deployed response formats; deploy only with authorization |
| Documentation-only | Validate links/commands and `git diff --check`; explain why executable gates are unaffected |

Never commit with failing required checks. If unavailable native/manual checks
block a requested commit, list them and ask for owner approval for a provisional
commit. Such approval is not a release validation pass.

## 3. Native Build Gate

Supported targets: macOS arm64 DMG + update ZIP, Windows x64 NSIS EXE,
Linux x64 AppImage + DEB. Intel Mac and Windows ARM are not implied supported.
Build on the matching OS; cross-compilation is not native lifecycle evidence.
Follow [02-build-on-your-computer.md](02-build-on-your-computer.md).

The desktop workflow runs portable lifecycle tests on all three native runners:

```sh
cd desktop
node --test test.main.js test.updater.js test.auth.js test.backup.js test.restore.js test.nativeInstaller.js test.buildSmoke.js
```

`test.main.js` additionally simulates platform branches; that is not OS-native
process validation. `test.nativeInstaller.js` executes Windows CMD/Linux helper
scripts only on their matching OS. Fake scripts test helper behavior, not NSIS,
SmartScreen, FUSE or actual GUI rendering. Mac helper execution is covered by
`test.installer.js`; run it on macOS when changing the installer.

Every electron-builder package invokes the afterPack smoke against the copied
`resources/jre/bin/java[.exe]` and `resources/hitlist.jar`. It checks JVM launch,
health, embedded frontend HTML/JS assets, SQLite writes and synthetic A/B owner
partition isolation in disposable storage, then stops the JVM and removes it.
Missing resources/startup/asset/account-isolation failure blocks packaging.
It does NOT test Catalyst login, renderer rendering, installed executable,
JVM restart persistence or in-app update.

For a prepared package you can run the same check directly:

```sh
node desktop/scripts/smoke-backend.js <absolute-bundled-java> <absolute-bundled-jar>
```

Build the frontend fresh before jar packaging; an existing target jar is not
evidence for current source. Verify that packaged shell modules and runtime
dependencies (including Ably) resolve, frontend renders without a blank screen,
and no system Java is required. Verify all expected artifact extensions exist,
commit/version match and checksums pass (`shasum -a 256 -c SHA256SUMS-mac.txt`
on macOS; `sha256sum -c SHA256SUMS-*.txt` on matching Linux/Windows Bash runners).
No arbitrary file-size threshold substitutes for checking contents.

Workflow runs are tag/manual-triggered, not a gate on every normal commit.
Run a nonpublishing native workflow for lifecycle/build changes before release.
Agents must not trigger a push/tag/publishing run without authorization.

## 4. Manual Lifecycle Gate

Use disposable OS users/profiles or VMs. Record counts and a verified backup
before update/restore. Never use the installed user's live data for experiments.

Common to every target:

- Clean install with no external Java; cold launch shows the frontend and health.
- Close/reopen, repeated activate/second launch: one sidecar, one writable DB;
  quit removes the sidecar and restarting retains data and account identity.
- Online login, cached/offline startup, expired/rejected login, cancelled login;
  errors remain actionable, no blank window or infinite spinner.
- Edit task and note, immediately logout, then login as B: no A data/cache/token
  leakage; pending writes/backup complete or fail explicitly. Return to A and
  verify data retained. Exercise delayed requests, double-click login/logout,
  network loss, restoration during a switch and renderer readiness.
- Restore/account import/export preserves intended owner; no destructive retry.
- Shared workspace: two accounts/devices, create/update/delete; initial failed
  subscription, broken channel, reconnect, membership change, restart and
  manual sync recover without logout. No healthy idle polling regression.
- Update installed version N to N+1, then quit/reopen twice: data/notes/settings
  and sign-in survive, reported version changes, old runtime is stopped.
- Bad checksum, truncated/cancelled download, installer failure, insufficient
  disk space, locked/read-only target: useful error/fallback, existing app/data
  remain usable. No success claim merely because a helper was spawned.

### Windows 10/11 x64

Standard-user per-user NSIS install, default and custom directories. Test spaces,
`!`, `%`, `&` and non-ASCII user/install paths, no Java on PATH. `/D=` must preserve
the existing destination rather than install another copy. Verify shortcuts,
SmartScreen/Defender handling, file-in-use behavior, silent update failure,
relaunch, and Java child cleanup. The generated helper preserves `!` by disabling
delayed expansion during path use and escapes batch-sensitive paths; only real
Windows execution can establish that the installer receives the correct path.

### macOS arm64

DMG first install + ZIP in-app update; writable Applications and standard-user
app whose parent directory is not writable; mount/translocation restrictions,
ad-hoc signature verification, spaces/non-ASCII paths and permission-denied
`.app.old` cleanup. Inaccessible optional leftovers must never block startup or
delete the current app. Verify both whole-bundle and contents replacement paths.

### Linux x64

Ubuntu 22.04/24.04 AppImage and DEB. Executable bit, FUSE availability/extraction,
AppArmor sandbox policy and read-only install location. AppImage environment
must not leak the old mount into relaunch. DEB updates are package-manager/manual,
not AppImage replacement. Validate the sandbox fallback only on restricted hosts.

## 5. Evidence and Commit Review

Attach this record to the change summary or PR:

```text
Commit / build tag / SHA256:
OS version / architecture / install path:
Changed surfaces and required gates:
Commands and passed/failed/skipped counts:
Native macOS / Windows / Linux: PASS | FAIL | NOT RUN
Manual install / update / login / logout / account switch: result each
Unresolved risks and owner approval for any provisional commit:
Scratch processes stopped and test data removed:
```

Inspect `git diff --cached` for only intended changes; exclude credentials,
session data, databases/backups, generated frontend/static files and accidental
lockfile changes. Do not hide failures or weaken a checker. A package passing
CI is not automatically approved for publication without manual release evidence.

## Audit Findings

Confirmed fixes: optional macOS cleanup no longer aborts startup; Windows helper
path expansion/custom-directory preservation corrected; packaged startup rejects
a missing bundled Java and handles spawn errors; packaging now runs the bundled
backend smoke. Added native lifecycle/helper gates and a reusable local command.
Remaining evidence: actual Windows/Linux native builds and real installed
old-to-new updates, GUI/auth flows, security software behavior and the user's
specific Windows failure. Source-based checks on macOS cannot close those items.

### Observed Evidence For This Change

macOS arm64 host (Darwin 25.6.0), Node 24.19.0, Java 25:

- Full local validator: PASS; desktop 154 passed, 2 Windows/Linux native helper
  tests skipped; backup 56 passed; Cliq webhook 1 passed; frontend 606 passed;
  API 47 passed; types/design/lint/JS and shell syntax/whitespace passed.
- Fresh frontend build + embedded jar + local Java smoke: PASS.
- Workspace two-replica E2E: 16 assertions PASS; scratch JVMs stopped and storage
  removed. Cloud uses the real service logic with an in-memory fake transport,
  not live Catalyst/Ably.
- Version script: 16 cases PASS.
- Actual electron-builder macOS arm64 unpacked-package (`--dir --publish never`):
  PASS; copied bundled JRE/jar smoke and ad-hoc codesign/verify passed; temporary
  package removed. Run electron-builder from `desktop`, since the relative hook
  path resolves against the working directory, even with `--projectDir`.
- DMG/ZIP artifact build and installed GUI/auth/update flows: NOT RUN.
- Windows/Linux native package and helper execution: NOT RUN on this host;
  newly wired CI gates must pass on their native runners before release.

This evidence was captured before committing the audit change, not as a
published release certification. No push, deployment or release publication
was performed.