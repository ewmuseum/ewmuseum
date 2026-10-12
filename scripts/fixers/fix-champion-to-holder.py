#!/usr/bin/env python3
"""Standing preflight fixer (2026-09-22, preflight 167: 18 niwf-1998 reigns + 1 ttw-2002): a reign a lane wrote with a
"champion" id (string or list) instead of the schema's "holder": [{"id": ...}] fails registry-validate ("needs id, title and
a holder array"). Rewrites champion -> holder in the same shape every live reign uses; a row that already has a holder list
is left alone. Idempotent."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,glob
n=0
for sf in glob.glob(f'{_ROOT}/data/shards/*/reigns.json'):
    try: R=json.load(open(sf,encoding='utf-8'))
    except Exception: continue
    if not isinstance(R,list): continue
    ch=False
    for r in R:
        if isinstance(r,dict) and not isinstance(r.get('holder'),list) and (r.get('champion') or r.get('champions')):
            c=r.pop('champion',None) or r.pop('champions',None); r.pop('champions',None); ids=c if isinstance(c,list) else [c]
            r['holder']=[x if isinstance(x,dict) else {'id':x} for x in ids]; ch=True; n+=1
    if ch: json.dump(R,open(sf,'w',encoding='utf-8'),ensure_ascii=False,indent=1); open(sf,'a').write('\n')
print(f'fix-champion-to-holder: reigns rewritten {n}')
