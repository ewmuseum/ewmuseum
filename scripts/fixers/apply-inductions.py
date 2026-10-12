#!/usr/bin/env python3
"""Append a wave's inductions-append-<slug>.json rows ({inductee, promotion, class_year, source}) to data/inductions.json (dict with 'inductions'), skipping rows already present by (inductee, promotion, class_year). Marks <file>.APPLIED. Usage: <museum root> <wave dir>"""
import json,sys,glob,os
if len(sys.argv)<3: sys.exit("usage: <museum root> <wave dir>")
M,W=sys.argv[1],sys.argv[2]; p=f"{M}/data/inductions.json"; D=json.load(open(p)); L=D["inductions"] if isinstance(D,dict) else D
K=lambda r: json.dumps([r.get("inductee"),r.get("promotion"),r.get("class_year")],sort_keys=True,ensure_ascii=False)  # inductee may be a dict (window 67 crash)
have={K(r) for r in L}; n=0
for f in sorted(glob.glob(f"{W}/delta/data/inductions-append-*.json")):
    if os.path.exists(f+".APPLIED"): continue
    for r in json.load(open(f)):
        k=K(r)
        if k in have: continue
        L.append(r); have.add(k); n+=1
    open(f+".APPLIED","w").write("applied\n")
json.dump(D,open(p,"w"),ensure_ascii=False,indent=1); open(p,"a").write("\n"); print(f"inductions appended {n} ({os.path.basename(W)})")
