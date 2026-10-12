#!/usr/bin/env python3
"""Standing (2026-09-14): every promotion id (and _unassigned) must carry all seven shard files; a freshly minted wing gets empty arrays. Idempotent."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,os,sys,subprocess
if _live_running("^(sh -c )?node scripts/(privacy-check|cross-reference|validate|registry-validate|build-data)", _ROOT):
    print("fix-missing-shard-files: gate/render running — skipped"); sys.exit(0)
M=f'{_ROOT}'; d=json.load(open(f'{M}/data/promotions.json')); P=d['promotions'] if isinstance(d,dict) else d
ids=[p['id'] for p in P if isinstance(p,dict) and p.get('id')]+['_unassigned']; n=0
for i in ids:
    dd=f'{M}/data/shards/{i}'; os.makedirs(dd,exist_ok=True)
    for kind in ('characters','units','shows','rps','reigns','titles','awards'):
        f=f'{dd}/{kind}.json'
        if not os.path.exists(f): open(f,'w').write('[]\n'); n+=1
print('fix-missing-shard-files: created',n)
