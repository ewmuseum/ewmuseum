#!/usr/bin/env python3
"""apply-frontier-queue-year.py — set queue_year and queue_year_basis on frontier rows. Nothing else.

  apply-frontier-queue-year.py <delta/data dir> [--write]

Why this is not apply-frontier.py: that applier (museum/scripts/fixers/apply-frontier.py) can only set a fixed list
of fields (status, url, founded_year, country, language, first_seen_in, last_checked, observed_year, check_cadence),
and every item it applies also appends to `notes`, writes a frontier-log section and bumps `evidence_count`. This
delta is not an enrichment: it carries no new evidence about any fed, only the sort key the frontier page needs. So
it must NOT touch notes, the log or evidence_count on 5,767 rows. The file it reads is named
frontier-queue-year.json, not enrich-frontier-*.json, so apply-frontier.py's own glob never picks it up.

The two fields are precomputed because museum/frontier.html sorts in the browser and cannot import python; the ONE
year key is the workshop's tools/year_key.py, and this delta is built by it (see build-delta.py beside this file). Re-run
the builder and this applier whenever frontier.json's year evidence changes, so the page's order never drifts from
the queue's order.

Honours MUSEUM_ROOT only (lane rule, 2026-09-28), refuses while a gate is running, writes frontier.json atomically
in its own indent (1, as apply-frontier.py does), and is idempotent: a row already carrying the same values is left
untouched and reported as unchanged.
"""
import json, os, re, sys

def _c269_write(p, raw, obj, default_indent):
    """hook c269 (lane MERGE-EVIDENCE-WINDOW-A, 2026-10-10), c245's _c245_write for the window-A appliers: write a registry
    file only when its bytes change, in the file's OWN indent (memory registry-json-indent: promotions.json 2,
    collections.json and frontier.json 1), by an atomic rename. A window-A re-dump at indent 1 made merge_evidence refuse the
    same window's merged pairs ("refused-indent", merge-batch 2026-10-10 lines 122 and 172). True when written."""
    import os as _o, re as _r, json as _j
    m = _r.match(r"[\[{][ \t]*\n( +)\S", raw[:256])
    out = _j.dumps(obj, ensure_ascii=False, indent=len(m.group(1)) if m else default_indent) + "\n"
    if out == raw: return False
    tmp = "%s.c269.%d.tmp" % (p, _o.getpid())
    with open(tmp, "w", encoding="utf-8") as fh: fh.write(out)
    _o.chmod(tmp, _o.stat(p).st_mode & 0o7777); _o.replace(tmp, p); return True

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.environ.get("MUSEUM_ROOT")
if not _ROOT:
    sys.exit("REFUSED: MUSEUM_ROOT is not set (appliers honour MUSEUM_ROOT only)")
sys.path.insert(0, os.path.join(_ROOT, "scripts", "fixers"))
try:
    from gate_detect import live_running as _live_running
except ImportError:
    _live_running = None

D = sys.argv[1].rstrip("/")
write = "--write" in sys.argv
P = os.path.join(_ROOT, "data", "frontier.json")

if write and _live_running and _live_running(r"scripts/gate\.sh", _ROOT):
    sys.exit("REFUSED: a gate is running")

src = os.path.join(D, "frontier-queue-year.json")
if not os.path.exists(src):
    sys.exit("REFUSED: no frontier-queue-year.json in %s" % D)

_c269_raw = open(P, encoding="utf-8").read()
fr = json.loads(_c269_raw)
rows = fr["rows"]
by = {r["name"]: r for r in rows}

items = json.load(open(src, encoding="utf-8"))
items = items if isinstance(items, list) else items.get("rows", [])

set_n = unchanged = missing = bad = 0
misses = []
for e in items:
    tgt = str(e.get("target") or e.get("name") or "").strip()
    row = by.get(tgt)
    if row is None:
        missing += 1
        if len(misses) < 20:
            misses.append(tgt)
        continue
    y = e.get("queue_year")
    b = e.get("queue_year_basis")
    if not (y is None or (isinstance(y, int) and 1900 <= y <= 2100)) or not isinstance(b, str) or not b:
        bad += 1
        continue
    cur_y, cur_b = row.get("queue_year"), row.get("queue_year_basis")
    if cur_y == y and cur_b == b:
        unchanged += 1
        continue
    if y is None:
        row.pop("queue_year", None)            # a null field reds the validator (D149): absent is the right shape
    else:
        row["queue_year"] = y
    row["queue_year_basis"] = b
    set_n += 1

print("frontier rows: %d | queue_year set/updated: %d | already current: %d | target not found: %d | malformed: %d"
      % (len(rows), set_n, unchanged, missing, bad))
if misses:
    print("  not found (first 20): " + "; ".join(misses))
if bad:
    sys.exit("REFUSED: %d malformed items — nothing written" % bad)

if not write:
    print("  (no --write: frontier.json not touched)")
    sys.exit(0)
if set_n and _c269_write(P, _c269_raw, fr, 1):   # hook c269: the file's own indent (was a fixed indent), and only when the content changed
    print("  written: %s" % P)
else:
    print("  nothing to change")
