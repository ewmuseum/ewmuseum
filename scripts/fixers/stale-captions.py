#!/usr/bin/env python3
"""Standing window check (the Janitor 2026-09-12: the NCCW caption was written off one document and never refreshed):
list every wing whose caption_asof.evidence no longer matches its shard — served documents, shows, characters grew
since the caption was written. Writes the workshop's stale-captions.tsv (wing, written, then, now, served_docs) for a
captions lane; changes nothing in the museum."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,glob,os
M=f'{_ROOT}'; out=f'{_WORKSHOP}/desk/stale-captions.tsv'
d=json.load(open(f'{M}/data/promotions.json',encoding='utf-8')); rows=d if isinstance(d,list) else next(v for v in d.values() if isinstance(v,list))
def n(p):
    try:
        x=json.load(open(p,encoding='utf-8')); return len(x) if isinstance(x,list) else 0
    except Exception: return 0
stale=[]
for r in rows:
    ca=r.get('caption_asof') if isinstance(r.get('caption_asof'),dict) else {}; ev=ca.get('evidence') if isinstance(ca.get('evidence'),dict) else {}
    sid=r['id']; sh=f'{M}/data/shards/{sid}'
    now={'wrestlers':n(f'{sh}/characters.json'),'shows':n(f'{sh}/shows.json'),'rps':n(f'{sh}/rps.json'),'awards':n(f'{sh}/awards.json')}
    docs=len(glob.glob(f'{M}/promotions/{sid}/archive/*.html'))+len(glob.glob(f'{M}/promotions/{sid}/rp/*.html'))
    then={k:ev.get(k,0) for k in now}
    grew=sum(max(0,now[k]-then[k]) for k in now)
    if (ev and grew>=5) or (then.get('shows',0)==0 and now['shows']>=2) or (then.get('wrestlers',0)==0 and now['wrestlers']>=5):
        stale.append((sid,ca.get('written',''),json.dumps(then),json.dumps(now),docs))
stale.sort(key=lambda x:-x[4])
with open(out,'w',encoding='utf-8') as f:
    f.write('wing\tcaption_written\tevidence_then\tevidence_now\tserved_docs\n')
    for s in stale: f.write('\t'.join(map(str,s))+'\n')
print(f'stale-captions: {len(stale)} wings whose caption predates most of their holdings -> {out}')
