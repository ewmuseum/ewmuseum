#!/usr/bin/env python3
"""Apply a lane's delta/data/registry-corrections.json to museum/data/promotions.json.
Rows: {slug, field, old, new, evidence?}. For field "closed"/"founded" also accepts a sibling row for "years"; if none, years is rebuilt from founded/closed dates (YYYY[–YYYY]). Usage: apply-corrections.py <corrections.json> [--dry]

2026-09-27 (job J48), three gaps closed — see the workshop's kit-j48/README.md:
  1. OLD-MATCHED. A row that REPLACES a value (the plain set, and "__REMOVE__") and carries `old` lands only where the
     live value still equals `old`; where it already equals `new` the row is reported already-correct and skipped; a
     stale `old` is printed and LEFT, and the script exits 1 so the window does not stamp the file .APPLIED
     (apply-affiliations-corrections.py's rule; apply-page-corrections.py's exit, J38d). A correction whose premise has
     moved is a ruling to re-take, not a write to force. Rows with no `old`, and the APPEND/MERGE shapes below, are
     untouched by the guard and behave exactly as before.
  2. OWN INDENT. promotions.json is rewritten in the indent it is committed at (2), not at 1 — a wrong indent once made
     a 356k-line diff (2026-09-26). The file is written only when its bytes actually change.
  3. provenance_notes[i].<key> — a field INSIDE an existing provenance record (the shape nothing could correct before;
     three restored `cwo` tokens waited on it). `old` is REQUIRED there. The index is a HINT: the record is found by its
     own content — its value at <key> equal to `old`, plus every key of an optional `record_match` {key: value} — so a
     record appended or removed since the filing cannot move the write onto its neighbour. Exactly one record must
     match, else the row is printed and left (exit 1); where the only match already reads `new` the row is skipped.
  Because a stale row now leaves the file unstamped, a later window RE-RUNS it: every shape in this script therefore has
  to be a no-op on its second run. The one that was not — a string `new` on provenance_notes, appended unconditionally —
  now skips a ruling whose text is already filed (compared against each record's own `claim`/`summary`, including the
  typed-record converter's truncated form), and every row that landed is recorded in `apply-corrections.PARTIAL` at the
  WAVE ROOT, beside READY/APPLIED (workshop, never under museum/, and never inside delta/data, where land-check would
  read it as data nothing lands), so a re-run skips it outright. That sidecar is removed the moment the file lands clean.
"""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import sys, json,sys,os,re,subprocess,hashlib
if _live_running("^(sh -c )?node scripts/(privacy-check|cross-reference|validate|registry-validate|build-data)", _ROOT): sys.exit("REFUSED: museum scripts running")
p=sys.argv[1]; dry="--dry" in sys.argv; M=f"{_ROOT}/data/promotions.json"
RAW=open(M,encoding="utf-8").read(); P=json.loads(RAW); rows=P if isinstance(P,list) else P["promotions"]; by={r["id"]:r for r in rows}
C=json.load(open(p)); C=(C.get("corrections") or C.get("rows")) if isinstance(C,dict) and isinstance(C.get("corrections") or C.get("rows"),list) else (C if isinstance(C,list) else [C]); touched=set()  # L311 filed a {"_schema_version","corrections":[…]} envelope
LANDED=[]; stale=0                                   # LANDED = every row that landed or was already correct (the years rebuild reads it, not C)
_wv=p.split("/delta/data/")[0] if "/delta/data/" in p else None
SIDE=(_wv+"/apply-corrections.PARTIAL") if _wv else (p+".PARTIAL")   # fingerprints of the rows that landed while the file stayed
                                                     # unstamped. At the WAVE ROOT, beside READY/APPLIED: inside delta/data it
                                                     # would itself raise land-check's L-NOAPPLIER (nothing reads it as data).
DONE=set()
if _os.path.exists(SIDE):
    try: DONE=set(json.load(open(SIDE,encoding="utf-8")))
    except Exception: DONE=set()
