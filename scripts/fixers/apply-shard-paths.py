#!/usr/bin/env python3
"""Apply a wave's indexed-path shard corrections, sub-element deletes and record retirements (2026-09-14, COORD-RSPWWCW-CONSCRIPTED-01).
  delta/data/<type>-corrections-<wing>.json rows {id, field, old, new[, anchor]} where field is a path like appearances[3].note or matches[0].sides
  delta/data/<type>-delete-<wing>.json rows {id, field:"appearances[3]", value, reason} — the element at that index must equal value; deletes run per id in descending index order
  delta/data/<kind>-retire.json [{id, reason}] (characters, units, titles, reigns, shows, rps, awards; 2026-09-26) — record removed from its wing shard, id appended to the workshop's retired-ids.tsv (fix-lost-records honours it)
Idempotent: a correction whose current value already equals new is skipped; a delete whose element no longer matches is skipped; a retire of an absent id is skipped.

ROWS LAND ONCE (lane MACHINERY-SHARD-PATHS-RERUN, 2026-09-29). window.sh A3 (and standing-window-fixers.sh §6m) re-run this applier over
EVERY READY or APPLIED wave in every window, and an index path is only as good as the array it was written against: once a later delete
(this wave's own, or any later wave's) shifts the array, a re-run lands an `old: null` row on whatever element now sits at that index, or
appends an `old: null` list[len] row a second time. The live tree carried 38 such re-landings on 2026-09-29 (UWF-BACKPORT-APPEARANCES in
windows 203/208, UWF-MINTS-0927 in 208/215: 27 duplicate appearances and 11 angle->match flips on the wrong person), and five MINTS
rows that never landed because a BACKPORT re-append took their slot first. So:
  * PER-FILE LEDGER. Beside every corrections/delete file this applier keeps `<file>.PATHS.APPLIED` (JSON: the row numbers that have
    landed or were found already landed, `complete` once every path row is done). A row in the ledger is NEVER evaluated again. A file
    whose ledger is complete is not even opened. The name is this applier's own: `<file>.APPLIED` on a shared *-corrections-* file
    belongs to apply-rps-corrections.py (it stamps rps-corrections-<wing>.json.APPLIED), and land-check already ignores *.APPLIED.
    A row that did not land (stale old, missing record, moved slot) stays out of the ledger and is tried again next window —
    today's idempotence for a wave not yet applied is unchanged.
  * APPENDS ARE ANCHORED ON THEIR OWN VALUE. An `old: null` list[N] row whose element is already in the list is done (never appended
    twice). One whose slot is no longer the list's end is NOT appended and is reported (it needs a ruling, not a guess).
  * OPTIONAL `anchor` ON ANY INDEX-PATH ROW: {"who": ..., "kind": ...} / {"order": ...} / {"id": ...} — every key must match the element
    at the path's last index or the row is skipped and reported. New waves should carry one on every `old: null` key row and on every
    row whose `old` is a common value (kind, winner_side, a year).
  * --backfill <wave>...: writes a complete ledger for every file of a wave that already carries APPLIED, lands NOTHING and touches no
    shard (run once, between cycles, before this version's first window). Rows whose live path does not read `new` are listed in the
    ledger under `not_new_at_backfill` for a human to read — they are frozen, never re-landed.
  * A delta file edited after its ledger was written (sha256 differs) is left whole and reported: row numbers are not re-counted.
  * --dry: reads and reports, writes nothing (no shard, no ledger, no retired-ids row).
"""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,os,re,sys,subprocess,datetime,time
if _live_running("^(sh -c )?node scripts/(privacy-check|cross-reference|validate|registry-validate|build-data)", _ROOT):
    print("apply-shard-paths: gate/render running — skipped"); sys.exit(0)
