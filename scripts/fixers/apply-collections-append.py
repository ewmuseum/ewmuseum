#!/usr/bin/env python3
"""Append a wave's delta/data/collections-append.json lot rows to data/collections.json when the id is absent (idempotent; marks .APPLIED). Usage: <museum root> <wave dir>"""
import json,sys,os
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
M,W=sys.argv[1],sys.argv[2]; f=f"{W}/delta/data/collections-append.json"
if not os.path.exists(f) or os.path.exists(f+".APPLIED"): sys.exit(0)
p=f"{M}/data/collections.json"; _c269_raw=open(p,encoding="utf-8").read(); D=json.loads(_c269_raw); C=D["collections"]; have={c.get("id") for c in C}
rows=json.load(open(f)); rows=rows if isinstance(rows,list) else [rows]; n=0
for r in rows:
    if r.get("id") in have: print("lot",r.get("id"),"already present"); continue
    C.append(r); have.add(r["id"]); n+=1
_c269_write(p,_c269_raw,D,1)   # hook c269: the file's own indent (was a fixed indent), and only when the content changed
open(f+".APPLIED","w").write("applied\n"); print(os.path.basename(W),"lots appended:",n)
