#!/usr/bin/env python3
"""Apply a wave's external-figures-append.json (new rows, skipped when the id exists) and external-figures-enrich.json ([{target, depictions_add:[...]}] — appended to the target row's depictions, deduped by depiction id) to data/external-figures.json ({_schema_version, external_figures:[...]}). Marks .APPLIED. Usage: <museum root> <wave dir>"""
import json,sys,os
if len(sys.argv)<3: sys.exit("usage: <museum root> <wave dir>")
M,W=sys.argv[1],sys.argv[2]; p=f"{M}/data/external-figures.json"; D=json.load(open(p)); L=D["external_figures"]; by={r["id"]:r for r in L}; a=e=0
fa=f"{W}/delta/data/external-figures-append.json"
if os.path.exists(fa) and not os.path.exists(fa+".APPLIED"):
    for r in json.load(open(fa)):
        if r["id"] in by: continue
        L.append(r); by[r["id"]]=r; a+=1
    open(fa+".APPLIED","w").write("applied\n")
fe=f"{W}/delta/data/external-figures-enrich.json"
if os.path.exists(fe) and not os.path.exists(fe+".APPLIED"):
    for x in json.load(open(fe)):
        r=by.get(x.get("target"))
        if not r: print("no target:",x.get("target")); continue
        deps=r.setdefault("depictions",[]); have={d.get("id") for d in deps}
        for d in x.get("depictions_add",[]):
            if d.get("id") in have: continue
            deps.append(d); have.add(d.get("id")); e+=1
    open(fe+".APPLIED","w").write("applied\n")
json.dump(D,open(p,"w"),ensure_ascii=False,indent=1); open(p,"a").write("\n"); print(f"external figures: rows appended {a}, depictions added {e} ({os.path.basename(W)})")