def fp(c): return hashlib.sha1(json.dumps(c,sort_keys=True,ensure_ascii=False).encode("utf-8")).hexdigest()
PN_PATH=re.compile(r"^provenance_notes\[(\d+)\]\.([A-Za-z_][A-Za-z0-9_]*)$")
def indent_of(text,obj):
    """The file's own indent, so a write is a one-row diff and not 356k lines (memory registry-json-indent, 2026-09-26).
    The first indented line's own width is tried first (one dump of a 14 MB file, not three), then 1/2/4."""
    cand=[]
    for line in text.split("\n",40)[1:]:
        if line.startswith(" "): cand=[len(line)-len(line.lstrip(" "))]; break
    for i in cand+[x for x in (2,1,4) if x not in cand]:
        if json.dumps(obj,ensure_ascii=False,indent=i)+("\n" if text.endswith("\n") else "")==text: return i
    return cand[0] if cand else 1
def already_filed(cur,text):
    # the ruling is already on the list: its own text, or the typed-record converter's truncated summary of it
    # (fix-provenance-notes.py rewrites {claim,evidence,grade} into {kind,…,summary}, and summary is shortened)
    for x in cur:
        if not isinstance(x,dict): continue
        for k in ("claim","summary"):
            v=x.get(k)
            if not isinstance(v,str): continue
            if v==text: return True
            if v.endswith("…") and len(v)>8 and text.startswith(v[:-1]): return True
    return False
def yr(d): m=re.match(r"(\d{4})",str(d or "")); return m.group(1) if m else None
def norm(c):
    # window 67b (2026-09-06): lanes file rows keyed by "id" and in two extra shapes — {id, <field>: value} and {id, provenance_notes_append: text}
    # hook c143 (2026-10-08, lane APPLIER-DEBT): the unconditional setdefault INSERTED slug=None on a row that carries no
    # `id` (every {wing, record} row), and a slug KEY that is present-but-None then froze both fallbacks meant to catch it —
    # this function's own setdefault("slug", c.get("wing")) below, and the loop's `if "slug" not in c`. The row printed
    # "no such wing: None" and landed nothing. Set slug only from an id that is actually there.
    c=dict(c)
    if c.get("id") is not None: c.setdefault("slug",c["id"])
    if "field" not in c:
        if "provenance_notes_append" in c: c["field"]="provenance_notes"; c["new"]=c.pop("provenance_notes_append")
        elif isinstance(c.get("record"),dict) and ("wing" in c or "id" in c):
            # 2026-09-21: LANE-TEMPLATE-provenance-notes.md taught {wing, record} until today; this skipped 29 typed records
            # from eight landed waves. A {wing, record} row is one provenance record to append (list merge, never replace).
            c["field"]="provenance_notes"; c["new"]=[c.pop("record")]
            # hook c143: the 2026-09-21 fix above never actually landed a {wing, record} row — slug was already None by here, so
            # this setdefault was a no-op (the one wave that needed it worked around it by filing the wing as `id`). Set it.
            if c.get("slug") is None and c.get("wing") is not None: c["slug"]=c["wing"]
        else:
            ks=[k for k in c if k not in ("id","slug","evidence","grade","old","note","reason")]
            if len(ks)==1: c["field"]=ks[0]; c["new"]=c[ks[0]]
    return c
