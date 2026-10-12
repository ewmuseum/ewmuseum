#!/usr/bin/env bash
# CHAIN — commit exactly the stamped tree, publish it, push it, then open the
# gate-free window.
#
#     scripts/ops/chain.sh [label] [--dry-run] [--no-window] [--no-push] [--no-publish]
#
# Order is load-bearing and is the order the scratchpad chain used:
#
#   1. refuse without a green stamp (the stamp IS the authorisation to commit)
#   2. npm run worker:headers   — stamp-stats rewrites _headers every cycle and
#      r2-sync refuses a headers.json that is stale against it. That refusal was
#      silent from chain 133 to chain 145 and the live site went three days
#      stale; the regeneration is a step of the chain now, not a thing someone
#      remembers.
#   3. git add -A && git commit -F ops/commit-stub.txt
#   4. r2-sync  (publish)   -> ops/DEPLOY-FAILED on failure
#   4b. the text-search index: scripts/ops/ai-search-sync.py, launched DETACHED
#      after a publish (rc 0 or 5); never waited on, its result never read
#   5. git push             -> ops/PUSH-FAILED  on failure
#   6. the gate-free window (scripts/ops/window.sh)
#
# Every stage is &&-guarded where a failure must stop the next stage; the commit
# is guarded by the stamp check with && and never with ';' (invariant 12).
#
# --dry-run prints the plan — the stub, the waves it would apply, the publish
# and push it would run — and changes nothing at all.
set -u
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

DRY=0 WINDOW=1 PUSH=1 PUBLISH=1 LABEL=""
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --no-window) WINDOW=0 ;;
    --no-push) PUSH=0 ;;
    --no-publish) PUBLISH=0 ;;
    --*) echo "unknown flag $a" >&2; exit 2 ;;
    *) LABEL="$a" ;;
  esac
done
[ -n "$LABEL" ] || LABEL="$(date -u +%Y%m%d-%H%M%S)"

STUB="$MUSEUM_ROOT/ops/commit-stub.txt"
STAMP="$(cd "$MUSEUM_ROOT" && git rev-parse --git-dir)/gate-ok"
cd "$MUSEUM_ROOT" || exit 1

# ---- the plan ------------------------------------------------------------
if [ "$DRY" -eq 1 ]; then
  echo "== chain $LABEL — DRY RUN, nothing will be changed =="
  echo
  echo "museum root   : $MUSEUM_ROOT"
  echo "workshop root : $WORKSHOP_ROOT $([ -d "$WORKSHOP_ROOT" ] || echo '(absent — wave steps would no-op)')"
  echo "scratch root  : $SCRATCH_ROOT"
  echo "green stamp   : $([ -f "$STAMP" ] && cat "$STAMP" || echo 'NONE — the real chain would refuse here')"
  echo
  echo "-- commit stub ($STUB):"
  sed 's/^/   /' "$STUB"
  echo
  echo "-- tree: $(git status --porcelain | wc -l) path(s) would be staged by 'git add -A'"
  echo
  echo "-- would run: npm run worker:headers"
  echo "-- would run: git add -A && git commit -F ops/commit-stub.txt"
  [ "$PUBLISH" -eq 1 ] && echo "-- would run: node scripts/r2-sync.mjs --budget ${R2_SYNC_BUDGET:-35m}   (publish, bounded at ${R2_SYNC_TIMEOUT:-45m}; failure or partial -> ops/DEPLOY-FAILED)"
  [ "$PUBLISH" -eq 1 ] && [ -f "$OPS_DIR/ai-search-sync.py" ] && echo "-- would launch, detached and never waited on: python3 scripts/ops/ai-search-sync.py --label $LABEL   (the text-search index; only after an r2-sync rc of 0 or 5)"
  [ "$PUSH" -eq 1 ] && echo "-- would run: git push origin $(git branch --show-current)   (failure -> ops/PUSH-FAILED)"
  echo
  if [ "$WINDOW" -eq 1 ]; then
    echo "-- would then open the gate-free window (scripts/ops/window.sh):"
    ready=0 applied=0
    while IFS= read -r w; do
      [ -n "$w" ] || continue
      if [ -f "$w/READY" ] && [ ! -f "$w/APPLIED" ]; then
        echo "     apply  $(basename "$w")"; ready=$((ready + 1))
      elif [ -f "$w/APPLIED" ]; then
        applied=$((applied + 1))
      fi
    done <<< "$(ops_wave_dirs)"
    echo "     $ready wave(s) READY and unapplied, $applied already applied"
    echo "     then: promotions-append, shard paths, frontier rows, the standing window fixers"
  fi
  echo
  echo "== end of plan (no commit, no publish, no push) =="
  exit 0
