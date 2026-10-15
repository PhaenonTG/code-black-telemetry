#!/bin/sh
set -eu

if [ "${RENEWED_LINEAGE:-}" = /etc/letsencrypt/live/ops-private.codeblackwx.com ]; then
  systemctl try-restart codeblack-private-ops.service
fi
