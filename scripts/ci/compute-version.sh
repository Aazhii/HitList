#!/bin/sh
# Works out the version and the release name for a workflow run, and prints them as `version=...` and `name=...` lines.
#   - Pushed tag v1.2.3            -> version 1.2.3
#   - Manual run with the form     -> MAJOR.MINOR.PATCH from the fields; an empty PATCH means the run number (always unique)
# Inputs come from the environment: REF_TYPE, REF_NAME, IN_NAME, IN_MAJOR, IN_MINOR, IN_PATCH, RUN_NUMBER.
set -e
number() { case "$2" in ''|*[!0-9]*) echo "$1 must be a whole number (got '$2')" >&2; exit 1;; esac; }

if [ "${REF_TYPE}" = "tag" ]; then
  VERSION="${REF_NAME#v}"
  case "$VERSION" in [0-9]*.[0-9]*.[0-9]*) ;; *) echo "A tag must look like v1.2.3 (got '${REF_NAME}')" >&2; exit 1;; esac
  NAME="HitList"
else
  MAJOR="${IN_MAJOR:-1}"; MINOR="${IN_MINOR:-1}"; PATCH="${IN_PATCH:-${RUN_NUMBER}}"
  number "Major" "$MAJOR"; number "Minor" "$MINOR"; number "Patch" "$PATCH"
  VERSION="${MAJOR}.${MINOR}.${PATCH}"
  NAME="${IN_NAME:-HitList}"
fi
# The name ends up in a title and a command: keep it to plain characters.
case "$NAME" in *[!A-Za-z0-9\ ._-]*) echo "The release name may only use letters, numbers, spaces, dots, dashes and underscores" >&2; exit 1;; esac
echo "version=${VERSION}"
echo "name=${NAME}"