fi

# ---- 1. the stamp is the authorisation -----------------------------------
[ -f "$STAMP" ] || { ops_say "chain $LABEL: NO GREEN STAMP — refusing to commit"; exit 2; }

# ---- 2. worker headers ---------------------------------------------------
npm run worker:headers > "$SCRATCH_ROOT/worker-headers$LABEL.log" 2>&1 \
  || ops_say "chain $LABEL: worker:headers FAILED — r2-sync will refuse a stale headers.json"

# ---- 3. the commit -------------------------------------------------------
# LC_ALL=C: the gate ran under C and the pre-commit digest sorts the file list,
# so the commit must share the locale or the stamp can never match.
export LC_ALL=C
git add -A
# 2026-09-29: an empty tree diff is not a failure (cycles 212-215 stalled on it and skipped their windows)
if git diff --cached --quiet; then
  ops_say "chain $LABEL: nothing to commit (the tree already matches HEAD) — continuing to the window"
else
  git commit -q -F "$STUB" || { ops_say "chain $LABEL: COMMIT FAILED"; exit 3; }
  ops_say "chain $LABEL: committed $(git log --oneline -1)"
fi

# ---- 4. publish ----------------------------------------------------------
if [ "$PUBLISH" -eq 1 ]; then
  # Bounded (2026-09-29, cycle 216: a stalled upload held the window for hours).
  # GNU timeout signals its own process group, so node AND its wrangler children
  # end. A failed or timed-out publish marks DEPLOY-FAILED and the chain
  # continues: the commit stands and the next chain's r2-sync diffs against the
  # bucket's manifest.
  # Checkpointed (2026-10-04, chain 248: a 91,198-put diff timed out at put 5,800
  # with nothing recorded, so every later chain redid the same diff). r2-sync's
  # --budget, set BELOW the timeout, stops new puts, drains, writes a checkpoint
  # manifest (old manifest + confirmed puts) and exits 5; the next chain carries on
  # from it. The 10 min between budget and timeout cover the drain and the final
  # checkpoint write; a hard timeout still loses at most the last checkpoint
  # interval (500 puts or 2 min), never the run.
  # hook c219 (D495): a ONE-SHOT yes for r2-sync's >10% prune guard. The flag file is consumed (removed) before the run,
  # so it applies to exactly one chain. Create it only on the Janitor's word.
  R2_YES=""; _yes_flag="${WORKSHOP_ROOT:-$(dirname "$MUSEUM_ROOT")/archive}/ops-scratch/R2-SYNC-YES-ONCE"   # hook c289: derived from the museum root
  if [ -e "$_yes_flag" ]; then rm -f "$_yes_flag" && R2_YES="--yes" && ops_say "chain $LABEL: r2-sync runs once with --yes (D495 flag consumed)"; fi
  timeout -k 120 "${R2_SYNC_TIMEOUT:-45m}" node scripts/r2-sync.mjs --budget "${R2_SYNC_BUDGET:-35m}" $R2_YES > "$SCRATCH_ROOT/r2-sync$LABEL.log" 2>&1
  rrc=$?
  # hook c233 (D495): the yes is for one COMPLETED run. A partial or timed-out run deletes nothing (deletes follow the
  # puts), so the flag is written back and the next chain carries the same yes.
  if [ -n "$R2_YES" ] && { [ "$rrc" -eq 5 ] || [ "$rrc" -eq 124 ] || [ "$rrc" -eq 137 ]; }; then
    date -u +%FT%TZ > "$_yes_flag" && ops_say "chain $LABEL: r2-sync ended partial (rc=$rrc); the D495 yes carries to the next chain"
  fi
  ops_say "chain $LABEL: r2-sync rc=$rrc :: $(grep -E 'r2-sync: (done|PARTIAL)' "$SCRATCH_ROOT/r2-sync$LABEL.log" | tail -1)"
  if [ "$rrc" -ne 0 ]; then
    case "$rrc" in
      3) why="the bucket's manifest could not be read (retried) — nothing uploaded; the next chain retries" ;;
      4) why="the bucket reports NO manifest — a full upload needs a deliberate 'r2-sync --first-run'" ;;
      5) why="PARTIAL — the ${R2_SYNC_BUDGET:-35m} budget ran out; progress kept in the checkpointed manifest, the next chain carries on: $(grep -oE '[0-9]+ put\(s\) and [0-9]+ delete\(s\) remain' "$SCRATCH_ROOT/r2-sync$LABEL.log" | tail -1)" ;;
      124|137) why="timed out after ${R2_SYNC_TIMEOUT:-45m} — partial; the manifest holds the last checkpoint, the next chain carries on from it" ;;
      *) why="see $SCRATCH_ROOT/r2-sync$LABEL.log" ;;
    esac
    printf '%s rc=%s chain=%s %s\n' "$(date -u +%FT%TZ)" "$rrc" "$LABEL" "$why" > "$MUSEUM_ROOT/ops/DEPLOY-FAILED"
    if [ "$rrc" -eq 5 ]; then st="DEPLOY PARTIAL"; else st="DEPLOY FAILED"; fi
    ops_say "chain $LABEL: $st rc=$rrc ($why) — $(tail -2 "$SCRATCH_ROOT/r2-sync$LABEL.log" | tr '\n' ' ')"
  else
    rm -f "$MUSEUM_ROOT/ops/DEPLOY-FAILED"
  fi
