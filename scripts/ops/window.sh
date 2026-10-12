#!/usr/bin/env bash
# THE GATE-FREE WINDOW — everything that edits the tree between one green gate's
# commit and the next gate.
#
#     scripts/ops/window.sh [label]
#
# Two halves:
#   A. land what the lanes filed — every READY, unapplied wave delta under the
#      configured wave trees, plus the per-kind appliers those deltas carry;
#   B. the STANDING WINDOW FIXERS — the one durable list (the Janitor 2026-09-12:
#      "if we fix something once it needs to persist"). Every fixer here is
#      idempotent. Adding a standing fix is one line in this file.
#
# Wave trees come from WAVE_TREES in ops/config.env, iterated by ops_wave_dirs.
# That is the fix for a bug this window had three times: the old cycle scripts
# enumerated scratch years literally in eight derived copies, so a new walk year
# (scratch-1996, 2026-09-14) left thirteen READY waves named in a commit and
# never applied. One list, one place, every tree.
#
# A missing WORKSHOP_ROOT is not an error: every wave step simply finds nothing,
# and half B still runs. That is what lets a fresh clone with no local
# collection run the cycle.
#
# Refuses outright while a gate is running — a fixer writing under a live gate
# voids its stamp.
set -u
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

LABEL="${1:-$(date -u +%Y%m%d-%H%M%S)}"
LOG="$SCRATCH_ROOT/window$LABEL.log"
exec > >(tee -a "$LOG") 2>&1

if ops_gate_running; then
  ops_say "window $LABEL: a gate is running — REFUSED"
  exit 0
fi

cd "$MUSEUM_ROOT" || exit 1
ops_say "== window $LABEL =="

# c66 window-step (D308): one "window-step <name> <seconds>" line per A/B step, the shape of the gate's c55 gate-step
# lines, so the whole window is measured (the tail after A2 had no timing at all). Never fatal, changes no step.
ws_t0() { WS_T0=$(date +%s); }
ws_done() { ops_say "window-step $1 $(( $(date +%s) - WS_T0 ))"; }
WS_START=$(date +%s)

fx() {                       # run a standing fixer by name, never fatal
  local f="$1"; shift; local t0; t0=$(date +%s)
  if [ -f "$FIXERS_DIR/$f" ]; then
    python3 -I "$FIXERS_DIR/$f" "$@" 2>&1 | tail -2
  else
    echo "MISSING fixer $f"
  fi
  ops_say "window-step B:$f $(( $(date +%s) - t0 ))"
}
ready_or_applied() { [ -f "$1/READY" ] || [ -f "$1/APPLIED" ]; }

ws_t0
WAVES="$(ops_wave_dirs)"
# 2026-09-21 (window 164): READY is read ONCE, here. A READY written while the window ran (packet 87's waiter, WOW)
# skipped A2 (pages + APPLIED + privacy fold) but was taken by A3 (registry rows, documents, shards), leaving 73
# document rows pointing at pages not yet copied. The window lands exactly the waves that were READY or APPLIED
# when it started; a later READY waits for the next window whole.
WAVES="$(while IFS= read -r W; do [ -n "$W" ] && ready_or_applied "$W" && printf '%s\n' "$W"; done <<< "$WAVES")"
ops_say "window $LABEL: $(printf '%s\n' "$WAVES" | grep -c . ) wave dir(s) in scope"

