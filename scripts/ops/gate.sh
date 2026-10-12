#!/usr/bin/env bash
# GATE — runs the canonical gate under the locale the commit will use.
#
#     scripts/ops/gate.sh [label]
#
# This is a THIN WRAPPER. The gate itself is scripts/gate.sh and stays the one
# sanctioned implementation: it runs the chain, strips the regen's trailing
# whitespace from the HTML this commit touches, and writes the green stamp
# ($GITDIR/gate-ok) that .git/hooks/pre-commit compares against a fresh digest
# of the tree. Nothing here re-implements any of that, and nothing here may:
# hand-rolling a gate check is prohibited (GAVELS 2026-08-30, gate guardrails),
# as is --no-verify.
#
# What the wrapper adds is exactly two things:
#   * LC_ALL=C, because the pre-commit digest sorts the file list and a gate and
#     its commit must share a locale or the stamp will never match;
#   * a log and a GATE_RC line for the cycle to read.
#
# Exit code is the gate's own. Green (0) means a stamp was written and a commit
# of THIS EXACT content will pass the hook; anything else means no stamp exists
# and commits are blocked, which is the correct outcome.
set -u
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

LABEL="${1:-$(date -u +%Y%m%d-%H%M%S)}"
LOG="$SCRATCH_ROOT/gate$LABEL.log"

cd "$MUSEUM_ROOT" || exit 1
ops_say "gate $LABEL: running the canonical gate (scripts/gate.sh) under LC_ALL=C"
LC_ALL=C npm run gate > "$LOG" 2>&1
RC=$?
ops_rc_line GATE "$RC" "$LOG"

if [ "$RC" -eq 0 ]; then
  ops_say "GATE $LABEL GREEN — $(grep 'GATE-GREEN' "$LOG" | tail -1)"
else
  ops_say "GATE $LABEL RED (GATE_RC=$RC) — no stamp written, commits blocked. Log: $LOG"
  grep -E '✗|PRIVACY-FAIL|GATE-RED' "$LOG" | head -20
fi
exit $RC