DRY='--dry' in sys.argv; BACKFILL='--backfill' in sys.argv
ARGS=[a for a in sys.argv[1:] if not a.startswith('--')]
M=f"{_ROOT}/data/shards"; RET=f"{_WORKSHOP}/desk/retired-ids.tsv"
def tokens(path):
    out=[]
    for part in path.split("."):
        m=re.match(r"^([^\[]+)((\[\d+\])*)$",part)
        if not m: raise ValueError(path)
        out.append(m.group(1)); out+= [int(x) for x in re.findall(r"\[(\d+)\]",m.group(2))]
    return out
def get(o,toks):
    for t in toks: o=o[t]
    return o
def setp(o,toks,v):
    for t in toks[:-1]: o=o[t]
    o[toks[-1]]=v
def load(p): return json.load(open(p))
def _indent(p):
    # 2026-09-26: keep the file's own indent (shards are indent 1, 2 or 4; a wrong one reflows the whole file)
    try:
        h=open(p,encoding="utf-8").read(64); import re as _r; m=_r.match(r"\[\s*\n( +)[{\[\"]",h)
        return len(m.group(1)) if m else 2
    except Exception: return 2
def save(p,d):
    if DRY: return
    ind=_indent(p); json.dump(d,open(p,"w"),indent=ind,ensure_ascii=False); open(p,"a").write("\n")
def is_path_row(r): return isinstance(r,dict) and r.get("field") and ("." in r["field"] or "[" in r["field"])
# ---- the per-file ledger ------------------------------------------------------------------------------------------------
def ledger_path(f): return f+".PATHS.APPLIED"
def sha(f):
    import hashlib; return hashlib.sha256(open(f,"rb").read()).hexdigest()
def ledger_read(f):
    """(done rows, complete, changed): row numbers are only meaningful for the bytes they were counted on, so a delta file edited
    after its ledger was written is reported and left whole (changed=True) — it needs a ruling, never a re-count."""
    try:
        d=json.load(open(ledger_path(f)))
    except Exception: return set(), False, False
    if d.get("sha256") and d["sha256"]!=sha(f): return set(d.get("done") or []), False, True
    return set(d.get("done") or []), bool(d.get("complete")), False
def ledger_write(f,done,total,extra=None):
    if DRY: return
    d={"applier":"apply-shard-paths.py","at":time.strftime("%Y-%m-%dT%H:%M:%S"),"sha256":sha(f),"done":sorted(done),"rows":total,
       "complete":len(done)>=total}
    if extra: d.update(extra)
    tmp=ledger_path(f)+".tmp"; json.dump(d,open(tmp,"w"),indent=1); open(tmp,"a").write("\n"); os.replace(tmp,ledger_path(f))
def anchor_ok(rec,toks,r):
    """The row's optional anchor must match the element at the path's last list index."""
    a=r.get("anchor")
    if not a: return True
    ints=[i for i,t in enumerate(toks) if isinstance(t,int)]
    if not ints: return True
    try: el=get(rec,toks[:ints[-1]+1])
    except Exception: return False
    return isinstance(el,dict) and all(el.get(k)==v for k,v in a.items())
def say(W,f,n,r,why): print(f"apply-shard-paths {os.path.basename(W)}/{f} row {n}: {r.get('id')} {r.get('field')}: {why}")

