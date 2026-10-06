# Catalyst: sign-in, backup and the download page

Project: **HitList**, project id `75733000000013053`, org `60090109165`, Development environment. The local link is in
`.catalystrc`; `catalyst.json` lists what is deployed. The CLI is logged in as the owner; deploying needs that login.

## Pieces

| Piece | Where | Deploy |
|---|---|---|
| Backup service (Function `backup`) | `functions/backup/` | `catalyst deploy --only functions` |
| Download page (Web Client) at `/app/` | `client/` | `catalyst deploy --only client` |
| The old web app (AppSail `hitlist`) | `Dockerfile`, `Dockerfile.catalyst-local` | `catalyst deploy --only appsail`; to be stopped (see desktop-first D5) |

Addresses are in `desktop/catalyst-config.js`. The backup service is at
`https://hitlist-60090109165.development.catalystserverless.in/server/backup/`. The download page is at `…/app/` (the trailing
slash matters; without it Catalyst answers 404).

## Sign-in

Authentication is **Hosted**, with Zoho and Google social login and public sign-up on. Hosted pages: `/__catalyst/auth/login`,
`/signup`, `/reset-password`. Only people in **Authentication, User Management** with role *App User* count as users; the project
owner's own login is not one until it appears there. After a sign-in Catalyst lands on `/app/`, which the desktop shell watches for.
Google sign-in needs the redirect URIs from the Catalyst Google popup added in Google Cloud (ZAID `50046452030` for Development).

## The backup service

Routes (all need a signed-in app user): `PUT /backup` (gzip body + `x-content-hash` + `x-backup-reason`), `GET /backup/list`, `GET /backup/latest`,
`GET /whoami`, and an open `GET /health`. The caller is decided only by the Catalyst SDK (user scope) plus an admin lookup that the
gateway's id is an App User. Rules: gzip only, at most 25 MB, at most **10 stored manual backups per person per rolling 24 hours**
(`MAX_PER_DAY` in `backupService.js`). Reasons `signed-in`, `sign-out`, `scheduled` and `update` are exempt and consume no
manual slots; missing reasons default to `manual`, unknown reasons return 400. Labels are client-reported, not proof of
login/logout. Identical content is not stored twice. Old backups are removed in batches once a person has 14, keeping the
newest 7 plus manual entries from the last 24 hours for allowance accounting. Quota checking and insertion are not atomic
across concurrent requests; the desktop serializes its own operations, not requests from other devices.

Storage: files in File Store folder `backups` (created by the Function); an index in the Data Store table **`Backups`**, which
you create once in the console (tables cannot be made from the CLI): `UserId` text, `BackedUpAt` bigint, `Hash` text,
`SizeBytes` bigint, `FileId` text; all mandatory, PII flagged, unique and search index off. Ids are 17 digits, past JavaScript's
exact numbers, so they are text.

Before deploying the manual-only policy, add **`BackupReason` Text**, optional, with unique/search index off. Existing rows
without that field are conservatively counted as manual; new rows persist their trigger. This additive schema change has not
been performed. Deploy only with authorization, then rebuild/distribute the desktop that sends the reason header. Older
desktops omit it and count every upload as manual; an older function can still reject automatic backups under its shared cap.

SDK note: use `@zcatalyst/auth` only to identify the caller and `zcatalyst-sdk-node` for Data Store and File Store. Mixing the
newer split `@zcatalyst/*` packages fails with "Unable to get the app credentials".

## Free tier

See [../desktop-first/01-BUDGET.md](../desktop-first/01-BUDGET.md). In short: File Store uploads (2,000 per 30 days) are the first limit,
about 33 active people at two backups a day. Ten manual uploads per rolling day can exceed the free tier; automatic uploads
are additional and uncapped by this rule, so the manual allowance does not bound total usage.
