#!/usr/bin/env python3
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import csv, sys; csv.field_size_limit(sys.maxsize)
"""Standing (coordinator 2026-09-22, preflight 166): registry-validate requires a match's optional string fields to be
non-empty when present. Lane shards landed "stipulation": null (DZW) and an eliminations entry with "by": null (MPW).
Drops an empty or null optional string key; an elimination whose "by" is empty loses that key (the eliminated wrestler stays)."""
import json, glob
n = 0
for f in glob.glob(f"{_ROOT}/data/shards/*/shows.json"):
    try: S = json.load(open(f, encoding="utf-8"))
    except Exception: continue
    ch = False
    for s in S if isinstance(S, list) else []:
        for m in (s.get("matches") or []) if isinstance(s, dict) else []:
            if not isinstance(m, dict): continue
            for k in ("stipulation", "note", "finish", "how", "title"):
                if k in m and (m[k] is None or (isinstance(m[k], str) and not m[k].strip())): del m[k]; ch = True; n += 1
            for e in m.get("eliminations") or []:
                # 2026-09-30 (preflight 222 red): "note" and "how" too — GCW Dangerous Games 2007 m6 landed an elimination with "note": "".
                for ek in ("by", "note", "how"):
                    if isinstance(e, dict) and ek in e and (e[ek] is None or (isinstance(e[ek], str) and not e[ek].strip())): del e[ek]; ch = True; n += 1
    if ch: json.dump(S, open(f, "w", encoding="utf-8"), ensure_ascii=False, indent=1); open(f, "a").write("\n")
print(f"fix-empty-match-strings: empty optional strings dropped {n}")
