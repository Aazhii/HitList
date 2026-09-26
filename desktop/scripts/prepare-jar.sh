#!/bin/sh
# Builds hitlist.jar with the frontend embedded, the same way the production
# Docker image does, and copies it to desktop/resources/ for packaging.
#
# Reuses the repo's own Dockerfile rather than a second, parallel build path —
# `--target backend` stops at the stage that has already run the frontend
# build and copied dist/ in as static resources, before `mvn package`, so the
# jar this produces is identical to what ships in the Docker image.
set -e
cd "$(dirname "$0")/../.."

docker build --target backend -t hitlist-backend-build .
mkdir -p desktop/resources
container=$(docker create hitlist-backend-build)
docker cp "$container:/workspace/target/hitlist.jar" desktop/resources/hitlist.jar
docker rm "$container" >/dev/null

echo "desktop/resources/hitlist.jar ready ($(du -h desktop/resources/hitlist.jar | cut -f1))"
