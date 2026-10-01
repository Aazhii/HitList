# Building on your computer

You need: Node 24, pnpm 10, JDK 25 (for Maven and, on a Mac, `jlink`), and a network connection (the tools download pieces).
Docker is only needed for the `prepare:jar` shortcut; the manual way below does not use it.

## 1. The backend jar (once per change to `web/` or `api/`)

```
cd web && pnpm install && pnpm exec tsc -b && pnpm exec vite build
mkdir -p ../api/src/main/resources/static && cp -R dist/. ../api/src/main/resources/static/
cd ../api && mvn -DskipTests package          # -> api/target/hitlist.jar
cp target/hitlist.jar ../desktop/resources/hitlist.jar
```

(`desktop/scripts/prepare-jar.sh` does the same inside Docker: `pnpm run prepare:jar` in `desktop/`.)

## 2. The apps

All commands run in `desktop/` after `pnpm install`. Output goes to `desktop/dist/`.

| You want | Run | You get |
|---|---|---|
| Mac (Apple silicon) | `sh scripts/prepare-jre.sh && pnpm exec electron-builder --mac --arm64` | `HitList-<version>-arm64.dmg` |
| Windows (64-bit) | `sh scripts/prepare-jre-win.sh && pnpm exec electron-builder --win --x64` | `HitList-Setup-<version>-x64.exe` |
| Linux (64-bit) | `sh scripts/prepare-jre-linux.sh && pnpm exec electron-builder --linux --x64` | `HitList-<version>-x64.AppImage` and `HitList_<version>_amd64.deb` |

The Windows and Linux apps build fine on a Mac. The Mac `.dmg` can only be built on a Mac.

The version comes from `desktop/package.json`. To stamp a different one without editing the file, add
`-c.extraMetadata.version=1.2.3` to the `electron-builder` command (this is what the GitHub workflow does).

## 3. Trying it without packaging

```
cd desktop && pnpm start
```

It uses `api/target/hitlist.jar` and your `java`. It shares the real data folder, so back up first
(account menu, Export workspace).

## 4. Checks before you ship

```
cd web && pnpm design:check && pnpm exec tsc -b && pnpm exec eslint src test && pnpm vitest run
cd api && mvn test
cd desktop && pnpm test
cd functions/backup && npm test
```

## Signing

Nothing is signed with a paid certificate. The Mac build is re-signed with an ad-hoc signature after packing
(`desktop/scripts/afterPack.js`), which is what stops macOS calling it "damaged". Windows and Linux are unsigned. First-open
steps for users are in [../INSTALL.md](../INSTALL.md).
