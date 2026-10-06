#!/bin/sh
# Runs compute-version.sh with different inputs and checks the answers. Usage: sh scripts/ci/compute-version.test.sh
cd "$(dirname "$0")"
fail=0
check() { # description, expected output (or FAIL), env assignments...
  desc="$1"; want="$2"; shift 2
  got=$(env -i PATH="$PATH" "$@" sh ./compute-version.sh 2>/dev/null | tr '\n' ' ') || got="FAIL"
  [ -z "$got" ] && got="FAIL"
  if [ "$got" = "$want " ] || { [ "$want" = "FAIL" ] && [ "$got" = "FAIL" ]; }; then echo "ok   $desc"; else echo "FAIL $desc: wanted [$want] got [$got]"; fail=1; fi
}
check "all fields, no stage"        "version=2.3.5 name=Spring Release tag=Spring_Release_2.3.5 slug=Spring-Release prerelease=false"  REF_TYPE=branch IN_NAME="Spring Release" IN_MAJOR=2 IN_MINOR=3 IN_PATCH=5 IN_STAGE=none RUN_NUMBER=99
check "beta with a number"          "version=1.2.5-beta2 name=HitList tag=HitList_1.2.5-beta2 slug=HitList prerelease=true"       REF_TYPE=branch IN_MAJOR=1 IN_MINOR=2 IN_PATCH=5 IN_STAGE=beta IN_STAGE_NUM=2 RUN_NUMBER=99
check "alpha, number left empty"    "version=1.2.5-alpha1 name=HitList tag=HitList_1.2.5-alpha1 slug=HitList prerelease=true"     REF_TYPE=branch IN_MAJOR=1 IN_MINOR=2 IN_PATCH=5 IN_STAGE=alpha IN_STAGE_NUM= RUN_NUMBER=99
check "number ignored with no stage" "version=1.2.5 name=HitList tag=HitList_1.2.5 slug=HitList prerelease=false"                 REF_TYPE=branch IN_MAJOR=1 IN_MINOR=2 IN_PATCH=5 IN_STAGE=none IN_STAGE_NUM=7 RUN_NUMBER=99
check "patch empty = run number"    "version=1.1.99 name=HitList tag=HitList_1.1.99 slug=HitList prerelease=false"                REF_TYPE=branch RUN_NUMBER=99
check "empty fields use defaults"   "version=1.1.7 name=HitList tag=HitList_1.1.7 slug=HitList prerelease=false"                  REF_TYPE=branch IN_NAME= IN_MAJOR= IN_MINOR= IN_PATCH= IN_STAGE= RUN_NUMBER=7
check "tag v1.2.0"                  "version=1.2.0 name=HitList tag=HitList_1.2.0 slug=HitList prerelease=false"                  REF_TYPE=tag REF_NAME=v1.2.0 RUN_NUMBER=1
check "tag v1.2.0-beta3"            "version=1.2.0-beta3 name=HitList tag=HitList_1.2.0-beta3 slug=HitList prerelease=true"       REF_TYPE=tag REF_NAME=v1.2.0-beta3 RUN_NUMBER=1
check "tag with a name"             "version=1.3.4 name=Core Library tag=Core_Library_1.3.4 slug=Core-Library prerelease=false"        REF_TYPE=tag REF_NAME=Core_Library_1.3.4 RUN_NUMBER=1
check "a hyphenated name keeps its hyphens"  "version=0.0.1 name=process-fix tag=process-fix_0.0.1 slug=process-fix prerelease=false"  REF_TYPE=branch IN_NAME=process-fix IN_MAJOR=0 IN_MINOR=0 IN_PATCH=1 IN_STAGE=none RUN_NUMBER=5
check "a bad tag is refused"        "FAIL"   REF_TYPE=tag REF_NAME=vnext RUN_NUMBER=1
check "a bad tag version is refused" "FAIL"  REF_TYPE=tag REF_NAME=v1.2.0-gamma1 RUN_NUMBER=1
check "a non-number is refused"     "FAIL"   REF_TYPE=branch IN_MAJOR=one RUN_NUMBER=1
check "a negative number is refused" "FAIL"  REF_TYPE=branch IN_MINOR=-1 RUN_NUMBER=1
check "a bad stage is refused"      "FAIL"   REF_TYPE=branch IN_STAGE=rc IN_STAGE_NUM=1 RUN_NUMBER=1
check "a bad stage number is refused" "FAIL" REF_TYPE=branch IN_STAGE=beta IN_STAGE_NUM=x RUN_NUMBER=1
check "odd characters in the name are refused" "FAIL" REF_TYPE=branch IN_NAME='x"; rm -rf /' RUN_NUMBER=1
exit $fail