# c66 WINDOW SCOPE (D308; CYCLE-TIME-AUDIT target 4). The A-loops used to walk every wave ever landed (2,018 dirs on
# 2026-10-05, 1,945 of them APPLIED, 1,521 over a week ago) and re-ran the marker-less appliers on all of them every
# window; on the long tail every one of those runs is a no-op or the same SKIP line. The A-loops now take only:
#   - every wave READY and not APPLIED (A2's own set, unchanged);
#   - every wave whose APPLIED or READY marker is younger than WINDOW_SCOPE_DAYS (default 3, never below 3: A4's own
#     three-day rule must stay a subset), or that carries a delta/data file younger than that (a late correction);
#   - CARRIED, whatever its age: every wave A3 would still find unfinished work in by its own markers: a marker-bearing
#     delta file with no marker (shard appends, registry/page corrections, affiliations, memorials, documents,
#     promotions, frontier, external figures, inductions), or a *-corrections-*/*-delete-* file whose apply-shard-paths
#     ledger (<file>.PATHS.APPLIED) is missing while it holds path rows, is not complete, or is older than the file's
#     bytes (sha256). Those are exactly the waves whose rows the old loop could still land, so they keep being retried.
# What is NOT carried past N days: the three collections appliers (A1) and *-retire.json, which keep no marker; on the
# long tail they print only "applied: 0 | skipped" lines today. A wave whose late correction must land re-READYs (or
# gains a new delta file), which brings it back into scope. WINDOW_SCOPE=all restores the old full walk for one window.
# A scope that fails for any reason falls back to the full set (never fewer waves than before by accident).
WAVES_ALL="$WAVES"
if [ "${WINDOW_SCOPE:-}" != all ] && [ -n "$WAVES" ]; then
  read -r -d '' C66_SCOPE_PY <<'PY'
import sys, os, re, json, time, hashlib
N = max(3.0, float(os.environ.get("WINDOW_SCOPE_DAYS") or 3)); cut = time.time() - N * 86400
KINDS = ("characters", "units", "titles", "reigns", "shows", "rps", "awards")
def recent(p):
    try: return os.stat(p).st_mtime > cut
    except OSError: return False
def path_row(r): return isinstance(r, dict) and r.get("field") and ("." in r["field"] or "[" in r["field"])
def ledger_open(f, op):          # apply-shard-paths' own ledger_read(), plus "a file it would still open"
    L = f + ".PATHS.APPLIED"
    if os.path.exists(L):
        try: d = json.load(open(L))
        except Exception: return "ledger unreadable"
        if not d.get("complete"): return "ledger incomplete"
        if d.get("sha256") and d["sha256"] != hashlib.sha256(open(f, "rb").read()).hexdigest(): return "edited since ledger"
        return None
    try: rows = json.load(open(f))
    except Exception: return None
    if not isinstance(rows, list): return None
    if op == "corrections": return "path rows, no ledger" if any(path_row(r) for r in rows) else None
    return "delete rows, no ledger" if any(isinstance(r, dict) and r.get("field") for r in rows) else None
def why(W):
    R, A = os.path.exists(W + "/READY"), os.path.exists(W + "/APPLIED")
    if R and not A: return "ready"
    if (A and recent(W + "/APPLIED")) or (R and recent(W + "/READY")): return "recent"
    D = W + "/delta/data"
    try: names = os.listdir(D)
    except OSError: return None
    s = set(names)
    for n in names:
        if ".APPLIED" in n or n.endswith((".tmp", ".PARTIAL", ".FOLDED")): continue
        if recent(D + "/" + n): return "recent"
        if not n.endswith(".json"): continue
        m = re.match(r"^([a-z]+)-append-.+[.]json$", n)
        if m and m.group(1) in KINDS and n + ".APPLIED" not in s: return "carried"
        if n in ("registry-corrections.json", "page-corrections.json") and n + ".APPLIED" not in s: return "carried"
        if re.match(r"^(affiliations-rows-|memorials-append|documents-append|promotions-append)", n) and n + ".APPLIED" not in s: return "carried"
        if n.startswith("essays-append") and n.endswith(".json") and n + ".APPLIED" not in s: return "carried"   # hook c108
        if (n in ("frontier-rows.json", "frontier-new-rows.json", "frontier-corrections.json") or n.startswith("enrich-frontier-")) and "FRONTIER.APPLIED" not in s: return "carried"
        if n == "frontier-queue-year.json" and "FRONTIER-QUEUE-YEAR.APPLIED" not in s: return "carried"   # hook c146
        if n.startswith("external-figures-") and "EXTERNAL-FIGURES.APPLIED" not in s: return "carried"
        if n.startswith("inductions-append") and "INDUCTIONS.APPLIED" not in s: return "carried"
        if n == "wing-merge.json" and n + ".APPLIED" not in s: return "carried"   # hook c104
        if n == "pages-withdraw.json" and n + ".APPLIED" not in s: return "carried"   # hook c248
        m = re.match(r"^[a-z]+-(corrections|delete)-.+[.]json$", n)
        if m and ledger_open(D + "/" + n, m.group(1)): return "carried"
    return None
