#!/usr/bin/env python3
"""Standing fixer (2026-09-21, preflight 154): every registry row belongs to exactly one shard. When a wave's
characters-corrections/append lands a row in a wing shard whose id also sits in data/shards/_unassigned/, the wing's
copy is the enriched one and the _unassigned copy is the stale Top-200 stub — remove it from _unassigned.
Only _unassigned is ever trimmed; a duplicate between two wing shards is reported, never resolved here."""
import json, glob, os
ROOT = os.environ.get("MUSEUM_ROOT") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
removed = 0; reported = []
for kind in ("characters", "units", "titles", "shows", "rps", "reigns", "awards"):
    owners = {}
    for f in glob.glob(f"{ROOT}/data/shards/*/{kind}.json"):
        shard = f.split("/")[-2]
        if shard == "_unassigned": continue
        try: rows = json.load(open(f, encoding="utf-8"))
        except Exception: continue
        for r in rows:
            if isinstance(r, dict) and r.get("id"):
                if r["id"] in owners and owners[r["id"]] != shard: reported.append((kind, r["id"], owners[r["id"]], shard))
                owners.setdefault(r["id"], shard)
    uf = f"{ROOT}/data/shards/_unassigned/{kind}.json"
    if not os.path.exists(uf): continue
    rows = json.load(open(uf, encoding="utf-8"))
    keep = [r for r in rows if not (isinstance(r, dict) and r.get("id") in owners)]
    if len(keep) != len(rows):
        removed += len(rows) - len(keep)
        json.dump(keep, open(uf, "w", encoding="utf-8"), ensure_ascii=False, indent=1); open(uf, "a").write("\n")
print(f"fix-shard-duplicate-ids: removed {removed} _unassigned duplicate(s); wing-vs-wing duplicates reported: {len(reported)}")
for t in reported[:10]: print("  DUPLICATE", *t)
