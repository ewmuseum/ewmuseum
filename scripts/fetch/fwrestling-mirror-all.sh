#!/bin/bash
. "$(dirname "${BASH_SOURCE[0]}")/_fetchenv.sh"
# Mirror every ALIVE target from the fwrestling liveness TSV, one host at a time (one polite stream), resumable.
# Usage: fwrestling-mirror-all.sh [liveness.tsv] [max-pages-per-target]   — log: mirror-<date>.log in the census's workshop folder
A="$WORKSHOP_ROOT"; T="$FETCH_DIR"
TSV=${1:-$(ls -t $A/fwrestling-census/liveness-*.tsv | head -1)}; MAXP=${2:-4000}
LOG=$A/fwrestling-census/mirror-$(date +%F).log; DONE=$A/fwrestling-census/mirror-done.tsv; touch $DONE; fails=0
awk -F'\t' 'NR>1 && $2=="alive" {print $1}' "$TSV" | while read -r url; do
  grep -qxF "$url" $DONE && continue
  echo "== $(date '+%F %T') mirror $url" >> $LOG
  python3 -I "$FETCH_DIR/site-mirror.py" "$url" --max-pages $MAXP --sleep 3 --key fwrestling.com >> $LOG 2>&1
  rc=$?; echo "== rc=$rc $url" >> $LOG
  if grep -q 'fusebox tripped' <(tail -3 $LOG); then echo "== fusebox tripped — stopping run $(date)" >> $LOG; exit 3; fi
  if [ $rc -ne 0 ]; then fails=$((fails+1)); echo "== NOT marked done (rc=$rc); consecutive failures $fails" >> $LOG; [ $fails -ge 3 ] && { echo "== 3 consecutive failures — stopping run $(date)" >> $LOG; exit 4; }; continue; fi
  fails=0; echo "$url" >> $DONE
done
python3 "$FETCH_DIR/park-live-duplicates.py" >> $LOG 2>&1   # park IA rows the live mirror has now covered (the Janitor 2026-09-15)
echo "== run complete $(date '+%F %T')" >> $LOG
