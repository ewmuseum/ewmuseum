#!/usr/bin/env python3
"""Standing (2026-09-14): an award bestowal recipient whose id resolves to no record AND is listed in the workshop's retired-ids.tsv
becomes the redacted unminted entry (§2b — a retired real-name mint carries no honour). Unresolved ids NOT in retired-ids are left
for the validator to report. Idempotent."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,glob,sys,subprocess
if _live_running("^(sh -c )?node scripts/(privacy-check|cross-reference|validate|registry-validate|build-data)", _ROOT):
    print("fix-bestowals-retired: gate/render running — skipped"); sys.exit(0)
M=f'{_ROOT}'; RET=f'{_WORKSHOP}/desk/retired-ids.tsv'
retired={l.split('\t')[0] for l in open(RET) if l.strip() and not l.startswith('#')}
ids=set()
for f in glob.glob(f'{M}/data/shards/*/characters.json')+glob.glob(f'{M}/data/shards/*/units.json'):
    try: ids.update(x.get('id') for x in json.load(open(f)) if isinstance(x,dict))
    except Exception: pass
n=0
for f in glob.glob(f'{M}/data/shards/*/awards.json'):
    try: A=json.load(open(f))
    except Exception: continue
    if not isinstance(A,list): continue
    ch=False
    for a in A:
        if not isinstance(a,dict): continue
        for b in a.get('bestowals',[]) or []:
            for i,rc in enumerate(b.get('recipient',[]) or []):
                if isinstance(rc,dict) and rc.get('id') and rc['id'] not in ids and rc['id'] in retired:
                    b['recipient'][i]={'name':'[name withheld]','unminted':True}; ch=True; n+=1   # hook c208 (D480)
    if ch: json.dump(A,open(f,'w'),indent=2,ensure_ascii=False); open(f,'a').write('\n')
print('fix-bestowals-retired: rewritten',n)