c = {"ready": 0, "recent": 0, "carried": 0}; out = []
for W in sys.stdin.read().split("\n"):
    if not W: continue
    w = why(W)
    if w: c[w] += 1; out.append(W)
sys.stdout.write("".join(x + "\n" for x in out))
sys.stderr.write(f"ready-unapplied {c['ready']}, marker or delta file within {N:g} d {c['recent']}, carried (unfinished by their own markers) {c['carried']}\n")
PY
  C66_ERR="$SCRATCH_ROOT/window$LABEL-scope.err"
  if C66_SCOPED="$(printf '%s\n' "$WAVES" | python3 -I -c "$C66_SCOPE_PY" 2> "$C66_ERR")"; then
    WAVES="$C66_SCOPED"
    ops_say "window $LABEL: A-loops scoped to $(printf '%s\n' "$WAVES" | grep -c . ) of them: $(tail -1 "$C66_ERR")"
    rm -f "$C66_ERR"
  else
    ops_say "window $LABEL: scope FAILED ($(tail -1 "$C66_ERR")) — the A-loops walk all of them, as before"
  fi
fi
ws_done scope

# ==========================================================================
# A. LAND THE WAVES
# ==========================================================================

# --- A1. collection lots FIRST, so sources[].accession resolves for the rest
ws_t0
while IFS= read -r W; do
  [ -n "$W" ] || continue; ready_or_applied "$W" || continue
  [ -f "$W/delta/data/collections-rows.json" ] \
    && python3 -I "$FIXERS_DIR/apply-collections-rows.py" "$W" | grep -v 'appended: 0'
  [ -f "$W/delta/data/collections-append.json" ] \
    && python3 -I "$FIXERS_DIR/apply-collections-append.py" "$MUSEUM_ROOT" "$W" 2>/dev/null | grep -iv ' 0$'
  # (2026-09-27) lot corrections too: wave-SCCW-A's 0159 rewrite was stamped APPLIED and never reached collections.json.
  # Idempotent: acts only when the live value equals `old`, and skips a stale `old`.
  [ -f "$W/delta/data/collections-corrections.json" ] \
    && python3 -I "$FIXERS_DIR/apply-collections-corrections.py" "$MUSEUM_ROOT" "$W/delta/data/collections-corrections.json" | grep -v 'applied: 0 | skipped: \[\]'
done <<< "$WAVES"; true
ws_done A1-collections

