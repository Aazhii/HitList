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
4. **Find the folder id.** Open the target folder in WorkDrive in your browser. The address looks like
   `https://workdrive.zoho.in/folder/abc123…`; the part after `/folder/` is the id.
5. **Give GitHub the settings.** Repository, **Settings, Secrets and variables, Actions**:
   - Secrets (**New repository secret**): `WORKDRIVE_CLIENT_ID`, `WORKDRIVE_CLIENT_SECRET`, `WORKDRIVE_REFRESH_TOKEN`, `WORKDRIVE_FOLDER_ID`.
   - Variables: `WORKDRIVE_UPLOAD` = `true` (this switches the job on), and `WORKDRIVE_DC` only if you are not on `in`.

## What it does

When the Mac, Windows and Linux jobs all succeed, the `workdrive` job gathers every file, merges the checksums into one
`SHA256SUMS-<version>.txt`, and uploads them to that folder. File names carry the version (`HitList-1.1.57-arm64.dmg`), so each
run adds new files. It **never deletes** anything: older versions pile up, so remove old ones from WorkDrive now and then
(each run adds about 800 MB).

## Trying it without uploading

```
node scripts/ci/upload-workdrive.mjs some-folder --dry-run
```

lists what would be uploaded and needs no settings. A real run with settings missing stops and names what to add.

## Keep in mind

- The refresh token acts as you on WorkDrive for the scopes above. Keep it only in GitHub secrets; if it leaks, remove the
  client in the API console.
- This has not been run against your WorkDrive yet (it needs your credentials). The first real run may need small fixes; the
  job's log shows the file being uploaded and any answer WorkDrive gives.
- The download page links to a WorkDrive folder. If you upload to a different folder than the one it links to, change the link in
  `client/index.html` and redeploy the page (`catalyst deploy --only client`).
