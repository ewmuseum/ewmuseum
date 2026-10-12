#!/usr/bin/env python3
"""Provenance-note SHAPE hygiene (scripts/validate-provenance-notes.mjs is the law's reader): a typed record's span.from/span.to are
date objects {date, precision}, never bare strings; a record carries a date OR a span, never both (the span, being the more
specific, wins); precision is exact|month|year|unknown — a lane's "circa" becomes the precision its date string supports.
Born 2026-09-20 (cycle 149: 97 findings across 45 wings, most of them 09-13/09-14 legacy assembly). Idempotent; refuses while a gate runs.
Summaries (length, process wording) are NOT touched here: those are prose and are fixed by hand.
"""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
import json, re, subprocess, sys
def _c276_write(p, raw, obj, default_indent):
    """hook c276 (lane PREFLIGHT-FIXERS-INDENT, 2026-10-11), c269's _c269_write for the preflight-only fixers: write a registry
    file only when its bytes change, in the file's OWN indent (memory registry-json-indent: promotions.json 2,
    collections.json and frontier.json 1, shards 1), by an atomic rename. A preflight re-dump at indent 1 reflowed the committed
    indent-2 promotions.json on every one-row fix. True when written."""
    import os as _o, re as _r, json as _j
    m = _r.match(r"[\[{][ \t]*\n( +)\S", raw[:256])
    out = _j.dumps(obj, ensure_ascii=False, indent=len(m.group(1)) if m else default_indent) + "\n"
    if out == raw: return False
    tmp = "%s.c276.%d.tmp" % (p, _o.getpid())
    with open(tmp, "w", encoding="utf-8") as fh: fh.write(out)
    _o.chmod(tmp, _o.stat(p).st_mode & 0o7777); _o.replace(tmp, p); return True
if _live_running("scripts/gate[.]sh", _ROOT): sys.exit("REFUSED: a gate is running")
def prec(s):
    return "exact" if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s or "") else "month" if re.fullmatch(r"\d{4}-\d{2}", s or "") else "year" if re.fullmatch(r"\d{4}", s or "") else None
def obj(v):
    if isinstance(v, str):
        p = prec(v); return {"date": v, "precision": p} if p else v
    return v
p = f"{_ROOT}/data/promotions.json"; _c276_raw = open(p, encoding="utf-8").read(); d = json.loads(_c276_raw); spans = both = circa = 0
unk = 0
for r in d["promotions"]:
    for n in (r.get("provenance_notes") or []):
        if not isinstance(n, dict): continue
        sp = n.get("span")
        if isinstance(sp, dict):
            for k in ("from", "to"):
                if isinstance(sp.get(k), str): sp[k] = obj(sp[k]); spans += 1
                # 2026-09-21 (NEWF, cycle 164): a span end whose precision disagrees with its own date string takes the string's precision
                e = sp.get(k)
                if isinstance(e, dict) and isinstance(e.get("date"), str) and e.get("precision") in ("exact", "month", "year"):
                    _p = prec(e["date"])
                    if _p and _p != e["precision"]: e["precision"] = _p; spans += 1
        dt = n.get("date")
        if isinstance(dt, str) and dt.strip().lower() in ("unknown", "", "none", "null"):
            n["date"] = dt = {"date": None, "precision": "unknown"}; unk += 1
        if isinstance(dt, dict) and isinstance(dt.get("date"), str) and dt["date"].strip().lower() in ("unknown", "", "none", "null"):
            dt["date"] = None; dt["precision"] = "unknown"; unk += 1
        if isinstance(dt, dict) and dt.get("precision") == "circa":
            dt["precision"] = prec(dt.get("date")) or "unknown"; circa += 1
        if n.get("date") and n.get("span"): n["date"] = None; both += 1
if spans or both or circa:
    _c276_write(p, _c276_raw, d, 2)   # hook c276: the file's own indent (was a fixed indent), and only when the content changed
print(f"fix-provenance-notes-shape: span strings objectified {spans} | date dropped for span {both} | circa re-precisioned {circa} | unknown-string dates nulled {unk}")
