#!/usr/bin/env bash
# CYCLE — one entry point that runs one whole cycle.
#
#     scripts/ops/cycle.sh <N> [--dry-run] [--no-push] [--no-publish]
#     npm run cycle -- 148
#
# N is an ARGUMENT. Nothing in this repo is derived by substituting a number
# into a script: the scratchpad era minted eight scripts per cycle by sed and
# lost two chains to it (a bare s/95/96/g rewrote the session id inside the
# scratchpad path; a bare s/97/98/g turned every "1997" wave glob into "1998").
# There is one script and it takes N. That whole failure mode is gone.
#
# The sequence, which is the sequence the cycle has always had:
#
#   1. after-window — the PREVIOUS cycle's window, if it has not run yet. A
#      cycle never starts on top of an unlanded window.
#   2. preflight N  — standing fixers, regen chain, registry check. PREFLIGHT_RC.
#   3. gate N       — the canonical gate under LC_ALL=C. GATE_RC. On red, the
#      red handler loops up to four times; if it gives up, the cycle STOPS here
#      and never reaches a commit. A red gate has never been a reason to commit.
#   4. chain N      — commit the stamped tree from ops/commit-stub.txt, publish,
#      push, and then open the gate-free window.
#
# Each step's real exit code is captured immediately after the command and
# written to the cycle log as its own line (invariant 12).
set -u
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

N="${1:?usage: cycle.sh <N> [--dry-run] [--no-push] [--no-publish]}"
case "$N" in ''|*[!0-9]*) echo "cycle: N must be a number, got '$N'" >&2; exit 2 ;; esac
shift
PASS=""
for a in "$@"; do
  case "$a" in
    --dry-run|--no-push|--no-publish) PASS="$PASS $a" ;;
    *) echo "unknown flag $a" >&2; exit 2 ;;
  esac
done

CYCLELOG="$SCRATCH_ROOT/cycle$N.log"
ops_say "== cycle $N starting (museum=$MUSEUM_ROOT) ==" | tee -a "$CYCLELOG"

# ---- 1. after-window: land the previous cycle's window if it never ran ----
PREV=$((N - 1))
if [ -f "$SCRATCH_ROOT/chain$PREV.log" ] && [ ! -f "$SCRATCH_ROOT/window$PREV.log" ]; then
  ops_say "cycle $N: window $PREV never ran — running it before this cycle" | tee -a "$CYCLELOG"
  bash "$OPS_DIR/window.sh" "$PREV"
  ops_rc_line "AFTERWINDOW$PREV" "$?" "$CYCLELOG"
fi

# ---- 2. preflight --------------------------------------------------------
bash "$OPS_DIR/preflight.sh" "$N"
PRC=$?
ops_rc_line PREFLIGHT "$PRC" "$CYCLELOG"
[ "$PRC" -eq 0 ] || { ops_say "cycle $N: preflight not clean (rc=$PRC) — stopping" | tee -a "$CYCLELOG"; exit "$PRC"; }

# ---- 3. gate, with the red loop -----------------------------------------
bash "$OPS_DIR/gate.sh" "$N"
GRC=$?
ops_rc_line GATE "$GRC" "$CYCLELOG"
if [ "$GRC" -ne 0 ]; then
  bash "$OPS_DIR/red-handler.sh" "$N"
  GRC=$?
  ops_rc_line GATE_AFTER_RED "$GRC" "$CYCLELOG"
fi
[ "$GRC" -eq 0 ] || { ops_say "cycle $N: gate still red — STOPPING, no commit" | tee -a "$CYCLELOG"; exit "$GRC"; }

# ---- 4. chain (commit -> publish -> push -> window) ----------------------
# The gate guards the chain with && and never with ';' (invariant 12).
bash "$OPS_DIR/chain.sh" "$N" $PASS
CRC=$?
ops_rc_line CHAIN "$CRC" "$CYCLELOG"

ops_say "== cycle $N done (PREFLIGHT_RC=$PRC GATE_RC=$GRC CHAIN_RC=$CRC) ==" | tee -a "$CYCLELOG"
exit "$CRC"
