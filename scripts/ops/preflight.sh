#!/usr/bin/env bash
# PREFLIGHT — the standing fixers, then the regen chain, then the registry check.
#
#     scripts/ops/preflight.sh [label] [extra-fixer.py ...]
#     scripts/ops/preflight.sh --fixers-only        (npm run fixers)
#
# Runs, in this order:
#   1. every fixer named in scripts/fixers/ORDER.txt, in that order
#   2. any extra one-off fixers passed on the command line
#   3. build:data -> stats -> worker:headers -> the data validators (the gate runs the
#      full invariant-2 chain and check; PREFLIGHT-DEDUPE 2026-10-02)
#
# --fixers-only stops after step 1: the standing fixers and nothing else.
#
# Writes $SCRATCH_ROOT/preflight<label>.log and records PREFLIGHT_RC as its own
# line in that log (invariant 12: the real exit code, captured immediately after
# the command and never after a pipe). Exit 0 means the log is CLEAN — no ✗, no
# traceback — which is the only state from which the gate should be launched.
#
# Preflight is deliberately allowed to change the tree; the gate that follows is
# not. Nothing here commits, publishes or pushes.
set -u
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

FIXERS_ONLY=0
if [ "${1:-}" = "--fixers-only" ]; then FIXERS_ONLY=1; shift; fi
LABEL="${1:-$(date -u +%Y%m%d-%H%M%S)}"
[ $# -gt 0 ] && shift
LOG="$SCRATCH_ROOT/preflight$LABEL.log"

ops_say "preflight $LABEL: museum=$MUSEUM_ROOT workshop=$WORKSHOP_ROOT"

# ---- 1. the standing fixers, in ORDER.txt order --------------------------
ran=0 missing=0
while IFS= read -r f; do
  case "$f" in ''|'#'*) continue ;; esac
  if [ -f "$FIXERS_DIR/$f" ]; then
    # c58 fixer-time (D308): wall seconds and rc per fixer, appended to the workshop timing file (never fatal).
    c58_t0=$(date +%s); python3 -I "$FIXERS_DIR/$f"; c58_rc=$?
    [ $c58_rc -eq 0 ] || ops_say "fixer $f exited non-zero (continuing — fixers are advisory)"
    printf '%s\t%s\t%s\t%s\n' "$LABEL" "$f" "$(( $(date +%s) - c58_t0 ))" "$c58_rc" >> "$WORKSHOP_ROOT/ops-scratch/preflight-fixer-times.tsv" 2>/dev/null || true
    ran=$((ran + 1))
  else
    ops_say "MISSING fixer $f"
    missing=$((missing + 1))
  fi
done < "$FIXERS_DIR/ORDER.txt"
ops_say "preflight $LABEL: $ran standing fixer(s) run, $missing missing"
[ "$FIXERS_ONLY" -eq 1 ] && { ops_say "--fixers-only: stopping before the regen chain"; exit 0; }

# ---- 2. one-off fixers the caller passed ---------------------------------
for f in "$@"; do
  [ -f "$f" ] || { ops_say "MISSING one-off fixer $f"; continue; }
  python3 -I "$f" || ops_say "one-off fixer $f exited non-zero (continuing)"
done

# ---- 3. the data check (PREFLIGHT-DEDUPE 2026-10-02; GAVELS 2026-10-02 DIRECTION, D225) ----
# The gate (scripts/gate.sh) runs the whole regen chain and the full check (invariant 2, unchanged). This step no
# longer repeats the page regeneration the gate repeats (refresh:links, chrome) nor validate.mjs. It runs:
#   build:data      the shard monoliths (registry-validate hard-fails on a stale one)
#   stats           _headers (clacks, robots), index doors, curation.html's version line. worker:headers bakes
#                   _headers, so stats must come first; the gate's own stats rewrites the same bytes.
#   worker:headers  the gate never runs it
#   then the three data validators, each to the end so every red shows at once: registry-validate,
#   validate-documents, validate-provenance-notes. All of the last 20 cycles' preflight reds came from these.
# registry-validate also polices what refresh:links writes (pages, registers, data/*-index.json, affiliations
# rendered, data-entity links). Before a refresh those lines are stale by construction after any window that mints,
# retires or renames, so they are DEFERRED: rewritten from "✗" to "↷ deferred to gate:" in the log and never red
# here. The gate's check judges them after its own refresh, and its red handler (cycle.sh step 3) takes a red.
# &&-guarded where order matters (invariant 12): a failed regen step stops before any validator.
cd "$MUSEUM_ROOT" || exit 1
{
  npm run build:data \
    && npm run stats \
    && npm run worker:headers
} > "$LOG" 2>&1
RC=$?
if [ "$RC" -eq 0 ]; then
  DEFER='run `npm run refresh(:links)?`|entity link references unknown id'
  RVOUT="$LOG.registry-validate"
  node scripts/registry-validate.mjs > "$RVOUT" 2>&1
  rv=$?
  sed -E "/^  ✗ .*($DEFER)/s/^  ✗ /  ↷ deferred to gate: /" "$RVOUT" >> "$LOG"
  hard=$(grep -c '^  ✗ ' "$LOG")
  deferred=$(grep -c '^  ↷ deferred to gate: ' "$LOG")
  rm -f "$RVOUT"
  # rv≠0 with every ✗ deferred is clean here; rv≠0 with no ✗ line at all is a crash and stays red.
  if [ "$rv" -ne 0 ] && { [ "$hard" -ne 0 ] || [ "$deferred" -eq 0 ]; }; then RC=$rv; fi
  echo "preflight data check: registry-validate rc=$rv: $hard hard error line(s), $deferred deferred to the gate" >> "$LOG"
  node scripts/validate-documents.mjs >> "$LOG" 2>&1 || RC=$?
  node scripts/validate-provenance-notes.mjs data/promotions.json . >> "$LOG" 2>&1 || RC=$?
