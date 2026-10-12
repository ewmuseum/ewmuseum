#!/usr/bin/env python3
"""SCHEMA sharding rule: a character filed under data/shards/_unassigned/ whose first tenure names a held wing belongs in that
wing's shard (id unchanged; references hold). Moves every such record. Idempotent; refuses while a gate runs."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,glob,os,subprocess,sys
if _live_running("scripts/gate[.]sh", _ROOT): sys.exit("REFUSED: a gate is running")
M=f'{_ROOT}'
P={p['id'] for p in json.load(open(f'{M}/data/promotions.json',encoding='utf-8'))['promotions']}
up=f'{M}/data/shards/_unassigned/characters.json'; U=json.load(open(up,encoding='utf-8')); keep=[]; moved=0
for r in U:
    t=(r.get('tenures') or [{}])[0]; w=t.get('promotion') if isinstance(t,dict) else None
    if w and w in P and os.path.isdir(f'{M}/data/shards/{w}'):
        sp=f'{M}/data/shards/{w}/characters.json'
        try: Sh=json.load(open(sp,encoding='utf-8'))
        except FileNotFoundError: Sh=[]
        if not any(x.get('id')==r['id'] for x in Sh): Sh.append(r)
        json.dump(Sh,open(sp,'w',encoding='utf-8'),ensure_ascii=False,indent=1); open(sp,'a').write('\n'); moved+=1; print('refiled',r['id'],'→',w)
    else: keep.append(r)
json.dump(keep,open(up,'w',encoding='utf-8'),ensure_ascii=False,indent=1); open(up,'a').write('\n'); print('moved',moved,'| remaining unassigned',len(keep))
