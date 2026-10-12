#!/usr/bin/env python3
"""Standing fixer (2026-09-23, preflight 171): an RP date the record cannot resolve is { "date": "unknown", "precision": "unknown",
"source": ... } — the literal string, never null (docs/SCHEMA.md, the unknown-date shape; registry-validate requires date.date to be a
string). The PCW-RPS waves wrote date: null on 1,062 rows. Where precision is "unknown" and date.date is null, write "unknown".
Also: an id in both involves and references keeps only involves (registry-validate: an entity is one or the other per RP)."""
import json, glob, os
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
nd = no = 0
for f in sorted(glob.glob(f"{ROOT}/data/shards/*/rps.json")):
    rows = json.load(open(f, encoding="utf-8")); changed = False
    for r in rows if isinstance(rows, list) else []:
        if not isinstance(r, dict): continue
        d = r.get("date")
        if isinstance(d, dict) and d.get("date") is None and d.get("precision") == "unknown":
            d["date"] = "unknown"; changed = True; nd += 1
        inv, ref = r.get("involves") or [], r.get("references") or []
        if isinstance(inv, list) and isinstance(ref, list) and set(inv) & set(ref):
            r["references"] = [x for x in ref if x not in inv]; changed = True; no += 1
    if changed:
        _dump(rows, f)
print(f"fix-rp-unknown-date: {nd} null unknown date(s) written 'unknown' | {no} involves/references overlap(s) resolved to involves")
