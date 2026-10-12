#!/bin/bash
. "$(dirname "${BASH_SOURCE[0]}")/_fetchenv.sh"
# Cron entry point (2026-09-18): arm the nightly IA trickle shoulders unless a wrapper is already running.
# The check is anchored to a real 'bash <path>/ia-trickle-shoulders.sh' invocation — a bare pgrep -f matched cron's own
# '/bin/sh -c …ia-trickle-shoulders.sh…' line and never armed anything on 2026-09-18.
T="$FETCH_DIR"
if pgrep -f '^bash .*ia-trickle-shoulders\.sh' >/dev/null; then exit 0; fi
cd "$WORKSHOP_ROOT/fwrestling-census" || exit 1
nohup bash "$FETCH_DIR/ia-trickle-shoulders.sh" > /dev/null 2>&1 &
echo "$(date '+%F %T') armed by cron" >> $WORKSHOP_ROOT/fwrestling-census/ia-trickle.launch.log
