#!/usr/bin/env python3
"""fix-frontier-queue-year.py — standing preflight step (hook c146, 2026-10-08): keep `queue_year` and
`queue_year_basis` fresh on every row of data/frontier.json.

WHY IT IS STANDING, not a one-off wave (the Janitor 2026-09-12: "if we fix something once it needs to persist").
/frontier.html orders the accession queue by each row's EARLIEST ATTESTED year — one step per year, oldest first
(the Janitor 2026-10-08: "priority should be based on the earlier year we observed them"; "there's no real harm in
continuing to put every year at different priority numbers"; the law is the workshop's QUEUE-POLICY.md). The page
sorts in the browser and cannot run python, so the year is PRECOMPUTED onto the row. Every census pass, liveness
sweep, merge or frontier applier that adds a row or dates an old one therefore leaves the served order stale unless
the key is re-derived — which is this fixer, after the frontier appliers in ORDER.txt.

THE KEY LIVES IN ONE PLACE. The year and its basis come from the workshop's tools/year_key.py — the same function
that bands the workshop's cdx-ration-queue.tsv and picks the Common Crawl leg's targets. Nothing is reimplemented
here: a second implementation would be a second answer, and the page and the queue would drift apart. A clone with
NO workshop beside it (docs/PROCESS.md's own case) is a clean no-op: the committed values stand and this says so.

SHAPE. queue_year is an int, or the field is ABSENT — never null, which reds the validator (D149). queue_year_basis
is always present. Nothing else on any row is touched: not notes, not the frontier log, not evidence_count, not any
year field the row already carries (this fixer READS those). frontier.json is rewritten in its own indent, atomically,
only when a value actually changed, so a clean tree is a no-op and a run is idempotent. Refuses while a gate runs.
No flags, no dry run (2026-10-08: an applier's --dry wrote three live pages; this one only ever writes).
"""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from gate_detect import live_running as _live_running   # GATE-DETECTOR 2026-10-01: only this museum's processes count
import json, sys

TAG = "fix-frontier-queue-year"
if _live_running("scripts/gate[.]sh", _ROOT):
    sys.exit("REFUSED: a gate is running")

P = _os.path.join(_ROOT, "data", "frontier.json")
if not _os.path.exists(P):
    print(f"{TAG}: no data/frontier.json here; nothing to do")
    sys.exit(0)

# the workshop's one year key — the installed copy first, then the lane's staging dir it was installed from
_KEY_DIRS = [_os.path.join(_WORKSHOP, "tools"), _os.path.join(_WORKSHOP, "desk", "queue-by-year")]
_key_dir = next((d for d in _KEY_DIRS if _os.path.exists(_os.path.join(d, "year_key.py"))), None)
if _key_dir is None:
    print(f"{TAG}: no workshop year key beside this clone (tools/year_key.py); the committed queue_year values stand")
    sys.exit(0)
sys.path.insert(0, _key_dir)
import year_key as Y

raw = open(P, encoding="utf-8").read()
F = json.loads(raw)
rows = F.get("rows")
if not isinstance(rows, list):
    sys.exit(f"REFUSED: {P} is not an object with a \"rows\" array")


def indent_of(text):
    """The file's own indent (REGISTRY JSON INDENT: a wrong indent made a 356k-line diff). Default 1, as frontier.json is."""
    for i in (1, 2, 4):
        if json.dumps(json.loads(text), ensure_ascii=False, indent=i) + "\n" == text:
            return i
    return 1


ctx = Y.load_context(_ROOT)
changed = unknown = 0
for r in rows:
    if not isinstance(r, dict):
        continue
    y, b = Y.year_of_frontier(r, ctx)
    if y is None:
        unknown += 1
    cur_y, cur_b = r.get("queue_year"), r.get("queue_year_basis")
    if cur_y == y and cur_b == b:
        continue
    if y is None:
        r.pop("queue_year", None)       # absent, never null (D149)
    else:
        r["queue_year"] = y
    r["queue_year_basis"] = b
    changed += 1

if not changed:
    print(f"{TAG}: {len(rows)} frontier rows, all queue_year/queue_year_basis already current "
          f"({unknown} with no attested year)")
    sys.exit(0)

ind = indent_of(raw)
tmp = P + ".tmp"
with open(tmp, "w", encoding="utf-8") as fh:
    json.dump(F, fh, ensure_ascii=False, indent=ind)
    fh.write("\n")
_os.replace(tmp, P)
print(f"{TAG}: {changed} of {len(rows)} frontier rows re-keyed ({unknown} with no attested year); "
      f"written at indent {ind}")
