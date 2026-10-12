#!/usr/bin/env python3
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import csv, sys; csv.field_size_limit(sys.maxsize)
"""Standing (coordinator 2026-09-21, preflight 165): title and award rows need a `page`. Generated A–Z indexes link
to it, and cross-reference dereferences it. apply-shard-append.py filled a MISSING page, but a row that arrived with
"page": null or "" (HAMMER's two titles, via apply-delta's shard merge) rendered href="" and redded validate.
Fills any falsy page with /<kind>/<id>.html, never touching a set one."""
import json, glob
n = 0
for kind in ("titles", "awards"):
    for f in glob.glob(f"{_ROOT}/data/shards/*/{kind}.json"):
        try: R = json.load(open(f, encoding="utf-8"))
        except Exception: continue
        ch = False
        for r in R if isinstance(R, list) else []:
            if isinstance(r, dict) and r.get("id") and not r.get("page"):
                r["page"] = f"/{kind}/{r['id']}.html"; ch = True; n += 1
        if ch: json.dump(R, open(f, "w", encoding="utf-8"), ensure_ascii=False, indent=1); open(f, "a").write("\n")
print(f"fill-title-award-pages: filled {n}")
