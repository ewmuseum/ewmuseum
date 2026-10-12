#!/usr/bin/env python3
"""apply-memorials-append.py <memorials-append.json> — the memorial register's applier (2026-09-22). None existed, so
wave COORD-MEMORIAL-DORAN's row sat under an APPLIED wave, unapplied, from 19 Sep until this was written. Each row is a
memorial record keyed by id: a NEW id is appended whole; an EXISTING id merges — its list fields (characters, served_docs,
gallery, forum_accounts, links_out) gain the items they lack, never replaced, and its other fields are left alone (changing
a memorial's own words is the Janitor's call, made by hand). links_out (CURATION.md v119, 2026-09-24) rides the same merge:
an outbound link to a living federation the museum will never hold, validated at the gate against the frontier's own
verified-alive rows. The window writes <file>.APPLIED beside it. Idempotent."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import json,sys
p=sys.argv[1]; M=f"{_ROOT}/data/memorials.json"
d=json.load(open(M,encoding="utf-8")); rows=d["memorials"]; by={r["id"]:r for r in rows}
new=json.load(open(p,encoding="utf-8")); new=new if isinstance(new,list) else new.get("memorials",[new])
added=merged=0
for r in new:
    if not isinstance(r,dict) or not r.get("id"): continue
    cur=by.get(r["id"])
    if cur is None:
        rows.append(r); by[r["id"]]=r; added+=1; continue
    for f in ("characters","served_docs","gallery","forum_accounts","links_out"):
        for item in r.get(f) or []:
            if item not in cur.setdefault(f,[]): cur[f].append(item); merged+=1
if added or merged:
    tmp=M+".tmp"; open(tmp,"w",encoding="utf-8").write(json.dumps(d,ensure_ascii=False,indent=1)+"\n"); os=_os; os.replace(tmp,M)
print(f"memorials: {added} added, {merged} list item(s) merged ({_os.path.basename(p)})")
