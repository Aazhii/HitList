#!/bin/sh
# Works out the version, release name, release tag and pre-release flag for a workflow run, and prints them as lines
# `version=...`, `name=...`, `tag=...` and `prerelease=true|false`.
#   Manual run (the form):  <name>_<major>.<minor>.<patch>[-<alpha|beta><number>]
#       an empty PATCH means the run number (always new); a stage of "none" or empty means a normal release;
#       with a stage the number defaults to 1, e.g. 1.2.5-beta2 -> tag HitList_1.2.5-beta2, marked as a pre-release
#   Pushed tag:             v1.2.3, v1.2.3-beta2, HitList_1.2.3 or HitList_1.2.3-alpha1 -> the same, read back from the tag
# Inputs come from the environment: REF_TYPE, REF_NAME, IN_NAME, IN_MAJOR, IN_MINOR, IN_PATCH, IN_STAGE, IN_STAGE_NUM, RUN_NUMBER.
set -e
die() { echo "$1" >&2; exit 1; }
number() { case "$2" in ''|*[!0-9]*) die "$1 must be a whole number (got '$2')";; esac; }

if [ "${REF_TYPE}" = "tag" ]; then
  T="${REF_NAME}"
  case "$T" in *_[0-9]*) NAME="${T%_[0-9]*}"; T="${T#"$NAME"_}"; NAME=$(printf '%s' "$NAME" | tr '_' ' ');; v[0-9]*) T="${T#v}"; NAME="HitList";; *) die "A tag must look like v1.2.3 or HitList_1.2.3 (got '${REF_NAME}')";; esac
  VERSION="$T"
  printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta)[0-9]+)?$' \
    || die "A tag's version must look like 1.2.3, 1.2.3-alpha1 or 1.2.3-beta2 (got '${VERSION}')"
else
  MAJOR="${IN_MAJOR:-1}"; MINOR="${IN_MINOR:-1}"; PATCH="${IN_PATCH:-${RUN_NUMBER}}"
  number "Major" "$MAJOR"; number "Minor" "$MINOR"; number "Patch" "$PATCH"
  VERSION="${MAJOR}.${MINOR}.${PATCH}"
  case "${IN_STAGE:-none}" in
    none|'') ;;
    alpha|beta) STAGE_NUM="${IN_STAGE_NUM:-1}"; number "The ${IN_STAGE} number" "$STAGE_NUM"; VERSION="${VERSION}-${IN_STAGE}${STAGE_NUM}";;
    *) die "The stage must be none, alpha or beta (got '${IN_STAGE}')";;
  esac
  NAME="${IN_NAME:-HitList}"
fi
# The name ends up in a title, a tag and a command: keep it to plain characters.
case "$NAME" in *[!A-Za-z0-9\ ._-]*) die "The release name may only use letters, numbers, spaces, dots, dashes and underscores";; esac
[ -n "$NAME" ] || die "The release name cannot be empty"
TAG="$(printf '%s' "$NAME" | tr ' ' '_')_${VERSION}"
case "$VERSION" in *-alpha*|*-beta*) PRE=true;; *) PRE=false;; esac
echo "version=${VERSION}"
echo "name=${NAME}"
echo "tag=${TAG}"
# The name as one word, for file and download names: spaces and underscores become dashes.
echo "slug=$(printf '%s' "$NAME" | tr ' _' '--')"
echo "prerelease=${PRE}"
