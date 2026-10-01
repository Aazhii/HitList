# Putting the builds in WorkDrive automatically

After the three apps build, the workflow can copy every file into your WorkDrive download folder, so you never download and
re-upload by hand. It is **off** until you finish the setup below, and a failed upload never blocks the build itself.

It uses WorkDrive's REST API with a long-lived "refresh token", so nobody has to sign in. (The MCP address and the external share
links are for people and AI assistants; neither can be used by a build server. Treat the long key in an MCP address like a
password: never put it in the repository.)

## One-time setup (about 10 minutes)

1. **Create an API client.** Open https://api-console.zoho.in, choose **Add Client**, then **Self Client**. Note the
   **Client ID** and **Client Secret**.
2. **Make a code.** In the client's **Generate Code** tab enter the scope `WorkDrive.files.CREATE,WorkDrive.files.READ`, set the
   time to 10 minutes, a description such as "HitList builds", and click **Create**. Copy the code (it works once, for 10 minutes).
3. **Turn the code into a refresh token.** In a terminal (use your own values):

   ```
   curl -s -X POST "https://accounts.zoho.in/oauth/v2/token" \
     -d grant_type=authorization_code -d client_id=YOUR_CLIENT_ID -d client_secret=YOUR_CLIENT_SECRET -d code=YOUR_CODE
   ```

   The answer contains `"refresh_token"`. Copy it. (If you are not on the India data centre, use `accounts.zoho.com`,
   `.eu`, `.com.au` or `.jp` instead, and set `WORKDRIVE_DC` below.)
4. **Find the folder id.** Open the **parent** WorkDrive folder (the HitList folder that contains the `mac`, `linux` and `windows`
   folders) in your browser. The address looks like `https://workdrive.zoho.in/folder/abc123…`; the part after `/folder/` is the id.
   That one id is all that is needed: the job finds the three subfolders itself, by name (case and a number in front do not matter,
   so `1. Mac`, `Linux`, `windows` all work).
5. **Give GitHub the settings.** Repository, **Settings, Secrets and variables, Actions**:
   - Secrets (**New repository secret**): `WORKDRIVE_CLIENT_ID`, `WORKDRIVE_CLIENT_SECRET`, `WORKDRIVE_REFRESH_TOKEN`, `WORKDRIVE_FOLDER_ID`.
   - Variables: `WORKDRIVE_UPLOAD` = `true` (this switches the job on), and `WORKDRIVE_DC` only if you are not on `in`.

## What it does

When the Mac, Windows and Linux jobs all succeed, the `workdrive` job uploads each platform's files into **that platform's own
subfolder**: the `.dmg` and its checksum into `mac`, the `.exe` into `windows`, the `.AppImage` and `.deb` into `linux`. Each
platform also gets `SHA256SUMS-<version>-<platform>.txt`. File names carry the version (`HitList-1.1.57-arm64.dmg`), so each
run adds new files; the newest has the highest version and the latest "modified" time. If a subfolder is not found by name the job stops and says so; you can also give its id directly with `WORKDRIVE_FOLDER_ID_MAC`,
`WORKDRIVE_FOLDER_ID_LINUX` or `WORKDRIVE_FOLDER_ID_WINDOWS`. It **never deletes** anything: older versions pile up, so remove old ones from WorkDrive now and then
(each run adds about 800 MB).

## Trying it without uploading

```
node scripts/ci/upload-workdrive.mjs some-folder --dry-run
```

lists what would be uploaded, and to which platform folder, and needs no settings. (`some-folder` holds one directory per platform,
named `…-mac`, `…-windows`, `…-linux`, as the workflow's artifacts are.) A real run with settings missing stops and names what to add.

## Keep in mind

- The refresh token acts as you on WorkDrive for the scopes above. Keep it only in GitHub secrets; if it leaks, remove the
  client in the API console.
- This has not been run against your WorkDrive yet (it needs your credentials). The first real run may need small fixes; the
  job's log shows the file being uploaded and any answer WorkDrive gives.
- - The two share links you have are different things. The **view-and-download** link is what the download page gives users, and the
  **upload-and-view** link is for people in a browser; the automatic upload uses neither and writes through the API into the folder
  by id. The download page links to a WorkDrive folder; if the builds go to a different folder than the one it links to, change
  the link in `client/index.html` and redeploy the page (`catalyst deploy --only client`).
