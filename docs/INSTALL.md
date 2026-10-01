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

## Linux notes

- On recent Ubuntu, the system restricts the sandbox Electron uses. HitList notices this and starts without Chromium's
  sandbox in that one case so that it opens; elsewhere the sandbox stays on.
- Your data is kept in `~/.config/HitList`. Updating means downloading the new file (and running the new `.deb`, or
  replacing the AppImage); the data folder is not touched.
- **Linux has not been tested by the developer yet**, so please report anything odd, with your distribution and version.
