# Installing HitList on a Mac

HitList is a desktop app. It works without the internet, and your data stays on your Mac unless you sign in to back it up.
The same steps are on the download page (`client/index.html`).

**Requirements:** a Mac with Apple silicon (M1 or later). There is no build for Intel Macs or Windows yet.

**Download:** https://workdrive.zohoexternal.in/external/1658ad81d16124c31bf123fcf81cd7d42f359e6a1ee60b4a2ece48d372cd397d

## Install

1. Open the downloaded `HitList-….dmg`.
2. Drag **HitList** onto **Applications**.
3. Open **HitList** from Applications. The first time, macOS will block it (below).

## The first time you open it

The app is not signed with an Apple developer certificate, so macOS says it cannot check it. This is expected and happens once.

1. Try to open HitList. When macOS says it was blocked, click **Done**.
2. Open **System Settings → Privacy & Security** and scroll to **Security**.
3. Next to "HitList was blocked", click **Open Anyway** and confirm with your password.
4. Open HitList again and click **Open**.

If macOS says **"HitList is damaged and can't be opened"**, or **Open Anyway** does not appear, the app is not damaged: macOS
uses that wording for apps without an Apple certificate. Run this once in Terminal and open HitList normally:

```
xattr -dr com.apple.quarantine /Applications/HitList.app
```

## Using it

- No account is needed. Your tasks, notes and databases are stored on your Mac.
- **Sign in to back up:** account menu (top right) → *Sign in to back up*. Your workspace is then backed up to your account
  when something has changed, up to three times a day. *Back up now* is in the same menu.
- **New computer:** install HitList, sign in with the same account, and choose *Restore* when it offers your backup.
  *Account → Restore from backup* does the same on demand. Restoring only adds; it never overwrites or deletes.

## Updating

Download the new version and drag it onto **Applications**, replacing the old one. Your data is kept, because it lives in
`~/Library/Application Support/HitList` and not inside the app. Moving the app to the Trash does not delete it either.
Before an update (or any time) you can copy your data with *Account → Export workspace*.

## If something looks wrong

- The app opens empty after an update: the data folder above should still hold `hitlist.db`. Sign in and use *Restore from
  backup* if you have backed up.
- It will not open at all: quit it fully (Cmd-Q) and open it again. Only one copy can run at a time.
