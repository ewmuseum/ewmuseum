#!/usr/bin/env python3
"""Standing preflight fixer (2026-09-12): a character/unit record whose tenures[0] lacks a promotion (a lane appended rows
without it — 43 VCW wrestlers at gate 134) gets the shard's own wing as its home promotion; a record with no tenures at all
is reported, not invented. Also promotes a single-element `winners` list on a match to `winner`. Idempotent."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,glob,os
M=f'{_ROOT}/data/shards'; fixed=0; noten=[]; win=0
for f in glob.glob(f'{M}/*/characters.json')+glob.glob(f'{M}/*/units.json'):
    wing=f.split('/')[-2]
    if wing=='_unassigned': continue
    d=json.load(open(f,encoding='utf-8'))
    if not isinstance(d,list): continue
    ch=False
    for r in d:
        if not isinstance(r,dict): continue
        t=r.get('tenures')
        if isinstance(t,list) and t and isinstance(t[0],dict) and not t[0].get('promotion'): t[0]['promotion']=wing; ch=True; fixed+=1
        elif not t and 'tenures' in r: noten.append(r.get('id'))
    if ch: json.dump(d,open(f,'w',encoding='utf-8'),ensure_ascii=False,indent=1); open(f,'a').write('\n')
for f in glob.glob(f'{M}/*/shows.json'):
    d=json.load(open(f,encoding='utf-8'))
    if not isinstance(d,list): continue
    ch=False
    for s in d:
        for m in (s.get('matches') or []) if isinstance(s,dict) else []:
            w=m.get('winners')
            if isinstance(w,list) and len(w)==1: m['winner']=w[0]; del m['winners']; ch=True; win+=1
    if ch: json.dump(d,open(f,'w',encoding='utf-8'),ensure_ascii=False,indent=1); open(f,'a').write('\n')
print(f'fix-tenure-promotion: home promotions set {fixed} | records with no tenures {len(noten)} | single winners promoted {win}')
