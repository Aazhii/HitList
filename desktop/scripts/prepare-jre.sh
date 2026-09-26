#!/bin/sh
# Builds a minimal custom Java runtime with jlink — only the modules
# hitlist.jar actually needs, not a full JDK (~350MB down to ~55MB).
#
# Must run on the same OS/architecture you're packaging for: jlink produces
# native binaries, not portable ones (this is why it isn't done via Docker —
# a Linux container can only produce a Linux java binary, useless on macOS).
# Uses whatever `jlink` is first on PATH, which must be JDK 25+ to match
# api/pom.xml's <maven.compiler.release>.
#
# The module list below was derived once with jdeps against the real,
# extracted dependency classpath (Spring Boot's fat jar hides jars from a
# naive `jdeps hitlist.jar` — see the plan doc's Slice 3 notes for the exact
# command). Re-run that derivation if api/pom.xml's dependencies change in a
# way that might need a new module; this list doesn't need to change for
# ordinary code changes.
set -e
cd "$(dirname "$0")/.."

mkdir -p resources
rm -rf resources/jre
jlink \
  --add-modules java.base,java.compiler,java.desktop,java.instrument,java.logging,java.management,java.naming,java.net.http,java.prefs,java.rmi,java.scripting,java.security.jgss,java.sql.rowset,jdk.jfr,jdk.unsupported \
  --output resources/jre \
  --strip-debug --no-header-files --no-man-pages --compress=zip-6

echo "desktop/resources/jre ready ($(du -sh resources/jre | cut -f1))"