# ---- --backfill: stamp the ledgers of already-APPLIED waves, land nothing -----------------------------------------------
if BACKFILL:
    for W in ARGS:
        D=f"{W}/delta/data"
        if not os.path.isdir(D) or not os.path.exists(f"{W}/APPLIED"): continue
        for f in sorted(os.listdir(D)):
            m=re.match(r"^([a-z]+)-(corrections|delete)-(.+)\.json$",f)
            if not m or os.path.exists(ledger_path(f"{D}/{f}")): continue
            kind,op,wing=m.groups()
            try: rows=load(f"{D}/{f}")
            except Exception: print(f"apply-shard-paths --backfill: {os.path.basename(W)}/{f}: not readable JSON; left"); continue
            if not isinstance(rows,list): continue
            nums=[n for n,r in enumerate(rows) if (is_path_row(r) if op=="corrections" else (isinstance(r,dict) and r.get("field")))]
            if not nums: continue
            # informational only: rows whose live path does not read `new` (corrections) or still holds `value` (deletes)
            odd=[]
            by={}
            import glob as _g
            for sp in [f"{M}/{wing}/{kind}.json"]+sorted(_g.glob(f"{M}/*/{kind}.json")):   # own wing first, then a record homed elsewhere
                if os.path.exists(sp):
                    for x in load(sp):
                        if isinstance(x,dict) and x.get("id") not in by: by[x.get("id")]=x
            for n in nums:
                r=rows[n]; rec=by.get(r.get("id"))
                try:
                    cur=get(rec,tokens(r["field"])) if rec is not None else None
                    bad=(cur!=r.get("new")) if op=="corrections" else (cur==r.get("value"))
                except Exception: bad=(op=="corrections")
                if bad: odd.append(n)
            ledger_write(f"{D}/{f}",set(nums),len(nums),{"backfilled":True,"not_new_at_backfill":odd})
            print(f"apply-shard-paths --backfill {os.path.basename(W)}/{f}: {len(nums)} row(s) stamped done"+(f"; {len(odd)} not reading new/removed at backfill: {odd[:20]}" if odd else ""))
    sys.exit(0)

