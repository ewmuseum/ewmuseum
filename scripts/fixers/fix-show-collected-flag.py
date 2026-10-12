#!/usr/bin/env python3
"""Standing fixer (2026-09-21, preflight 154): a show row's "collected" key, if present, must be the literal false
(registry-validate: an ordinary held show simply omits it). Four window-153 waves wrote collected: true on 25 served
cards (gdwa, rspwwcw, iea-2000, acwa-atlantic-1999). Drop the key wherever it is not literally false."""
import json, glob, os
ROOT = os.environ.get("MUSEUM_ROOT") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
n = 0
for f in sorted(glob.glob(f"{ROOT}/data/shards/*/shows.json")):
    rows = json.load(open(f, encoding="utf-8")); changed = False
    for s in rows:
        if isinstance(s, dict) and "collected" in s and s["collected"] is not False:
            del s["collected"]; changed = True; n += 1
    if changed:
        json.dump(rows, open(f, "w", encoding="utf-8"), ensure_ascii=False, indent=1); open(f, "a").write("\n")
print(f"fix-show-collected-flag: dropped {n} non-false collected flag(s)")