# --- A2. the delta itself: pages + registry rows, once per wave
ws_t0
HELD_WAVES="|"   # 2026-09-22 (window 169): a wave A2 holds is held WHOLE — A3 skipped it too late, merging PCW-ROSTER-2's rows without its pages
while IFS= read -r W; do
  [ -n "$W" ] || continue
  [ -d "$W/delta" ] || continue
  [ -f "$W/APPLIED" ] && continue
  [ -f "$W/READY" ] || { echo "skip $(basename "$W"): no READY sentinel"; continue; }
  # 2026-09-22 (DZW): READY is judged at review time, and waves landing after it can change the answer (DZW's two
  # characters came to collide with MVW and GWC records landed since). Re-run land-check against the live museum
  # right before applying; a wave that is no longer clean is HELD — READY kept, nothing applied, its line carried.
  if ! python3 -I "$OPS_DIR/land-check.py" "$W" > "$SCRATCH_ROOT/window$LABEL-landcheck-$(basename "$W").log" 2>&1; then
    echo "HELD $(basename "$W"): land-check not clean at window time — $(grep -m1 'LAND-CHECK' "$SCRATCH_ROOT/window$LABEL-landcheck-$(basename "$W").log") (log: window$LABEL-landcheck-$(basename "$W").log)"
    HELD_WAVES="$HELD_WAVES$W|"
    continue
  fi
  echo "== applying $(basename "$W")"
  # 2026-09-20: the fold — the lane's allows/denies enter the main ledger the moment its wave is applied.
  # 2026-09-26 (window 190): an apply-delta REFUSAL left READY and A3 still landed the wave's rows — E5C-CSWA-1990's
  # 50 tenure corrections and its documents row went in without its page or its mints. A refused wave is HELD WHOLE.
  if python3 -I "$OPS_DIR/apply-delta.py" "$W"; then
    date > "$W/APPLIED" && python3 -I "$FIXERS_DIR/fold-privacy-fragment.py" "$W"
  else
    echo "HELD $(basename "$W"): apply-delta refused — nothing of it lands this window"
    HELD_WAVES="$HELD_WAVES$W|"
  fi
done <<< "$WAVES"; true
ws_done A2-delta

