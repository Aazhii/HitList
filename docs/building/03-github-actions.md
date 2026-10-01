# Building all the apps with GitHub Actions

The workflow `.github/workflows/build-desktop.yml` ("Build desktop apps") builds every desktop app from one click.

## What you get

| Platform | Built on | Files |
|---|---|---|
| Mac (Apple silicon) | a macOS runner | `HitList-<version>-arm64.dmg` |
| Windows (64-bit) | a Windows runner (on Linux the installer tool needs Wine) | `HitList-Setup-<version>-x64.exe` |
| Linux (64-bit) | an Ubuntu runner | `HitList-<version>-x64.AppImage`, `HitList_<version>_amd64.deb` |

Each platform job also adds a `SHA256SUMS-<platform>.txt` so a download can be checked.

## How to run it

1. Push the project to GitHub (the repository is `Aazhii/HitList`).
2. Open the **Actions** tab, choose **Build desktop apps**, click **Run workflow**.
3. Wait (about 10–20 minutes). Each platform's files appear on the run page under **Artifacts**:
   `HitList-<version>-<commit>-mac`, `…-windows`, `…-linux`. Download them from there (they are kept for 3 days).

Tick **publish** when running (or push a tag like `v1.2.0`) to also create a **GitHub Release** with all the files and one
`SHA256SUMS.txt`. Release files do not expire.

## What happens, in order

1. **version**: works out this run's version.
2. **verify**: runs every test (web design rules, types, lint and tests; the Java tests; the desktop tests; the backup
   function tests). If any fails, nothing is built.
3. **backend**: builds the web app, puts it inside the jar, and builds the jar once.
4. **mac / windows / linux** (in parallel): each downloads that same jar, adds its own Java runtime, and packs the app.
5. **release** (optional): gathers everything and publishes it.

## The form you fill in

When you click **Run workflow** you get these fields:

| Field | Meaning | Default |
|---|---|---|
| Release name | The title of the GitHub Release (it does not rename the app itself) | `HitList` |
| Main version | The 1 in `1.2.5` | `1` |
| Second number | The 2 in `1.2.5` | `1` |
| Third number | The 5 in `1.2.5`. **Leave empty** and it becomes the run number | empty |
| Pre-release stage | `none` (a normal release), `alpha` or `beta` | `none` |
| Stage number | The 2 in `beta2`; only used with alpha or beta; empty means 1 | empty |
| Also publish a GitHub Release | Creates a Release with every file | off |

The result follows the pattern `<name>_<main>.<second>.<third>-<stage><number>`: for example name `HitList`, `1`, `2`, `5`, `beta`, `2`
gives version `1.2.5-beta2` and the release tag `HitList_1.2.5-beta2`. A build with alpha or beta is marked as a **pre-release** on the
GitHub Releases page. With stage `none` the version is just `1.2.5` and the tag `HitList_1.2.5`.

Numbers (including the stage number) must be whole numbers, and the name may use only letters, numbers, spaces, dots, dashes and underscores. A bad value
stops the run at once with a message. Publishing a version whose tag already has a Release also stops with a message; choose another
version or leave the third field empty. The logic is `scripts/ci/compute-version.sh`, tested by
`sh scripts/ci/compute-version.test.sh`.

## Why every build is unique

- With the third field empty, the version is `<main>.<second>.<run number>`, for example `1.1.57`, then `1.1.58`. GitHub's run
  number only ever goes up, so no two builds share a version, and the version is in every file name and inside the app.
  If you type a third number yourself, you are choosing it, and you must not reuse one.
- The commit id is in the artifact names and the release notes, and `SHA256SUMS.txt` fingerprints each file.
- A pushed tag such as `v1.2.0`, `v1.2.0-beta3` or `HitList_1.2.0` uses its own number and publishes a Release by itself.
- All three apps in one run contain the identical backend, because the jar is built once.

## Things to know

- **Cost.** Public repositories get free runs. On a private repository the free plan includes 2,000 minutes a month; macOS minutes
  count ten times and Windows minutes twice, so one run (about 10–15 macOS minutes) uses roughly 150–200 of them. About ten runs
  a month fits.
- **Storage.** One run produces about 800 MB of files. Private repositories on the free plan keep only 500 MB of artifacts, so
  prefer **publish** (a Release) over relying on artifacts, or make the repository public.
- **Not signed.** No certificates, so users see a first-open warning on every platform (see [../INSTALL.md](../INSTALL.md)).
- **Not tested on real machines by CI.** CI proves the apps build and the tests pass. It does not start the Windows or Linux
  app. Have one person try each new platform build.
- **The download page.** CI does not upload to WorkDrive. Download the files (from the run's Artifacts or a Release) and put them in the
  WorkDrive folder the download page links to by hand.

## If a run fails

Open the failed job and read the first red step. Common ones are in [05-troubleshooting.md](05-troubleshooting.md).
