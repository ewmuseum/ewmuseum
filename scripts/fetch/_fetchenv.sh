#!/usr/bin/env bash
# Sourced by every shell script in scripts/fetch/. Same roots as scripts/ops.
set -u
FETCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${MUSEUM_ROOT:=$(cd "$FETCH_DIR/../.." && pwd)}"
export MUSEUM_ROOT
. "$MUSEUM_ROOT/ops/config.env"
[ -n "$NODE_BIN" ] && export PATH="$NODE_BIN:$PATH"
export FETCH_DIR
