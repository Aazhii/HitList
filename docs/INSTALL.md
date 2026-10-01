# Installing HitList

HitList is a desktop app. It works without the internet, and your data stays on your Mac unless you sign in to back it up.
The same steps are on the download page (`client/index.html`).

**Requirements:** a Mac with Apple silicon (M1 or later), a 64-bit Windows 10 or 11 PC, or a 64-bit Linux PC. There is no build for
Intel Macs. Windows and Linux steps are further down.

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
- **Signing in:** *Sign in to back up* opens a small window with three choices. *Sign in* is for an existing account and password.
  *Create an account* is for new people (you choose your password). *Set or reset my password* is for anyone who was added by someone
  else or forgot theirs; it emails a link. Zoho and Google buttons are on the sign-in page.
- **Sign in to back up:** account menu (top right) → *Sign in to back up*. Your workspace is then backed up to your account
  about every three days (only when something has changed), and once more when you sign out. *Back up now* is in the same menu.
  If the app cannot reach the internet when you sign out, it tells you; your data stays on the computer.
- **New computer:** install HitList, sign in with the same account, and choose *Restore* when it offers your backup.
  *Account → Restore from backup* does the same on demand. Restoring only adds; it never overwrites or deletes.

## Updating

**From inside the app.** *Account → Check for updates* looks at the project's GitHub Releases (the app also checks by itself a minute
after it opens, then once a day, and says so once if a newer version exists). If there is one you see its notes. **Download** shows
a progress bar (and a Cancel button), then checks the file against the release's `SHA256SUMS.txt` (a file that does not match is
deleted). **Restart and update** then closes HitList, replaces the installed app, and opens the new version by itself: nothing to
drag. Choose **Later** to keep the download for next time. Your tasks are kept, because they live in the data folder and not in
the app, and a backup is attempted first when you are signed in. If the swap fails, the old app is put back.

The one-click replace works when HitList is installed somewhere you can write to (the normal Applications folder on Mac, an
AppImage you own on Linux, the installer on Windows). If it is not (for example it is running straight from the disk image), the last
step opens the installer instead, and the by-hand steps below apply. Stable installs are only offered stable releases; an alpha or
beta install is offered newer alpha, beta and stable ones. Only releases made with *publish* ticked count, and the repository must stay public.

**By hand.** Download the new version and drag it onto **Applications**, replacing the old one. Your data is kept, because it lives in
`~/Library/Application Support/HitList` and not inside the app. Moving the app to the Trash does not delete it either.
Before an update (or any time) you can copy your data with *Account → Export workspace*.

## If something looks wrong

- The app opens empty after an update: the data folder above should still hold `hitlist.db`. Sign in and use *Restore from
  backup* if you have backed up.
- It will not open at all: quit it fully (Cmd-Q) and open it again. Only one copy can run at a time.

---

# Installing HitList on Windows

**Requirements:** Windows 10 or 11, 64-bit (also runs on ARM PCs). Java is included; you do not need to install it.

1. Download `HitList-Setup-….exe` from the same download folder.
2. Double-click it. Windows shows a blue **"Windows protected your PC"** screen, because the app is not signed with a paid
   certificate. This is expected. Click **More info**, then **Run anyway**.
3. Follow the installer (you can choose the folder), then open **HitList** from the Start menu or the desktop shortcut.
4. If your antivirus or Windows Defender asks, choose to allow it. It is the same app described here, only unsigned.

Your data is kept in `%APPDATA%\HitList` (type that in the File Explorer address bar). Updating means running the new
installer over the old one; uninstalling the app does not delete that folder. Backups, restore and signing in work exactly
as on a Mac (account menu, top right). **Windows has not been tested by the developer yet**, so please report anything odd.

---

# Installing HitList on Linux

**Requirements:** a 64-bit (x86-64) Linux desktop. Java is included. ARM Linux (Raspberry Pi and similar) has no build.
There are two files in the download folder; use whichever suits your system.

## AppImage (works on most distributions)

1. Download `HitList-….AppImage`.
2. Make it runnable. In a terminal: `chmod +x HitList-*.AppImage` (or right-click it, Properties, Permissions, "Allow
   executing as a program").
3. Double-click it, or run `./HitList-*.AppImage`.

If it does not start and mentions **FUSE**, install it (on Ubuntu 22.04 and later: `sudo apt install libfuse2`; on 24.04:
`sudo apt install libfuse2t64`). If you would rather not, run it with `./HitList-*.AppImage --appimage-extract-and-run`.

## .deb (Ubuntu, Debian and relatives)

```
sudo apt install ./HitList_*_amd64.deb
```

Then open **HitList** from the applications menu.

`apt` may end with a note starting `N: Download is performed unsandboxed as root as file '…' couldn't be accessed by user '_apt'`.
That is only a notice, not a failure: the install worked. To avoid it, copy the file to `/tmp` first and install from there.
You can also start HitList from a terminal with `hitlist-desktop`.

## Linux notes

- On recent Ubuntu, the system restricts the sandbox Electron uses. HitList notices this and starts without Chromium's
  sandbox in that one case so that it opens; elsewhere the sandbox stays on.
- Your data is kept in `~/.config/HitList`. Updating means downloading the new file (and running the new `.deb`, or
  replacing the AppImage); the data folder is not touched.
- **Linux has not been tested by the developer yet**, so please report anything odd, with your distribution and version.