FPS=[fp(c) for c in C]                               # fingerprint the row AS FILED, before normalisation
C=[norm(c) for c in C]
missing_wings=set()
for _i,c in enumerate(C):
    if "slug" not in c:  # 2026-09-09: lanes sometimes key the wing as id/promotion/wing
        for k in ("id","promotion","wing","promotion_id"):
            if k in c: c["slug"]=c[k]; break
    if "field" not in c or "new" not in c: print("row skipped (no field/new):",{k:str(v)[:60] for k,v in c.items()}); continue
    if FPS[_i] in DONE: print(c.get("slug"),c.get("field"),": already landed by an earlier run of this file (.PARTIAL); skipped"); LANDED.append(c); continue
    if c.get("field") in ("founded","closed") and not isinstance(c.get("new"),dict):
        print(c.get("slug"),c.get("field"),": REFUSED — founded/closed take an object {date, precision, source}, not a string; carried as a provenance note instead"); c={"slug":c.get("slug"),"field":"provenance_notes","new":f"Note filed against {c.get('field')} (2026-09-05, shape refused): {c.get('new')}"}
    r=by.get(c["slug"])
    if not r: print("no such wing:",c["slug"]); missing_wings.add(c["slug"]); continue
    f=c["field"]; mpn=PN_PATH.match(str(f))
    if not mpn: print(c["slug"],f,":",json.dumps(r.get(f))[:80],"→",json.dumps(c["new"])[:80])
    if isinstance(r.get("provenance_notes"),str): r["provenance_notes"]=[{"claim":r["provenance_notes"],"evidence":"registry note","grade":"presumed"}]
    if mpn:
        # 2026-09-27 (J48): a field inside an EXISTING provenance record. Index is a hint; the record is identified by its
        # own content (its <key> equal to `old`, plus every key of an optional record_match), so a moved index cannot
        # hit the wrong record. `old` is required; exactly one record must match; nothing else is ever touched.
        idx=int(mpn.group(1)); key=mpn.group(2); pn=r.get("provenance_notes")
        if not isinstance(pn,list): print(c["slug"],f,": REFUSED — the wing has no provenance_notes list"); stale+=1; continue
        if "old" not in c: print(c["slug"],f,": REFUSED — a provenance_notes[i].<key> row must carry `old` (nothing inside a record is written blind)"); stale+=1; continue
        mt=c.get("record_match") or {}
        if not isinstance(mt,dict): print(c["slug"],f,": REFUSED — record_match must be an object of live record fields"); stale+=1; continue
        ok=lambda rec: isinstance(rec,dict) and all(rec.get(k)==v for k,v in mt.items())
        hits=[i for i,rec in enumerate(pn) if ok(rec) and rec.get(key)==c["old"]]
        done=[i for i,rec in enumerate(pn) if ok(rec) and rec.get(key)==c["new"]]
        if not hits and done:
            print(c["slug"],f,f": provenance_notes[{done[0]}].{key} already reads the corrected value; skipped"); LANDED.append(c); continue
        if len(hits)!=1:
            print(c["slug"],f,f": REFUSED — {len(hits)} provenance record(s) match this row's own `old` at .{key}"+(""  if mt else " (and the row gives no record_match to narrow it)")+"; left for a ruling"); stale+=1; continue
        i=hits[0]
        if i!=idx: print(c["slug"],f,f": index moved {idx} -> {i} (matched on the record's own content, which is the real key)")
        print(c["slug"],f,":",json.dumps(pn[i].get(key))[:80],"→",json.dumps(c["new"])[:80])
        pn[i][key]=c["new"]; touched.add(c["slug"]); LANDED.append(c); DONE.add(FPS[_i]); continue
    if f=="provenance_notes" and isinstance(c["new"],str):
        # a lane's string 'new' for the notes list is a RULING to append, never a replacement of the whole list (L20, 2026-09-05)
        cur=r.setdefault("provenance_notes",[])
        if already_filed(cur,c["new"]): print(c["slug"],f,": that ruling is already on the wing's notes; skipped"); LANDED.append(c); continue  # 2026-09-27 (J48): a re-run must not file it twice
        cur.append({"claim":c["new"],"evidence":str(c.get("evidence") or "the lane's own digest (workshop record)"),"grade":c.get("grade","primary-source")}); touched.add(c["slug"]); LANDED.append(c); DONE.add(FPS[_i]); continue  # evidence never empty (preflight 69b)
    if c["new"]=="__REMOVE__":  # the corrections sentinel = delete the field (2026-09-06: 186 rows served a literal "__REMOVE__" qualifier)
        if f not in r: print(c["slug"],f,": already absent; skipped"); LANDED.append(c); continue
        if "old" in c and r.get(f)!=c["old"]: print(c["slug"],f,": STALE — the live value does not match this row's own `old`, so the field this row meant to remove is not the field that is there; left for a ruling"); stale+=1; continue
        r.pop(f,None); touched.add(c["slug"]); LANDED.append(c); DONE.add(FPS[_i]); continue
    if isinstance(r.get(f),list) and not isinstance(c["new"],list):  # LIST-FIELD APPEND (2026-09-08): a single object handed to a list field (sources) appends, never replaces the held list
        if c["new"] not in r[f]: r[f].append(c["new"])
    elif isinstance(c["new"],list) and (isinstance(r.get(f),list) or r.get(f) is None) and f in ("provenance_notes","sources","community_presence","aliases","aka"):
        # 2026-09-13: a list `new` MERGES — every item not already held is appended; the live list is never replaced by a
        # wave's snapshot (several waves append claims to the same wing in one chain; a replacement dropped the others').
        cur=r.get(f) or []
        for item in c["new"]:
            if item not in cur: cur.append(item)
        r[f]=cur
    else:
        # 2026-09-27 (J48): a REPLACE lands only where its own premise still holds. Idempotent, and a stale row is left.
        if "old" in c:
            if r.get(f)==c["new"]: print(c["slug"],f,": already reads the corrected value; skipped"); LANDED.append(c); continue
            if r.get(f)!=c["old"]: print(c["slug"],f,": STALE — the live value does not match this row's own `old`; left for a ruling (the premise moved: re-take the ruling against the live value)"); stale+=1; continue
        r[f]=c["new"]
    touched.add(c["slug"])
    LANDED.append(c); DONE.add(FPS[_i])
    if c.get("evidence"):
        pass  # served-text rule (the Janitor 2026-09-05/10): no audit-trail claim in served provenance_notes; the correction file is the receipt