fi
# c66 DEPLOY ALLOWLIST (D308; CYCLE-TIME-AUDIT target 3): gate 248 run 1 went red on the top-level allowlist only after
# its ~60-minute refresh. This is the gate's own check (validate.mjs's TOP-LEVEL ALLOWLIST block: the same git file
# list, the same .claude/ exclusion, the same isAllowedTopLevel() from scripts/deploy-allowlist.mjs, one line per
# offending top-level segment), run here so the red comes in seconds. It runs even after a failed regen step, so every
# red shows at once; a ✗ line in the log makes this preflight NOT CLEAN by the grep below. validate.mjs is unchanged.
c66_t0=$(date +%s)
node --input-type=module -e '
import { execSync } from "node:child_process";
import { isAllowedTopLevel } from "./scripts/deploy-allowlist.mjs";
let files;
try {
  files = execSync("git ls-files -co --exclude-standard -z", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter((f) => f && !f.startsWith(".claude/"));
} catch (e) { console.log("  ✗ deploy allowlist: git ls-files failed (" + String(e.message).split("\n")[0] + ")"); process.exit(1); }
const bad = new Map();
for (const rel of files) { const n = rel.split("/"); if (!isAllowedTopLevel(n[0], n.length > 1) && !bad.has(n[0])) bad.set(n[0], rel); }
for (const [seg, ex] of bad) console.log(`  ✗ deploy allowlist: top-level path "${seg}" (e.g. ${ex}) is not in scripts/deploy-allowlist.mjs; the gate (validate.mjs) would red on it`);
console.log(`preflight deploy-allowlist check: ${files.length} path(s), ${bad.size} top-level path(s) outside the allowlist`);
process.exit(bad.size ? 1 : 0);
' >> "$LOG" 2>&1 || { c66_rc=$?; [ "$RC" -ne 0 ] || RC=$c66_rc; }
echo "preflight-step deploy-allowlist secs=$(( $(date +%s) - c66_t0 ))" >> "$LOG"
ops_rc_line PREFLIGHT "$RC" "$LOG"

# A preflight is "clean" when its log carries no failure marker. The grep is the
# same one the scratchpad cycle used: ✗ from the validators, a Python traceback
# from a fixer, a TypeError from a regen script. 'stamped'/'recently-added' are
# ordinary chatty output from the stampers and never mean failure.
# 2026-09-22 (preflight 165): validators that report "N problem(s)" (validate-provenance-notes) count too, or a red
# preflight reports "0 failure line(s)".
n=$(grep -E '✗|Traceback|TypeError|[1-9][0-9]* problem\(s\)' "$LOG" | grep -vc 'stamped\|recently-added')
if [ "$RC" -ne 0 ] || [ "$n" -ne 0 ]; then
  ops_say "preflight $LABEL NOT CLEAN (PREFLIGHT_RC=$RC, $n failure line(s)) — see $LOG"
  grep -E '✗|Traceback|TypeError|[1-9][0-9]* problem\(s\)' "$LOG" | grep -v 'stamped\|recently-added' | head -20
  exit 1
fi
# Commit hygiene BEFORE the gate: the pre-commit hook refuses trailing whitespace
# and conflict markers in anything staged, so a stray space in a ported script
# must fail here in seconds, not after a green 25-minute gate (cycle 148, 2026-09-19).
ws=$( (cd "$MUSEUM_ROOT" && { git diff --check; git ls-files --others --exclude-standard -z | xargs -0 -n1 -I{} git diff --check --no-index /dev/null {}; } 2>/dev/null) | head -20)
if [ -n "$ws" ]; then
  ops_say "preflight $LABEL NOT CLEAN — whitespace/conflict-marker errors the commit hook would refuse:"
  printf '%s\n' "$ws"
  exit 1
fi
ops_say "preflight $LABEL CLEAN (PREFLIGHT_RC=0) — safe to gate"
