#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
: "${CODEBLACK_RADAR_PORT:=8787}"
export CODEBLACK_RADAR_PORT
node radar-worker/worker.cjs