for s in touched:
    r=by[s]
    # rebuild years ONLY when a date field actually LANDED (L283: 634 name/qualifier rows must not touch years; J48: a
    # refused founded/closed row must not rebuild years off a premise that did not land). An explicitly filed years row
    # anywhere in the file still suppresses the rebuild, landed or not.
    if not any(c.get("slug")==s and c.get("field")=="years" for c in C) and any(c.get("slug")==s and c.get("field") in ("founded","closed") for c in LANDED):
        a=yr((r.get("founded") or {}).get("date")); b=yr((r.get("closed") or {}).get("date"))
        if a: r["years"]=a if (not b or b==a) else f"{a}–{b}"; print(s,"years →",r["years"])
unstamped=bool(stale or missing_wings)   # the window stamps only on exit 0; anything else means this file is read again
if not dry:
    OUT=json.dumps(P,ensure_ascii=False,indent=indent_of(RAW,P))+"\n"
    if OUT!=RAW:
        tmp=M+".j48.tmp"; open(tmp,"w",encoding="utf-8").write(OUT); _os.replace(tmp,M); print("written")
    else: print("no change")
    if unstamped and DONE: json.dump(sorted(DONE),open(SIDE,"w",encoding="utf-8"))       # what landed, so a re-run skips it
    elif not unstamped and _os.path.exists(SIDE): _os.remove(SIDE)                       # the whole file landed: no partial state left
if missing_wings: print("apply-corrections: wings not yet in the registry (file left unmarked):",sorted(missing_wings))
if stale: print(f"apply-corrections: {stale} row(s) left for a ruling (stale `old`, or a provenance record that could not be identified) — the file is NOT stamped .APPLIED; the window will re-read it"); sys.exit(1)
if missing_wings: sys.exit(2)
