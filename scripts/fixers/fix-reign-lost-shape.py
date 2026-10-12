#!/usr/bin/env python3
"""fix-reign-lost-shape (2026-09-28, preflight 208 red): registry-validate hard-fails a reign whose `lost` is an object without a
`precision` ("\"lost\" must be null or an object with a \"precision\""). wave-SCCW-REIGNS (window 207) landed five
still-champion-at-record-end reigns as `lost: {"source": "..."}` with no date and no precision. The settled shape for an end the
record does not date is `{"date": "unknown", "precision": "unknown", "source": ...}` (17 still-champion-at-record-end reigns and
170 lost-in-match reigns already carry it). This fixer gives any such `lost` that shape, keeping every key it had; nothing
else is touched. Each shard keeps its own indent. Prints every row it fixes. Idempotent; refuses while a gate runs."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
import glob, json, os, subprocess, sys
if _live_running("scripts/gate[.]sh", _ROOT):
    print("fix-reign-lost-shape: a gate is running — skipped"); sys.exit(0)
fixed = []
for f in sorted(glob.glob(f"{_ROOT}/data/shards/*/reigns.json")):
    rows = json.load(open(f, encoding="utf-8"))
    if not isinstance(rows, list): continue
    changed = False
    for r in rows:
        if not isinstance(r, dict): continue
        lo = r.get("lost")
        if isinstance(lo, dict) and "precision" not in lo:
            new = {"date": lo.get("date", "unknown"), "precision": "unknown"}
            new.update({k: v for k, v in lo.items() if k != "date"})
            r["lost"] = new; changed = True
            fixed.append(f"{f.split('/')[-2]}:{r.get('id')}")
    if changed:
        with open(f, encoding="utf-8") as fh: fh.readline(); l2 = fh.readline()
        ind = (len(l2) - len(l2.lstrip(" "))) or 1
        tmp = f + ".rlstmp"
        with open(tmp, "w", encoding="utf-8") as fh: json.dump(rows, fh, ensure_ascii=False, indent=ind); fh.write("\n")
        os.replace(tmp, f)
print("fix-reign-lost-shape:", len(fixed), "lost object(s) given a precision", ("| " + ", ".join(fixed)) if fixed else "")
