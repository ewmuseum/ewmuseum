#!/usr/bin/env python3
"""Standing fixer (2026-09-23, preflight 171): docs/SCHEMA.md `authorship` (the Janitor's gavel, 2026-09-10) — "never guessed, set only
where the promotion's own record states it, absent means undetermined; a set value carries its grade and its source". A promotion row
whose authorship is set with no authorship_grade or no authorship_source is undetermined: all three keys are dropped."""
import json, os
def _dump(obj, path):
    # keep the file's own indent (shards are 1, promotions.json is 2) and write atomically
    try:
        with open(path, encoding="utf-8") as fh: fh.readline(); second = fh.readline()
        ind = (len(second) - len(second.lstrip(" "))) or 1
    except Exception: ind = 1
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh: json.dump(obj, fh, ensure_ascii=False, indent=ind); fh.write("\n")
    os.replace(tmp, path)
ROOT = os.environ.get("MUSEUM_ROOT") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
p = f"{ROOT}/data/promotions.json"; d = json.load(open(p, encoding="utf-8")); n = 0
for r in d.get("promotions", []):
    if r.get("authorship") and (not r.get("authorship_grade") or not r.get("authorship_source")):
        for k in ("authorship", "authorship_grade", "authorship_source"): r.pop(k, None)
        n += 1
if n:
    _dump(d, p)
print(f"fix-ungraded-authorship: {n} ungraded authorship value(s) dropped (undetermined)")
