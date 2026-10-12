#!/usr/bin/env python3
"""Standing preflight fixer (2026-09-22, preflight 167: 69 records from packet 67 and its siblings): a lane wrote
"promotions": [wing] where the schema wants tenures[], a key-dropping fixer then removed the unknown key, and the record was
left with NO tenure — registry-validate's shard assignment sends it to _unassigned. For every character/unit in a WING shard
with no tenures (missing, null or empty), build its tenure from the record's own appearances on that wing's show rows:
first/last show date, role "wrestler" when it stands on a match side, source the promotion's own cards. A record with no
appearance gets a bare tenure for its shard's wing (the wing it was filed under). A lane's own "promotions" list, if still
present, names the wing instead. Idempotent; never touches _unassigned."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,glob,os
n=0
for sf in glob.glob(f'{_ROOT}/data/shards/*/characters.json')+glob.glob(f'{_ROOT}/data/shards/*/units.json'):
    wing=sf.split('/')[-2]
    if wing.startswith('_'): continue
    try: R=json.load(open(sf,encoding='utf-8'))
    except Exception: continue
    if not isinstance(R,list): continue
    todo=[r for r in R if isinstance(r,dict) and r.get('id') and not r.get('tenures')]
    if not todo: continue
    try: S=json.load(open(f'{_ROOT}/data/shards/{wing}/shows.json',encoding='utf-8'))
    except Exception: S=[]
    seen={}; fought=set()
    for s in S if isinstance(S,list) else []:
        d=(s.get('date') or {}).get('date') if isinstance(s.get('date'),dict) else s.get('date')
        ids=set()
        for a in s.get('appearances') or []:
            w=a.get('who') if isinstance(a,dict) else a
            if isinstance(w,str): ids.add(w)
        for m in s.get('matches') or []:
            for side in m.get('sides') or []:
                for x in (side if isinstance(side,list) else [side]):
                    x=x.get('id') if isinstance(x,dict) else x
                    if isinstance(x,str): ids.add(x); fought.add(x)
        for i in ids:
            if d and d!='unknown': seen.setdefault(i,[]).append(str(d))
    for r in todo:
        prom=(r.pop('promotions',None) or [wing])
        prom=prom[0] if isinstance(prom,list) and prom else wing
        t={'promotion':prom}
        if r['id'] in fought: t['roles']=['wrestler']
        ds=sorted(seen.get(r['id'],[]))
        if ds: t['first_seen']=ds[0]; t['last_seen']=ds[-1]; t['source']="the promotion's own served cards"
        r['tenures']=[t]; n+=1
    json.dump(R,open(sf,'w',encoding='utf-8'),ensure_ascii=False,indent=1); open(sf,'a').write('\n')
print(f'fix-tenureless-records: tenures built {n}')
