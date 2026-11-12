#!/bin/sh
# Takes SQLite's native library for 64-bit Linux out of the backend jar and puts it where the Linux packages (.deb and
# AppImage) carry it beside the app, as <resources>/native/libsqlitejdbc.so.
#
# Why: the database driver would otherwise unpack that library into the system temporary folder and load it from there,
# which a system that mounts /tmp "noexec" refuses (the backend then never starts). main.js points the driver at the
# shipped copy instead (see backendLaunch.js). Run it after the jar is in resources/ and before electron-builder.
#
# ARCH is x86_64 for the shipped packages; another value only serves testing on a different Linux machine.
set -e
cd "$(dirname "$0")/.."
ARCH="${ARCH:-x86_64}"
JAR=resources/hitlist.jar
test -s "$JAR" || { echo "$JAR is missing: build or download the backend jar first." >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# The backend is a Spring Boot jar: the driver is a jar inside it, and the library a file inside that.
DRIVER=$(unzip -Z1 "$JAR" 'BOOT-INF/lib/sqlite-jdbc-*.jar' | head -n 1)
test -n "$DRIVER" || { echo "No sqlite-jdbc inside $JAR." >&2; exit 1; }
unzip -p "$JAR" "$DRIVER" > "$TMP/driver.jar"
unzip -p "$TMP/driver.jar" "org/sqlite/native/Linux/$ARCH/libsqlitejdbc.so" > "$TMP/libsqlitejdbc.so"

test -s "$TMP/libsqlitejdbc.so" || { echo "The driver has no Linux/$ARCH library." >&2; exit 1; }
# An ELF file starts with 0x7f 'E' 'L' 'F'; anything else is not a library.
[ "$(head -c 4 "$TMP/libsqlitejdbc.so" | od -An -c | tr -d ' ')" = '177ELF' ] || { echo "The extracted file is not a Linux library." >&2; exit 1; }

rm -rf resources/sqlite-native-linux
mkdir -p resources/sqlite-native-linux
mv "$TMP/libsqlitejdbc.so" resources/sqlite-native-linux/libsqlitejdbc.so
chmod 755 resources/sqlite-native-linux/libsqlitejdbc.so
echo "desktop/resources/sqlite-native-linux ready ($(basename "$DRIVER"), $ARCH, $(wc -c < resources/sqlite-native-linux/libsqlitejdbc.so | tr -d ' ') bytes)"