# --- A3. per-kind appliers each wave may carry, once per FILE (marker beside it)
ws_t0
while IFS= read -r W; do
  [ -n "$W" ] || continue; ready_or_applied "$W" || continue
  case "$HELD_WAVES" in *"|$W|"*) continue ;; esac   # held in A2: its rows wait for the window that lands its pages
  D="$W/delta/data"; [ -d "$D" ] || continue

  # shard row appends: <kind>-append-<wing>.json
  for f in "$D"/*-append-*.json; do
    [ -f "$f" ] || continue; [ -f "$f.APPLIED" ] && continue
    case "$(basename "$f")" in
      characters-append-*|units-append-*|titles-append-*|reigns-append-*|shows-append-*|rps-append-*|awards-append-*)
        python3 -I "$FIXERS_DIR/apply-shard-append.py" "$f" && date > "$f.APPLIED" ;;
    esac
  done

  # registry corrections
  c="$D/registry-corrections.json"
  if [ -f "$c" ] && [ ! -f "$c.APPLIED" ]; then
    python3 -I "$FIXERS_DIR/apply-corrections.py" "$c" && date > "$c.APPLIED"
  fi

  # affiliation edges
  for f in "$D"/affiliations-rows-*.json; do
    [ -f "$f" ] || continue; [ -f "$f.APPLIED" ] && continue
    python3 -I "$FIXERS_DIR/apply-affiliation-rows.py" "$f" && date > "$f.APPLIED"
  done

  # memorial register rows (2026-09-22: no applier existed — COORD-MEMORIAL-DORAN's memorial sat unapplied from 19 Sep)
  for f in "$D"/memorials-append*.json; do
    [ -f "$f" ] || continue; [ -f "$f.APPLIED" ] && continue
    python3 -I "$FIXERS_DIR/apply-memorials-append.py" "$f" && date > "$f.APPLIED"
  done

  # the Essays register (hook c108, 2026-10-07; CURATION.md v129, the Janitor's D142 + D169): outside, human-written
  # work, linked (live) or served (dead); refused whole on any bad row, never changes a row already on file
  for f in "$D"/essays-append*.json; do
    [ -f "$f" ] || continue; [ -f "$f.APPLIED" ] && continue
    python3 -I "$FIXERS_DIR/apply-essays-append.py" "$f" && date > "$f.APPLIED"
  done

  # frontier rows + enrichments
  if { [ -f "$D"/frontier-rows.json ] || [ -f "$D"/frontier-new-rows.json ] || [ -f "$D"/frontier-corrections.json ] || compgen -G "$D/enrich-frontier-*.json" >/dev/null; } && [ ! -f "$D/FRONTIER.APPLIED" ]; then  # 2026-09-27 J38c: one test per file (a multi-file ls failed if any was absent)
    python3 -I "$FIXERS_DIR/apply-frontier.py" "$D" && date > "$D/FRONTIER.APPLIED"
  fi

  # the frontier's queue-year sort key (hook c146, 2026-10-08): queue_year / queue_year_basis and NOTHING else — not
  # notes, not the frontier log, not evidence_count, which is why this is not apply-frontier.py's job (that applier
  # appends an evidence note per item, and this delta carries no evidence about any fed, only the key the served
  # /frontier.html sorts on). scripts/fixers/fix-frontier-queue-year.py keeps the fields fresh between waves.
  if [ -f "$D"/frontier-queue-year.json ] && [ ! -f "$D/FRONTIER-QUEUE-YEAR.APPLIED" ]; then
    python3 -I "$FIXERS_DIR/apply-frontier-queue-year.py" "$D" --write && date > "$D/FRONTIER-QUEUE-YEAR.APPLIED"
  fi

  # external figures
  if ls "$D"/external-figures-*.json >/dev/null 2>&1 && [ ! -f "$D/EXTERNAL-FIGURES.APPLIED" ]; then
    python3 -I "$FIXERS_DIR/apply-external-figures.py" "$MUSEUM_ROOT" "$W" && date > "$D/EXTERNAL-FIGURES.APPLIED"
  fi

  # hall-of-fame inductions
  if ls "$D"/inductions-append*.json >/dev/null 2>&1 && [ ! -f "$D/INDUCTIONS.APPLIED" ]; then
    python3 -I "$FIXERS_DIR/apply-inductions.py" "$MUSEUM_ROOT" "$W" && date > "$D/INDUCTIONS.APPLIED"
  fi

  # page corrections (byte-matched, unique-occurrence) + the doc class they imply
  f="$D/page-corrections.json"
  if [ -f "$f" ] && [ ! -f "$f.APPLIED" ]; then
    python3 -I "$FIXERS_DIR/apply-page-corrections.py" "$f" \
      && { python3 -I "$FIXERS_DIR/apply-docclass-to-registry.py" "$f"; date > "$f.APPLIED"; }
  fi

  # served-document rows (structured source block, the Janitor 2026-09-13)
  for f in "$D"/documents-append*.json; do   # 2026-09-26: the unsuffixed documents-append.json too (F1, preflight 186)
    [ -f "$f" ] || continue; [ -f "$f.APPLIED" ] && continue
    python3 -I "$FIXERS_DIR/apply-documents-append.py" "$f" && date > "$f.APPLIED"
  done

  # promotion rows
  for f in "$D"/promotions-append*.json; do
    [ -f "$f" ] || continue; [ -f "$f.APPLIED" ] && continue
    python3 -I "$FIXERS_DIR/apply-promotions-append.py" "$f" && date > "$f.APPLIED"
  done

  # indexed-path shard corrections, sub-element deletes, record retirements
  for f in "$D"/*-retire.json "$D"/*-delete-*.json "$D"/*-corrections-*.json; do
    [ -f "$f" ] || continue
    python3 -I "$FIXERS_DIR/apply-shard-paths.py" "$W" 2>&1 | tail -1
    break
  done

  # wing merges (hook c104, 2026-10-06; the Janitor's D413): one wing into another, AFTER the shard and path appliers above
  # (the wave's own tenure corrections land first: the applier moves only characters/units that already name the surviving
  # wing), before A4 and before any build. Refused whole on any problem (nothing written); stamped once landed.
  f="$D/wing-merge.json"
  if [ -f "$f" ] && [ ! -f "$f.APPLIED" ]; then
    python3 -I "$FIXERS_DIR/apply-wing-merge.py" "$W" && date > "$f.APPLIED"
  fi

  # page withdrawals (hook c248, 2026-10-10; GAVELS 2026-10-10, the IWA is living: a living promotion's own pages leave the
  # live site): AFTER the shard and path appliers (a wave's <kind>-retire rows for a withdrawn page's records land first) and
  # the wing merge, before A4 and before any build. The page is kept in the workshop's collect-never-serve/, its documents row
  # goes; refused whole on any problem (nothing written); stamped once landed.
  f="$D/pages-withdraw.json"
  if [ -f "$f" ] && [ ! -f "$f.APPLIED" ]; then
    python3 -I "$FIXERS_DIR/apply-pages-withdraw.py" "$W" && date > "$f.APPLIED"
  fi
done <<< "$WAVES"; true
ws_done A3-appliers

# --- A4. character corrections for waves touched in the last three days
ws_t0
while IFS= read -r W; do
  [ -n "$W" ] || continue
  case "$HELD_WAVES" in *"|$W|"*) continue ;; esac   # 2026-09-26: a held wave's corrections wait with it
  m=""; [ -f "$W/APPLIED" ] && m="$W/APPLIED"; [ -f "$W/READY" ] && m="$W/READY"
  [ -n "$m" ] || continue
  [ -n "$(find "$m" -mtime -3 2>/dev/null)" ] || continue
  ls "$W"/delta/data/*-corrections-*.json >/dev/null 2>&1 \
    && python3 -I "$FIXERS_DIR/apply-characters-corrections.py" "$W" 2>&1 | tail -1
done <<< "$WAVES"; true
ws_done A4-corrections

# ==========================================================================
# B. THE STANDING WINDOW FIXERS (the one durable list)
# ==========================================================================

# B1. shape guards (gate-facing)
fx preflight126-fixes.py        # appearances 'character'->'who'; string show dates; _unassigned refile
fx fix-stub-shows.py
fx fix-matches-shape.py
fx fix-end-how.py
fx fix-identity-unknown-ids.py
fx sort-reigns-by-date.py
fx strip-audit-claims.py
fx fix-empty-evidence.py
fx refile-unassigned.py

# B2. privacy guards
fx widen-persona-allows.py      # page/wing allows for record personas -> generated surfaces
fx scrub-registry-privacy.py
fx fix-visibility-gated.py
fx fix-gyeah-aka.py

# B3. frontier
fx add-frontier-rows.py                    # candidates waves file that no applier appends
fx fix-frontier-held-on-promotion.py       # rows a held wing's own claim names read 'held'

# B4. character merges (the Janitor 2026-09-10: an original is ONE record across
#     promotions, oldest survives) and the repairs that follow a merge
fx merge-batch.py --limit 80
fx repair-merge-prefix.py
fx repair-merge-prefix-2.py
fx repair-merge-prefix-3.py
# 2026-10-08: the merge pass above can leave a survivor's identity naming its retired partner (preflight 348 stopped on three);
# resolve them here, in the same window, not only at the next preflight.
fx fix-identity-unknown-ids.py
fx repoint-retired.py

# B5. document formatting (the Janitor 2026-09-08 / 09-12): reflow hard-wrapped
#     prose, then collapse <br>+newline, which doubled every wrapped line
#     under pre-wrap. The repo's own reflow runs always; the two workshop
#     passes run only where that workshop exists.
ws_t0
node scripts/reflow-period-docs.mjs --write --class prose 2>&1 | tail -1
ws_done B:reflow-period-docs.mjs
for extra in reflow-mixed-docs.mjs reflow-br-pass.mjs; do
  p="$WORKSHOP_ROOT/desk/doc-formatting-2026-09-08/$extra"
  ws_t0
  [ -f "$p" ] && node "$p" --write 2>&1 | tail -1
  ws_done "B:$extra"
done; true
fx fix-br-newline.py
fx fix-script-anchors.py        # inline <script> data must never be entity-linked

# B6. registry + page hygiene
fx gen-wing-index.py
fx fix-content-notice.py        # every served document carries the notice template
fx fix-nwwf-lot.py
fx stale-captions.py            # report only
fx harvest-served-links.py      # outbound links on held pages -> the fetch queues

ops_say "window-step total $(( $(date +%s) - WS_START ))"
ops_say "== window $LABEL done =="
