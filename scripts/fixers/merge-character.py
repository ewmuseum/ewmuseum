#!/usr/bin/env python3
"""Merge an author-owned original character held as two records (the Janitor 2026-09-10: originals merge across promotions;
portrayal records are only for characters the author does not own). Usage: merge-character.py SURVIVOR RETIRED [--dry]
  - the retired record's tenures join the survivor's (every distinct stint kept, two at one promotion stay two; only a true
    duplicate collapses, hook c129), its name joins the survivor's aka,
    its identity entries fold in (the pair's own presumed-same entry is dropped -- hook c141 first files that entry's note on the
    survivor's wing as a typed provenance_notes record, scripts/fixers/merge_evidence.py; hook c143 drops only the folded id, so an
    entry naming the pair ALONGSIDE other ids keeps its readings about those), the retired row is removed from its shard,
  - an alias {from: RETIRED, to: SURVIVOR} is appended to data/aliases.json,
  - every reference museum-wide (shards, served pages, external figures, affiliations) is repointed,
  - still-queued waves (wave dirs with READY but no APPLIED) are repointed too.
Idempotent; refuses while a gate runs; both ids must exist as live characters."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,glob,os,re,subprocess,sys
import merge_hygiene as _mh   # hook c281 (lane MERGE-HYGIENE, 2026-10-11): step 3 tidies the self-edges and doubled ids it makes
if _live_running("scripts/gate[.]sh", _ROOT): sys.exit("REFUSED: a gate is running")
A,B=sys.argv[1],sys.argv[2]; dry='--dry' in sys.argv; M=f'{_ROOT}'; W=f'{_WORKSHOP}'
def load(p): return json.load(open(p,encoding='utf-8'))
def dump(p,d):
    if dry: return
    # 2026-10-03 (GTT-PASS2-LANDPREP, hook c26): keep the file's OWN indent (shards are 1, 2 or 4; a fixed 1 reflowed a whole
    # indent-2 survivor shard on every merge into prime-2003, pcw or acw).
    _m=re.match(r'[\[{][ \t]*\n( +)\S',open(p,encoding='utf-8').read(256)); _i=len(_m.group(1)) if _m else 1
    json.dump(d,open(p,'w',encoding='utf-8'),ensure_ascii=False,indent=_i); open(p,'a').write('\n')
recs={}
for f in glob.glob(f'{M}/data/shards/*/characters.json'):
    for r in load(f):
        if isinstance(r,dict) and r.get('id') in (A,B): recs[r['id']]=(f,r)
if A not in recs or B not in recs: sys.exit(f'both must be live characters: {A} {A in recs}, {B} {B in recs}')
fa,a=recs[A]; fb,b=recs[B]
# 1. fold tenures, aka, identity
# hook c129 (2026-10-07, lane MERGE-KEEPS-TENURES): every distinct tenure is kept. Until c129 the fold kept ONE tenure per
# promotion, so a second stint at one fed was dropped when its record folded (anarky-epw: EPW 2007-04 and EPW 2009-02 to
# 2009-10, seen in lane IDENTITY-LEADS-1007's simulation). A retired tenure now collapses only into a TRUE duplicate: the same
# promotion, the same first_seen and last_seen (absent, empty and '?' read alike) and the same roles (role + roles[]; roles on
# one side only also match). The duplicate's richer fields are kept: the survivor's tenure keeps every value it has and gains
# each field only the retired one carries. Everything else is appended in the retired record's own order.
_EMPTY=(None,'','?',[],{})
def _tv(t,k): v=t.get(k); return '?' if v in _EMPTY else v
def _troles(t): return frozenset([x for x in (t.get('roles') or []) if isinstance(x,str)]+([t['role']] if isinstance(t.get('role'),str) and t['role'] else []))
def _tdup(x,y): return (x.get('promotion')==y.get('promotion') and _tv(x,'first_seen')==_tv(y,'first_seen') and _tv(x,'last_seen')==_tv(y,'last_seen')
                        and (_troles(x)==_troles(y) or not _troles(x) or not _troles(y)))
# hook c283 (2026-10-11, lane HOOK-C283, wave SIGS-MERGES-1011): a record's identity or tenures present but null is read as empty. dict.get(k,[])
# returns None for it, and `for i in None` raised a TypeError that merge-batch.py's subprocess call swallowed (6 folds stopped silently).
for t in (b.get('tenures') or []):
    hit=next((u for u in (a.get('tenures') or []) if isinstance(u,dict) and _tdup(u,t)),None) if isinstance(t,dict) else None
    if hit is None:
        if t not in (a.get('tenures') or []): a['tenures']=list(a.get('tenures') or [])+[t]   # hook c283: a null tenures has no setdefault list to append to
        continue
    for k,v in t.items():
        if v not in _EMPTY and hit.get(k) in _EMPTY: hit[k]=v
for nm in [b.get('name')]+list(b.get('aka') or []):
    if nm and nm!=a.get('name') and nm not in (a.get('aka') or []): a['aka']=list(a.get('aka') or [])+[nm]   # 2026-10-08: a survivor with "aka": null crashed setdefault (VERIFY-JOLT-OURSIDE-1: sepiroth-du-luc)
# hook c141 (2026-10-08, lane MERGE-EVIDENCE): the pair's own presumed-same / merged entries are about to be dropped below, and with
# them the two-sided evidence (after wave-IDENTITY-LEADS-1008B, mike-extreme ended with no identity list). File the best of them on the
# survivor's WING row (a character row has no provenance_notes) as a typed identity-guard record, the full note in the workshop
# narrative; idempotent. Nothing is written until this succeeds: a filing that raises refuses the merge, it does not lose the note.
import datetime as _dt
try:
    import merge_evidence as _me
    _EVID=_me.carry(M,W,A,os.path.basename(os.path.dirname(fa)),B,_me.fold_rows(a.get('identity'),b.get('identity'),A,B),_dt.date.today().isoformat(),dry)
except Exception as _e: sys.exit(f'REFUSED: the pair evidence could not be filed ({_e}); nothing merged')
# hook c143 (2026-10-08, lane APPLIER-DEBT): only the FOLDED ID goes. Until now an entry naming B alongside other ids was dropped
# whole on the survivor's side (with: [B, C] lost the reading about C), and so was an entry naming A on the retired side; one pair's
# fold threw away every other id those entries carried. B is now removed from the survivor's entries and A from the retired record's,
# every other id is kept, and an entry left with no ids at all is dropped as before (its evidence is filed above, hook c141). The
# stripped id is never remapped to its survivor: both lists end up ON the survivor's record, and fix-identity-unknown-ids.py drops a
# `with` naming the record itself. A stripped entry is appended after the untouched ones and only if no entry already names its set.
def _c143_drop(i, x):
    w=[y for y in (i.get('with') or []) if y!=x]
    if not w: return None
    j=dict(i); j['with']=w; return j
ida=[i for i in (a.get('identity') or []) if B not in (i.get('with') or [])]   # hook c283: a null identity reads as empty
for i in (a.get('identity') or []):
    if B not in (i.get('with') or []): continue
    j=_c143_drop(i,B)
    if j is None: continue
    if not any(set(j['with'])==set(k.get('with') or []) for k in ida): ida.append(j)
for i in (b.get('identity') or []):
    j=_c143_drop(i,A) if A in (i.get('with') or []) else i
    if j is None: continue
    if not any(set(j.get('with') or [])==set(k.get('with') or []) for k in ida): ida.append(j)
if ida: a['identity']=ida
elif 'identity' in a: del a['identity']
rows=load(fa); rows=[a if r.get('id')==A else r for r in rows]; dump(fa,rows)
rb=load(fb); rb=[r for r in rb if r.get('id')!=B]; dump(fb,rb)
# 2. alias
ap=f'{M}/data/aliases.json'; Al=load(ap)
if not any(x.get('from')==B for x in Al['aliases']): Al['aliases'].append({'from':B,'to':A,'note':'merged: one author-owned character held across promotions (2026-09-10)'}); dump(ap,Al)
# 3. repoint museum-wide + queued waves
n=0; _C281=[[],0]   # hook c281: self-edges removed, doubled ids removed
# 2026-09-27: references only, never prose (the bare-word pattern rewrote served verbatim text; see repoint-retired.py).
_E=re.escape(B)
REF=[re.compile(r'(/(?:characters|units)/)('+_E+r')(\.html)'), re.compile(r'(data-entity=")('+_E+r')(")'),
     re.compile(r'([?&][a-z_]+=)('+_E+r')((?=["&#\s]))')]
JSTR=re.compile(r'(")('+_E+r')(")')
files=[f for f in glob.glob(f'{M}/data/shards/*/*.json')+glob.glob(f'{M}/promotions/**/*.html',recursive=True)+glob.glob(f'{M}/data/*.json') if not f.endswith('aliases.json')]
for w in glob.glob(f'{W}/usenet-retro/scratch-*/wave-*/')+glob.glob(f'{W}/pt-scene/wave-*/')+glob.glob(f'{W}/fwrestling-census/waves/wave-*/')+glob.glob(f'{W}/desk/argyle/waves/wave-*/'):
    if os.path.exists(w+'READY') and not os.path.exists(w+'APPLIED'): files+=glob.glob(w+'delta/**/*.json',recursive=True)+glob.glob(w+'delta/**/*.html',recursive=True)
for f in files:
    try: s=open(f,encoding='utf-8').read()
    except Exception: continue
    k=0; _s0=s
    for rx in (REF+[JSTR] if f.endswith('.json') else REF):
        s,kk=rx.subn(lambda m: m.group(1)+A+m.group(3),s); k+=kk
    if k:
        # hook c281: when both ids of the pair sat in one place, the repoint left a relationship a == b (removed, logged by id)
        # or the survivor twice in one list (later copies removed, first kept); cut from the text, the file's layout kept
        if f.endswith('.json'): s,_e,_d=_mh.tidy(_s0,s); _C281[0]+=_e; _C281[1]+=_d
        if not dry: open(f,'w',encoding='utf-8').write(s)
        n+=1
print(('DRY ' if dry else '')+f'merged {B} -> {A}: tenures {len(a.get("tenures") or [])}, aka {a.get("aka")}, files repointed {n}, evidence {_EVID}, {_mh.summary(*_C281)}')   # hook c281: the summary is merge-batch's log line
