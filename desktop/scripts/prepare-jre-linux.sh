#!/bin/sh
# Downloads the official Temurin Java 25 runtime for 64-bit Linux into resources/jre-linux, to be bundled in the Linux
# packages (AppImage and .deb). jlink cannot make a Linux runtime on a Mac, and a full Temurin runtime is simpler and the
# one Adoptium supports. Needs network access to api.adoptium.net.
set -e
cd "$(dirname "$0")/.."
URL="https://api.adoptium.net/v3/binary/latest/25/ga/linux/x64/jre/hotspot/normal/eclipse"
TMP=$(mktemp -d)
curl -fL --retry 3 -o "$TMP/jre.tar.gz" "$URL"
mkdir -p "$TMP/x"
tar -xzf "$TMP/jre.tar.gz" -C "$TMP/x"
rm -rf resources/jre-linux
mkdir -p resources
mv "$TMP"/x/*/ resources/jre-linux
rm -rf "$TMP"
test -x resources/jre-linux/bin/java
echo "desktop/resources/jre-linux ready ($(du -sh resources/jre-linux | cut -f1))"
