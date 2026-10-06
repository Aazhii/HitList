# Account isolation audit, 2026-10-04

This describes the changed source, not a deployed release or a live two-account cloud verification.

## Confirmed defects

- `web/src/App.tsx` set the active storage identity to null for every account. Task caches, notes, notifications, views and other identity-scoped consumers therefore used their anonymous keys. `useAppSync` migrates cached tasks to the currently authenticated backend, allowing A's cached content to be submitted as B's data. This is an ownership-isolation defect, not evidence that every server role check is broken.
- `useNotes` automatically claimed the unlabelled legacy note cache and queued its contents for upload. There is no trustworthy account attribution on that cache.
- `GET /api/session` automatically claimed the anonymous cookie-owned database workspace. Historical cache contamination could therefore be transferred to the next account at sign-in.
- Logout raced backup against eight seconds without cancelling the losing operation. The backup uploader used the shared mutable cloud session. A delayed snapshot could outlive logout and reach upload after another account signed in.
- A logout backup could reuse an already-running, older backup instead of capturing the latest changes. Debounced note edits were not awaited before snapshot capture.
- Restore downloaded with a mutable cloud session and imported using the account current at import time, rather than the account that started the operation.
- The outgoing renderer's unload note flush could run after the shell changed account attribution. Account-scoped task caches also did not distinguish personal and shared workspaces.

## Changed ownership policy

Identity is established before mounting any content hooks. Desktop startup uses the cached desktop user ID even offline. Browser Catalyst startup uses the authenticated server user ID. An unknown browser identity fails closed instead of opening an anonymous cache.

Named accounts have separate cache keys. Personal and shared workspaces have separate task caches, migration journals and source-editor caches. Notes and databases stay personal unless explicitly shared into a canonical workspace copy with whole-workspace consent. The signed-out desktop cache uses a separate namespace from historical unlabelled caches.

Sign-in no longer automatically transfers anonymous database rows or legacy notes. Unknown-origin data is preserved, not assigned to the next person to log in. Genuine signed-out work also stays separate: automatic first-sign-in adoption is intentionally removed. A future recovery/import operation must be explicit and reviewed for ownership.

## Logout ordering

1. Disable the page's content controls and await pending task/list writes.
2. Persist and flush the latest note edits, including edits still inside the debounce interval. If task fallback was used, migrate its scoped cache to the available local backend. If local saves fail, cancel sign-out and keep the account signed in.
3. Stop account background sync and block renderer writes in the shell.
4. Wait for an existing backup, then capture a fresh outgoing-account snapshot. Every local backup request carries its starting account identity.
5. Verify the cloud session identity before sending private backup bytes. Refuse a mismatch. Wait up to eight seconds for the backup flow.
6. Cancel remaining backup work before clearing cloud cookies and the cached account. Sign-in cannot run concurrently with this transition.
7. Store the backup outcome in session storage, then reload the page. Display failure after reload. Writes stay blocked until the new renderer confirms the shell's current identity.

Cloud backup remains best-effort. Offline, expired authentication, daily limits and timeout are failures, not backup success. Successful local saving does not prove successful cloud storage. Account A's database rows and scoped caches are retained locally after logout; they are not reassigned to B.

Restore verifies cloud identity, checks that its starting account is still current, and pins the local import to that starting identity. The existing backend import is add-only, not an overwrite/repair operation.

## Verification

- Web regressions: account A/B cache separation; offline desktop identity; personal/shared task separation; unknown browser identity refusal; no automatic legacy note adoption; pending-save ordering; failed saves block sign-out; actual latest-note flushing; backup warnings survive reload.
- Desktop regressions: delayed A snapshots do not upload after a switch; cancellation prevents late work; pre-logout captures fresh content; cookie clearing follows backup settlement; outgoing renderer writes remain blocked; cloud-session mismatch prevents private uploads; late restores cannot import into B.
- API contracts: sign-in leaves anonymous rows untouched; authenticated identity is returned; account A's private task is unavailable to B; shared membership and removed-member write restrictions remain tested.
- Cloud service tests cover per-user backup isolation and workspace membership/invite/role operations.
- Full frontend and desktop/cloud suites, full Maven API tests, frontend typecheck/lint/design checks and production build were run. See the accompanying change summary for totals.

## Limits and rollout

