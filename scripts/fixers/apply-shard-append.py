#!/usr/bin/env python3
"""Apply one <kind>-append-<wing>.json (characters|units|titles|reigns|shows|rps|awards) to the museum shard: rows whose id
is new are appended; an existing collected:false stub (no matches) yields to a full row of the same id. Usage: apply-shard-append.py <file>"""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,sys,os
f=sys.argv[1]; kind,slug=os.path.basename(f)[:-len(".json")].split("-append-",1); p=f"{_ROOT}/data/shards/{slug}/{kind}.json"
if kind not in ("characters","units","titles","reigns","shows","rps","awards"): print("append skipped (not a shard kind):",os.path.basename(f)); sys.exit(0)
if not os.path.exists(p): print("append skipped (no shard yet):",slug,kind); sys.exit(1)
R=json.load(open(p,encoding="utf-8")); new=json.load(open(f,encoding="utf-8"))
if not isinstance(R,list) or not isinstance(new,list): print("append skipped (shape):",slug,kind); sys.exit(1)
byid={r.get("id"):i for i,r in enumerate(R) if isinstance(r,dict)}; added=0; upgraded=0
for r in new:
    if not isinstance(r,dict) or not r.get("id"): continue
    if kind in ("awards","titles") and not r.get("page"): r["page"]=f"/{kind}/{r['id']}.html"  # 2026-09-13: cross-reference dereferences a.page; a row without it crashed preflight 135b
    i=byid.get(r["id"])
    if i is None: R.append(r); byid[r["id"]]=len(R)-1; added+=1
    elif R[i].get("collected") is False and not R[i].get("matches") and (r.get("matches") or r.get("collected") is not False): R[i]=r; upgraded+=1
# 2026-10-03 (GTT-PASS2-LANDPREP, hook c26): keep the shard's OWN indent (shards are 1, 2 or 4). A fixed indent=1 reflowed the
# indent-2 prime-2003 characters shard when wave-GTT-HOST-FED-MERGES appended two rows (window 244).
_m=__import__("re").match(r"[\[{][ \t]*\n( +)\S",open(p,encoding="utf-8").read(256)); _ind=len(_m.group(1)) if _m else 1
if added or upgraded: json.dump(R,open(p,"w",encoding="utf-8"),ensure_ascii=False,indent=_ind); open(p,"a").write("\n")
# 2026-09-13: rows that name a served page must bring the page along (gate 135 red on 21 broken links when
# §6g appended a necw show whose page still sat in the wave's delta/promotions/ tree awaiting the chain copy).
wave=f.split("/delta/")[0] if "/delta/" in f else None; copied=0
if wave:
    import shutil
    for r in new:
        pg=r.get("page") if isinstance(r,dict) else None
        if pg and pg.startswith("/promotions/"):
            src=os.path.join(wave,"delta",pg.lstrip("/")); dst=os.path.join(f"{_ROOT}",pg.lstrip("/"))
            if os.path.exists(src) and not os.path.exists(dst):
                os.makedirs(os.path.dirname(dst),exist_ok=True); shutil.copy2(src,dst); copied+=1
print(slug,kind,"rows appended:",added,"| stubs upgraded:",upgraded,"| pages copied:",copied)
