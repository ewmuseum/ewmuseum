#!/bin/bash
. "$(dirname "${BASH_SOURCE[0]}")/_fetchenv.sh"
# IA TRICKLE MODE (the Janitor agreed 2026-09-10 17:20; resume rule 18:05): bursts of ten fetch.py requests 4 s apart, then a
# v2 (2026-09-15): a leg counts as EMPTY only when it made no attempts while the breaker was CLOSED — a tripped breaker made every leg look empty and ended the night after one burst.
# five-minute rest, 20:30 → 04:30 PT, through the fusebox. THE FIRST-REQUEST WALL: after any 429 the fusebox cool-off runs its
# ladder step; when it lifts we do NOT resume with a burst — we send ONE probe request. 200 → bursts resume; 429 → the ladder
# steps up on its own and we wait again. The night ends only when the ladder's 4-hour step would run past the window close.
cd "$WORKSHOP_ROOT/fwrestling-census" || exit 2
LOG=ia-trickle.log; START=${TRICKLE_START:-$(date -d "today 20:30" +%s)}; END=${TRICKLE_END:-$(date -d "tomorrow 04:30" +%s)}; trips=0; bursts=0; probes=0; rows_before=$(wc -l < manifest.tsv)
tripped(){ python3 "$FETCH_DIR/politeness.py" status | grep -q "web.archive.org.*TRIPPED"; }
echo "$(date '+%F %T') TRICKLE armed: window $(date -d @$START '+%H:%M') → $(date -d @$END '+%H:%M') PT; burst 10 @ 4 s, rest 300 s; single-probe resume after any trip" >> $LOG
while [ "$(date +%s)" -lt "$START" ]; do sleep 60; done
[ -f NIGHT-OFF-$(date +%F) ] && { echo "$(date '+%F %T') NIGHT-OFF marker present — not starting" >> $LOG; exit 0; }
echo "$(date '+%F %T') TRICKLE start" >> $LOG
resume_probe=0
while [ "$(date +%s)" -lt "$END" ]; do
  if tripped; then
    trips=$((trips+1)); echo "$(date '+%F %T') fusebox tripped (trip $trips tonight) — waiting out the ladder step" >> $LOG
    while tripped; do sleep 120; [ "$(date +%s)" -ge "$END" ] && break; done
    [ "$(date +%s)" -ge "$END" ] && break
    resume_probe=1; continue
  fi
  pgrep -f "ia-probe-map" >/dev/null && sleep 5
  if [ $resume_probe -eq 1 ]; then
    probes=$((probes+1)); echo "$(date '+%F %T') resume probe #$probes: one request" >> $LOG
    python3 "$FETCH_DIR/fwrestling-census-fetch.py" --limit 1 --max-seconds 30 >> $LOG 2>&1; prc=$?
    if [ $prc -ne 0 ] || tripped; then echo "$(date '+%F %T') resume probe walled — ladder steps up, waiting" >> $LOG; continue; fi
    echo "$(date '+%F %T') resume probe clean — bursts resume" >> $LOG; resume_probe=0; sleep 60; continue
  fi
  # PRIORITY ORDER (the Janitor 2026-09-08: NCCW → fwrestling tier d → memorial leads → oldest first; tier e last): each burst
  # serves the first leg that still has rows — url-walk priority 0 (the NCCW captures), then the census tiers a+d, then
  # the url-walk priorities 1-3 (unmatched fed sites by era, memorial links), then census tier e (forum chatter, member pages).
  rc=0; served=0; budget=10
  # 2026-09-14 coordinator: a burst carries its unused budget into the next leg (a leg that attempts one dead capture
  # no longer ends the burst); a leg whose attempts all failed hands the rest of the budget on too.
  for leg in "uw:0" "cen:a,d" "uw:1,2,3" "cen:e"; do
    kind=${leg%%:*}; sel=${leg#*:}
    if [ "$kind" = uw ]; then out=$( python3 "$FETCH_DIR/url-walk-fetch.py" --priorities "$sel" --limit $budget --max-seconds 60 2>&1 ); else out=$( python3 "$FETCH_DIR/fwrestling-census-fetch.py" --tiers "$sel" --limit $budget --max-seconds 60 2>&1 ); fi
    rc=$?; echo "$out" >> $LOG
    att=$(echo "$out" | grep -o "attempted=[0-9]*" | tail -1 | cut -d= -f2); okn=$(echo "$out" | grep -o " ok=[0-9]*" | tail -1 | cut -d= -f2)
    [ "${att:-0}" -gt 0 ] && { served=1; echo "$(date '+%F %T') burst leg $leg attempted=$att ok=${okn:-0} rc=$rc" >> $LOG; }
    [ $rc -ne 0 ] && break
    tripped && break
    budget=$((budget - ${okn:-0})); [ $budget -le 0 ] && break
  done
  bursts=$((bursts+1))
  [ $served -eq 0 ] && [ $rc -eq 0 ] && ! tripped && { echo "$(date '+%F %T') every leg empty — nothing left to fetch tonight" >> $LOG; break; }
  if [ $rc -ne 0 ] || tripped; then trips=$((trips+1)); echo "$(date '+%F %T') burst $bursts hit a wall (rc=$rc, trip $trips tonight) — waiting out the ladder step, then a single probe" >> $LOG; while tripped; do sleep 120; [ "$(date +%s)" -ge "$END" ] && break; done; resume_probe=1; continue; fi
  [ $((bursts % 12)) -eq 0 ] && echo "$(date '+%F %T') bursts $bursts | manifest +$(( $(wc -l < manifest.tsv) - rows_before ))" >> $LOG
  sleep 300
done
echo "$(date '+%F %T') TRICKLE end: bursts $bursts | resume probes $probes | trips $trips | manifest +$(( $(wc -l < manifest.tsv) - rows_before ))" >> $LOG
