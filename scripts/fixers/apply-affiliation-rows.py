#!/usr/bin/env python3
"""apply-affiliation-rows.py <rows.json> — append affiliation rows (same shape as data/affiliations.json) unless an identical a/b/nature row exists; writes <rows.json>.APPLIED."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,sys,os
p=sys.argv[1]; A=f"{_ROOT}/data/affiliations.json"
if os.path.exists(p+".APPLIED"): print("already applied",p); sys.exit(0)
d=json.load(open(A,encoding="utf-8")); rows=d if isinstance(d,list) else d["affiliations"]
new=json.load(open(p,encoding="utf-8")); new=new if isinstance(new,list) else new.get("affiliations",new)
key=lambda r:(json.dumps(r.get("a"),sort_keys=True),json.dumps(r.get("b"),sort_keys=True),r.get("nature"))
have={key(r) for r in rows}; n=0
for r in new:
    if key(r) not in have: rows.append(r); have.add(key(r)); n+=1
json.dump(d,open(A,"w",encoding="utf-8"),ensure_ascii=False,indent=1); open(A,"a").write("\n"); open(p+".APPLIED","w").write("applied\n"); print("appended",n,"affiliation row(s)")
