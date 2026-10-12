#!/usr/bin/env bash
# The canonical gate. THE ONLY sanctioned way to run the chain.
# On success, stamps this worktree's git dir with a content digest;
# the pre-commit hook refuses any commit whose content doesn't match
# a green stamp. See the workshop's GAVELS.md 2026-08-30 (gate guardrails).
set -uo pipefail
export PATH="$HOME/.local/opt/node/bin:$PATH"

GITDIR=$(git rev-parse --git-dir) || exit 1
STAMP="$GITDIR/gate-ok"
rm -f "$STAMP"   # any prior green is void the moment a new gate starts

# c55 gate-step (D297): each step's start, end, seconds and rc go to the gate log; the && chain and CODE are unchanged.
gate_step() { local t0; t0=$(date +%s); echo "$(date -u +%FT%TZ) gate-step $1 start"; npm run "$1"; local rc=$?; echo "$(date -u +%FT%TZ) gate-step $1 done rc=$rc secs=$(( $(date +%s) - t0 ))"; return $rc; }
# c136 gate-step (D448): data/find-record-index.json, the name index behind GET /api/find-record, is rebuilt from the registry and the
# rendered pages on every gate (after stats, before privacy and check), so it cannot go stale; its own self-checks fail the gate.
gate_step build:data && gate_step refresh:links && gate_step chrome && gate_step stats && gate_step find-record:index && gate_step privacy && gate_step check
CODE=$?
# WARN-ONLY credit-context privacy scan (scripts/privacy-credit-warn.mjs,
# 2026-09-03). Never allowed to redden the gate: `|| true` swallows its exit
# code, and CODE (captured above) already holds the real chain result, so
# this line runs but cannot flip the verdict either way.
# c55 gate-step (D297): the warn-only credit-warn scan now runs detached AFTER the green stamp (end of this file).
if [ $CODE -ne 0 ]; then
  echo "GATE-RED (exit $CODE) — no stamp written; commits are blocked." >&2
  exit $CODE
fi

# The regen pipeline's own generated pages (cross-reference.mjs's per-entity
# character/title/unit pages, in particular) routinely leave trailing
# whitespace on blank template lines. The shared pre-commit hook's
# `git diff --cached --check` rejects that on any newly-added file, so a
# fresh entity's first commit can never pass otherwise. Strip trailing
# whitespace, after the regen and before the stamp, on ONLY the HTML files
# this commit actually touches (new + modified vs. HEAD) — never the whole
# site's stable pre-existing pages, which would turn every gate run into an
# unrelated whitespace diff across thousands of untouched files.
{
  git diff --name-only -z -- '*.html'
  git diff --cached --name-only -z -- '*.html'
  git ls-files --others --exclude-standard -z -- '*.html'
} | tr '\0' '\n' | grep -v '^\.claude/' | sort -u \
  | while IFS= read -r f; do [ -f "$f" ] && sed -i 's/[ \t]*$//' "$f"; done

# digest all tracked + untracked-unignored content, order-stable
DIGEST=$( { git ls-files -co --exclude-standard -z | sort -z | xargs -0 sha1sum; } | sha1sum | cut -d' ' -f1 )
printf '%s\n' "$DIGEST" > "$STAMP"
echo "GATE-GREEN — stamp $DIGEST"
# c55 gate-step (D297): the WARN-ONLY credit-context scan, off the critical path. It never set the verdict, writes only
# the workshop's credit-warn-latest.tsv (read by nothing), and took ~24 min a gate. One at a time; log in the workshop.
CW_LOG_DIR="$(cd "$(dirname "$0")/../.." && pwd)/archive/ops-scratch"
if [ -d "$CW_LOG_DIR" ]; then
  python3 -I scripts/fixers/gate_detect.py --root "$PWD" 'privacy-credit-warn[.]mjs' >/dev/null 2>&1
  if [ $? -eq 1 ]; then
    nohup npm run privacy:credit-warn > "$CW_LOG_DIR/credit-warn-$(date -u +%Y%m%dT%H%MZ).log" 2>&1 < /dev/null &
    echo "gate: credit-warn started detached (pid $!; log in $CW_LOG_DIR)"
  else echo "gate: credit-warn already running; not started again"; fi
fi
