#!/bin/sh
# Downloads the official Temurin Java 25 runtime for 64-bit Windows into resources/jre-win, to be bundled in the Windows
# installer. (The Mac build makes its own small runtime with jlink; jlink cannot make a Windows runtime on a Mac, and a
# full Temurin runtime is simpler and the one Adoptium supports.) Needs network access to api.adoptium.net.
set -e
cd "$(dirname "$0")/.."
URL="https://api.adoptium.net/v3/binary/latest/25/ga/windows/x64/jre/hotspot/normal/eclipse"
TMP=$(mktemp -d)
curl -fL --retry 3 -o "$TMP/jre.zip" "$URL"
unzip -q "$TMP/jre.zip" -d "$TMP/x"
rm -rf resources/jre-win
mkdir -p resources
# The zip holds one folder (jdk-25...-jre); its contents become resources/jre-win.
mv "$TMP"/x/*/ resources/jre-win
rm -rf "$TMP"
test -f resources/jre-win/bin/java.exe
echo "desktop/resources/jre-win ready ($(du -sh resources/jre-win | cut -f1)); java.exe present"
