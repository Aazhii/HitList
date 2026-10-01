#!/bin/sh
# Runs compute-version.sh with different inputs and checks the answers. Usage: sh scripts/ci/compute-version.test.sh
cd "$(dirname "$0")"
fail=0
check() { # description, expected output (or FAIL), env assignments...
  desc="$1"; want="$2"; shift 2
  got=$(env -i PATH="$PATH" "$@" sh ./compute-version.sh 2>/dev/null | tr '\n' ' ') || got="FAIL"
  [ -z "$got" ] && got="FAIL"
  if [ "$got" = "$want" ] || [ "$got" = "$want " ]; then echo "ok   $desc"; else echo "FAIL $desc: wanted [$want] got [$got]"; fail=1; fi
}
check "all four fields"            "version=2.3.5 name=Spring Release "  REF_TYPE=branch IN_NAME="Spring Release" IN_MAJOR=2 IN_MINOR=3 IN_PATCH=5 RUN_NUMBER=99
check "patch left empty = run number" "version=1.1.99 name=HitList "     REF_TYPE=branch RUN_NUMBER=99
check "empty fields use defaults"  "version=1.1.7 name=HitList "         REF_TYPE=branch IN_NAME= IN_MAJOR= IN_MINOR= IN_PATCH= RUN_NUMBER=7
check "a tag decides the version"  "version=1.2.0 name=HitList "         REF_TYPE=tag REF_NAME=v1.2.0 IN_MAJOR=9 RUN_NUMBER=1
check "a bad tag is refused"       "FAIL"                                REF_TYPE=tag REF_NAME=vnext RUN_NUMBER=1
check "a non-number is refused"    "FAIL"                                REF_TYPE=branch IN_MAJOR=one RUN_NUMBER=1
check "a negative number is refused" "FAIL"                              REF_TYPE=branch IN_MINOR=-1 RUN_NUMBER=1
check "odd characters in the name are refused" "FAIL"                    REF_TYPE=branch IN_NAME='x"; rm -rf /' RUN_NUMBER=1
exit $fail