for W in ARGS:
    D=f"{W}/delta/data"
    if not os.path.isdir(D): continue
    stats={"corr":0,"corr-skip":0,"del":0,"del-skip":0,"retire":0,"done-before":0}
    for f in sorted(os.listdir(D)):
        m=re.match(r"^([a-z]+)-corrections-(.+)\.json$",f)
        if m:
            kind,wing=m.groups(); sp=f"{M}/{wing}/{kind}.json"
            done,complete,edited=ledger_read(f"{D}/{f}")
            if complete: continue
            if edited: print(f"apply-shard-paths {os.path.basename(W)}/{f}: EDITED since its ledger was written — left whole, needs a ruling"); continue
            if not os.path.exists(sp): continue
            allrows=load(f"{D}/{f}")
            rows=[(n,r) for n,r in enumerate(allrows) if is_path_row(r)]
            if not rows: continue
            data=load(sp); by={r.get("id"):r for r in data if isinstance(r,dict)}; changed=False
            OTHER={}  # 2026-09-26: a record homed on one of the OTHER shards of this kind (tom-adler: nfw, with a cswa tenure)
            done0=len(done)
            for n,r in rows:
                if n in done: stats["done-before"]+=1; continue
                rec=by.get(r["id"]); tgt=None
                if rec is None:
                    import glob as _g
                    for osp in sorted(_g.glob(f"{M}/*/{kind}.json")):
                        if osp==sp: continue
                        if osp not in OTHER:
                            od=load(osp); OTHER[osp]=[od,{x.get("id"):x for x in od if isinstance(x,dict)},False]
                        if r["id"] in OTHER[osp][1]: rec=OTHER[osp][1][r["id"]]; tgt=osp; break
                if rec is None: stats["corr-skip"]+=1; continue
                try: toks=tokens(r["field"])
                except Exception: stats["corr-skip"]+=1; say(W,f,n,r,"unparseable path"); continue
                last=toks[-1]
                # an `old: null` whole-element row on a list index is an APPEND, anchored on its own value
                try: parent=get(rec,toks[:-1])
                except Exception: parent=None
                if r.get("old") is None and isinstance(parent,list) and isinstance(last,int):
                    if r["new"] in parent: done.add(n); continue                      # already there: never twice
                    if last==len(parent):
                        parent.append(r["new"]); stats["corr"]+=1; done.add(n)
                        if tgt: OTHER[tgt][2]=True
                        else: changed=True
                    else:
                        stats["corr-skip"]+=1; say(W,f,n,r,f"append slot moved (list length {len(parent)}, row wrote [{last}]) — not appended; needs a ruling")
                    continue
                try: cur=get(rec,toks)
                except Exception:
                    # 2026-09-26: old=null on a key that does not exist yet is a NEW KEY
                    if r.get("old") is None and isinstance(parent,dict) and isinstance(last,str) and last not in parent:
                        if not anchor_ok(rec,toks,r): stats["corr-skip"]+=1; say(W,f,n,r,"anchor does not match the element at that index — not landed"); continue
                        parent[last]=r["new"]; stats["corr"]+=1; done.add(n)
                        if tgt: OTHER[tgt][2]=True
                        else: changed=True
                        continue
                    stats["corr-skip"]+=1; continue
                if cur==r.get("new"): done.add(n); continue
                if cur!=r.get("old"): stats["corr-skip"]+=1; continue
                if not anchor_ok(rec,toks,r): stats["corr-skip"]+=1; say(W,f,n,r,"anchor does not match the element at that index — not landed"); continue
                setp(rec,toks,r["new"]); stats["corr"]+=1; done.add(n)
                if tgt: OTHER[tgt][2]=True
                else: changed=True
            if changed: save(sp,data)
            for osp,(od,_ob,och) in OTHER.items():
                if och: save(osp,od)
            if len(done)!=done0 or not os.path.exists(ledger_path(f"{D}/{f}")): ledger_write(f"{D}/{f}",done,len(rows))
    for f in sorted(os.listdir(D)):
        m=re.match(r"^([a-z]+)-delete-(.+)\.json$",f)
        if m:
            kind,wing=m.groups(); sp=f"{M}/{wing}/{kind}.json"
            done,complete,edited=ledger_read(f"{D}/{f}")
            if complete: continue
            if edited: print(f"apply-shard-paths {os.path.basename(W)}/{f}: EDITED since its ledger was written — left whole, needs a ruling"); continue
            if not os.path.exists(sp): continue
            rows=[(n,r) for n,r in enumerate(load(f"{D}/{f}")) if isinstance(r,dict) and r.get("field")]
            data=load(sp); by={r.get("id"):r for r in data if isinstance(r,dict)}; changed=False
            done0=len(done)
            def idx(nr):
                t=tokens(nr[1]["field"]); return t[-1] if isinstance(t[-1],int) else -1
            for n,r in sorted(rows,key=idx,reverse=True):
                if n in done: stats["done-before"]+=1; continue
                rec=by.get(r["id"])
                if rec is None: stats["del-skip"]+=1; continue
                try: toks=tokens(r["field"]); parent=get(rec,toks[:-1]); i=toks[-1]
                except Exception: stats["del-skip"]+=1; continue
                if not isinstance(parent,list) or not isinstance(i,int) or i>=len(parent) or parent[i]!=r.get("value"): stats["del-skip"]+=1; continue
                del parent[i]; changed=True; stats["del"]+=1; done.add(n)
            if changed: save(sp,data)
            if len(done)!=done0 or not os.path.exists(ledger_path(f"{D}/{f}")): ledger_write(f"{D}/{f}",done,len(rows))
    # 2026-09-26 (wave-COORD-LOW-KOTDM-0926): a <kind>-retire.json for every registry kind, not characters only
    for _kind in ("characters","units","titles","reigns","shows","rps","awards"):
      rf=f"{D}/{_kind}-retire.json"
      if os.path.exists(rf):
        have=set(l.split("\t")[0] for l in open(RET) if l.strip() and not l.startswith("#")) if os.path.exists(RET) else set()
        for r in load(rf):
            rid=r.get("id")
            # find the shard that holds it
            for w in os.listdir(M):
                sp=f"{M}/{w}/{_kind}.json"
                if not os.path.exists(sp): continue
                data=load(sp); n=len(data); data=[x for x in data if not (isinstance(x,dict) and x.get("id")==rid)]
                if len(data)!=n: save(sp,data); stats["retire"]+=1
            if rid and rid not in have and not DRY:
                open(RET,"a").write(f"{rid}\t{r.get('reason','')}\t{datetime.date.today()}\n"); have.add(rid)
    print(("DRY " if DRY else "")+f"apply-shard-paths {os.path.basename(W)}: {stats}")
