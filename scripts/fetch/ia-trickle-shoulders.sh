#!/bin/bash
. "$(dirname "${BASH_SOURCE[0]}")/_fetchenv.sh"
# Two quiet shoulders (the Janitor 2026-09-14, from the hour-of-day probe map): 20:30 → 02:00 and 04:30 → 08:00 PT.
# Runs the trickle twice in sequence with its window overridden; cwd must be the census's workshop folder ($FETCH_DIR).
T="$FETCH_DIR"
# Both windows are computed ONCE, at wrapper start (2026-09-17 fix: computing "tomorrow 04:30" when leg 2 launches — after midnight — pointed it a whole day late).
L1S=$(date -d "today 20:30" +%s); L1E=$(date -d "tomorrow 02:00" +%s); L2S=$(date -d "tomorrow 04:30" +%s); L2E=$(date -d "tomorrow 08:00" +%s)
TRICKLE_START=$L1S TRICKLE_END=$L1E bash "$FETCH_DIR/ia-trickle-v2.sh"
TRICKLE_START=$L2S TRICKLE_END=$L2E bash "$FETCH_DIR/ia-trickle-v2.sh"
