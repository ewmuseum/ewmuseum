#!/usr/bin/env python3
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import csv, sys; csv.field_size_limit(sys.maxsize)
"""Standing (coordinator 2026-09-22, preflight 165): registry-validate requires every match to carry a numeric
`order` and forbids `winner_side: null` (an index into sides, or absent). Lane shards landed both (30mc-2001's
cards without order; MVW's Ring Wars with null winner_side on unresolved matches). Fills a missing or non-numeric
order with the match's 1-based position on its card, and drops a null winner_side (an unresolved match simply has
none). Never changes an order or winner_side that is set."""
import json, glob
o = w = 0
for f in glob.glob(f"{_ROOT}/data/shards/*/shows.json"):
    try: S = json.load(open(f, encoding="utf-8"))
    except Exception: continue
    ch = False
    for s in S if isinstance(S, list) else []:
        for i, m in enumerate(s.get("matches") or [] if isinstance(s, dict) else []):
            if not isinstance(m, dict): continue
            if not isinstance(m.get("order"), (int, float)) or isinstance(m.get("order"), bool):
                m["order"] = i + 1; ch = True; o += 1
            if "winner_side" in m and m["winner_side"] is None:
                del m["winner_side"]; ch = True; w += 1
    if ch: json.dump(S, open(f, "w", encoding="utf-8"), ensure_ascii=False, indent=1); open(f, "a").write("\n")
print(f"fix-match-order-winner-side: orders filled {o} | null winner_side dropped {w}")