- Integrated-browser smoke attempts timed out loading localhost; they are not successful browser validation. A real Catalyst A -> logout -> B -> logout -> A click-through was not performed. Do this in a disposable profile with dummy content and confirm downloaded snapshots belong to the expected account.
- No production data, account credentials, or cloud backups were modified. Existing mixed rows, caches and snapshots were not automatically repaired. Back up and inspect them before deleting or importing anything; unknown provenance cannot be safely inferred from the next login.
- Rebuild and release the API, frontend and desktop shell together. The updated frontend needs session identity, and the updated shell requires the renderer identity-confirmation handshake. An old installed jar or UI bundle does not contain these fixes.
- Desktop owner headers are trusted only with the per-launch secret. Hosted Catalyst identity still relies on its trusted gateway. Plain cookie development mode is browser-scoped, not account authentication.
- Keeping account copies in one SQLite file does not protect them from someone with OS-level access to that file. Shared workspaces deliberately share tasks/lists and explicitly shared source copies with all members; personal originals remain separate. Shared-workspace replication is not the same operation as personal cloud backup.

## Validation record after resume

Base commit: `2c088c590d1b4508103e5a88097d5abd527e3f85`, plus uncommitted source changes. No new commit/tag or deployment was made.

Host: macOS 26.6.2 (25G83), Darwin arm64; Node 24.19.0. Frozen-lock dependencies installed with pnpm 10.25.0; function dependencies installed with `npm ci`. The default system Java was 26, so validation explicitly selected Microsoft Java 25.0.4 through `JAVA_HOME`, `HITLIST_JAVA`, and `HITLIST_MVN` (cached Maven 3.9.12).

Commands and results:

- `node scripts/ci/validate-desktop.cjs`: PASS. Desktop 154 passed / 2 Windows/Linux-only helper tests skipped / 0 failed; backup function 56 passed; webhook 1 passed; frontend 606 passed across 84 files; API 47 passed. Whitespace, JS/shell syntax, types, design, lint, frontend build and API packaging passed. Fresh frontend was copied only into generated API output.
- Local Java/jar smoke: PASS for frontend assets, SQLite writes and synthetic account A/B partitioning. Two real scratch replicas using real cloud service logic over an in-memory transport: 16 assertions PASS. Both scratch JVMs exited and their storage was removed. This is not live Catalyst/Ably evidence.
- `sh scripts/ci/compute-version.test.sh`: 16 cases PASS, both inside the validator and as the separately requested command.
- Native-host lifecycle command plus `test.installer.js`: 80 passed / 2 Windows/Linux-only helper tests skipped / 0 failed. Simulated platform branches are not native Windows/Linux passes.
- Native macOS packaging: `node node_modules/electron-builder/cli.js --mac --arm64 --publish never -c.directories.output=dist-account-isolation-validation`, run from `desktop`: PASS for DMG and ZIP. The first build used an existing Java 26 runtime; it was replaced using `prepare-jre.sh` with Java 25 and packaging was rerun successfully. The final copied Java 25/jar afterPack smoke and ad-hoc signature verification passed.
- Package contents: Electron-dependent main/auth/preload files present and syntax checked; pure backup/restore/workspace modules and packaged Ably loaded with the packaged Electron Node runtime. A first attempt to load auth in `ELECTRON_RUN_AS_NODE` failed because that mode disables Electron's built-in module; the corrected probe does not claim GUI runtime verification.
- Final artifact checksums are in the ignored build output `desktop/dist-account-isolation-validation/SHA256SUMS-mac.txt`; checksum verification passed. Artifacts are local version 1.1.0 test builds, not release identity or authorization to publish.

Artifact identity:

```text
DMG SHA256: c3d04f412f68a6e4a3244c31e50d011c19d3b828f2913efd4a7500e65d64ebd7
ZIP SHA256: c686d2cd64cae42af527755f464f91e5eb05cb5e752087302da7e07d5015ce59
Bundled jar SHA256: 743b51ee209676b0bcdc64a8d3a06ce7d1e31c9ea0a716c9185143b0ca68bc4b
```

Native macOS BUILD: PASS. Native Windows/Linux BUILD: NOT RUN, no matching runners available. Manual installed clean launch/reopen/quit, real online/offline/expired/cancelled login, immediate edit/logout/A-B-A switch, installed restore, old-to-new update, permission/translocation/security-software and path edge cases: NOT RUN on all platforms. Integrated-browser smoke attempts timed out and are not passes. No installed user profile was opened for tests. Local ignored artifacts are retained for owner review.

On 2026-10-05 the owner explicitly approved a provisional local commit of the account-isolation and source-sharing changes after
the missing native/manual and live-cloud checks were disclosed ("yes u can commit"). This is commit approval only, not release,
push or deployment authorization. The latest source-sharing validation is recorded in the workspace guide; the macOS artifacts
above predate source sharing and do not validate the combined changes. Native/manual validation and live two-account cloud testing
remain outstanding; release remains blocked. Local passing checks do not guarantee future builds or account flows are failure-free.