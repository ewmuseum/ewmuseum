#!/usr/bin/env bash
# Sourced by every scripts/ops script. Establishes the roots, the log dir and a
# couple of shared helpers. Never run directly.
set -u

# MUSEUM_ROOT comes from THIS file's own location (scripts/ops/_common.sh ->
# two levels up), so a clone anywhere is correct with nothing edited. An
# explicit MUSEUM_ROOT in the environment still wins.
_OPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${MUSEUM_ROOT:=$(cd "$_OPS_DIR/../.." && pwd)}"
export MUSEUM_ROOT
# shellcheck source=../../ops/config.env
. "$MUSEUM_ROOT/ops/config.env"

[ -n "$NODE_BIN" ] && export PATH="$NODE_BIN:$PATH"
mkdir -p "$SCRATCH_ROOT"

# Node is not always on the default PATH (it is not on this project's own
# machine: it lives under ~/.local/opt). Say so once, clearly, instead of
# letting every npm step fail with "command not found" thirty lines later.
if ! command -v node >/dev/null; then
  echo "ops: node is not on PATH. Set NODE_BIN to the directory holding node/npm," >&2
  echo "     e.g.  NODE_BIN=\$HOME/.local/opt/node/bin npm run preflight" >&2
  echo "     (ops/config.env documents every root; nothing here may hardcode one.)" >&2
  exit 127
fi

OPS_DIR="$_OPS_DIR"
FIXERS_DIR="$MUSEUM_ROOT/scripts/fixers"
export OPS_DIR FIXERS_DIR

# ---- helpers -------------------------------------------------------------

ops_say() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

# ops_rc_line <name> <rc> <logfile> — the invariant-12 shape: the real exit code
# is captured immediately after the command, never after a pipe, and written as
# its own line so a reader (and the readout) keys off the code, not the prose.
ops_rc_line() { printf '%s_RC=%s\n' "$1" "$2" >> "$3"; }

# ops_wave_dirs — every wave directory under the configured trees, one per line.
# Missing trees are silently skipped: a clone with no local collection simply
# yields nothing and every wave step no-ops.
# SORTED (lane SIBLING-FIELD-HOOK, 2026-10-05, D308, hook c65): by wave NAME across every tree (LC_ALL=C; the full path
# breaks a tie), so the window's order is defined and repeatable. It was raw `find` order (directory order on disk), which
# decides which of two waves touching one field lands first in a window step; land-check's L-SIBLING-FIELD now holds
# such pairs, and the order no longer depends on the filesystem.
ops_wave_dirs() {
  local t
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    [ -d "$WORKSHOP_ROOT/$t" ] || continue
    find "$WORKSHOP_ROOT/$t" -maxdepth 1 -type d -name 'wave-*' 2>/dev/null
  done <<< "$WAVE_TREES" | awk -F/ '{ print $NF "\t" $0 }' | LC_ALL=C sort | cut -f2-
}

# ops_gate_running — true while a gate holds the tree. Every fixer refuses then;
# so does the window (a fixer writing under a running gate voids its stamp).
# GATE-DETECTOR 2026-10-01: only a gate working on THIS museum counts (cwd inside MUSEUM_ROOT, or MUSEUM_ROOT in its argv);
# a lane's scratch gate no longer holds the live window. scripts/fixers/gate_detect.py: exit 1 = none, anything else = running.
ops_gate_running() { python3 -I "$MUSEUM_ROOT/scripts/fixers/gate_detect.py" --root "$MUSEUM_ROOT" 'scripts/gate[.]sh|[n]pm run gate' >/dev/null 2>&1; [ $? -ne 1 ]; }
