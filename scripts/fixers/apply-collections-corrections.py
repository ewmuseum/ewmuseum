#!/usr/bin/env python3
"""Apply a lane's collections-corrections.json ({id, field, old, new, evidence}) to data/collections.json by lot id: sets `field` to `new` only when the live value equals `old` (or old is null); lists mismatches. Idempotent (a second run finds new==live and skips). Usage: <museum root> <corrections.json>"""
import json,sys
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
if len(sys.argv)<3: sys.exit("usage: <museum root> <corrections.json>")
M,src=sys.argv[1],sys.argv[2]; p=f"{M}/data/collections.json"; _c269_raw=open(p,encoding="utf-8").read(); D=json.loads(_c269_raw)
rows=D if isinstance(D,list) else (D.get("collections") or D.get("lots") or D.get("rows"))
by={str(r.get("id")):r for r in rows if isinstance(r,dict)}; C=json.load(open(src)); n=0; skip=[]
for c in C:
    r=by.get(str(c["id"]))
    if not r: skip.append((c["id"],"no such lot")); continue
    live=r.get(c["field"])
    if live==c["new"]: continue
    if c.get("old") is not None and live!=c["old"]: skip.append((c["id"],c["field"],"live differs from old")); continue
    r[c["field"]]=c["new"]; n+=1
_c269_write(p,_c269_raw,D,1)   # hook c269: the file's own indent (was a fixed indent), and only when the content changed
print("collections corrections applied:",n,"| skipped:",skip[:5])