fi

# ---- 4b. the text-search index (D294, hook c85) ---------------------------
# DETACHED: scripts/ops/ai-search-sync.py brings the AI Search instance
# museum-search in step with what r2-sync has just published (deletions first,
# then the changed texts). The chain never waits for it and never reads its
# exit, so a failed or slow index update cannot hold up or fail the commit,
# the publish, the push or the window. It marks
# $WORKSHOP_ROOT/net/ai-search/SYNC-FAILED when it fails; the next chain's run
# recomputes the diff. Not launched after a failed publish.
if [ "$PUBLISH" -eq 1 ] && [ -f "$OPS_DIR/ai-search-sync.py" ]; then
  case "${rrc:-1}" in
    0|5)
      setsid nohup python3 "$OPS_DIR/ai-search-sync.py" --label "$LABEL" > "$SCRATCH_ROOT/ai-search-sync$LABEL.log" 2>&1 < /dev/null &
      ops_say "chain $LABEL: ai-search-sync launched, detached (pid $!; log ai-search-sync$LABEL.log)" ;;
    *) ops_say "chain $LABEL: ai-search-sync not launched (r2-sync rc=${rrc:-?})" ;;
  esac
fi

# ---- 5. push -------------------------------------------------------------
# hook c161 (2026-10-08): GitHub is the backup and mirror source, not the deploy path (r2-sync publishes), and an hourly push
# was spending the month's Actions minutes in eight days. Push at most once per 20 hours; commits stay local between pushes.
# A file PUSH-NOW in the scratch root forces a push on the next chain; both live in the scratch root, never in the museum tree.
LAST_PUSH_FILE="$SCRATCH_ROOT/last-push.epoch"
if [ "$PUSH" -eq 1 ] && [ ! -f "$SCRATCH_ROOT/PUSH-NOW" ] && [ -s "$LAST_PUSH_FILE" ] \
   && [ $(( $(date +%s) - $(cat "$LAST_PUSH_FILE" 2>/dev/null || echo 0) )) -lt 72000 ]; then
  ops_say "chain $LABEL: push deferred (pushes run at most once per 20 hours; last $(date -d @"$(cat "$LAST_PUSH_FILE")" '+%F %H:%M'))"
  PUSH=0
fi
if [ "$PUSH" -eq 1 ]; then
  BR="$(git branch --show-current)"
  git push -q origin "$BR" 2>> "$SCRATCH_ROOT/push$LABEL.log"
  prc=$?
  ops_say "chain $LABEL: push rc=$prc :: $(git rev-list --count "origin/$BR..$BR" 2>/dev/null) ahead"
  if [ "$prc" -ne 0 ]; then date > "$MUSEUM_ROOT/ops/PUSH-FAILED"; else rm -f "$MUSEUM_ROOT/ops/PUSH-FAILED" "$SCRATCH_ROOT/PUSH-NOW"; date +%s > "$LAST_PUSH_FILE"; fi
fi

ops_say "CHAIN $LABEL DONE"

# ---- 6. the gate-free window --------------------------------------------
if [ "$WINDOW" -eq 1 ]; then
  bash "$OPS_DIR/window.sh" "$LABEL"
  ops_rc_line WINDOW "$?" "$SCRATCH_ROOT/window$LABEL.log"
fi
