#!/usr/bin/env python3
"""Standing preflight fixer (2026-09-12): a reign whose `event` names a show id that exists in no shard gets a collected:false
stub show in the title's promotion shard (id, promotion, name from the id, the reign's won date), so the validator's
"event does not resolve" check passes and the reign keeps its provenance. Idempotent."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,glob,re,os
def rows(x):
    if isinstance(x,list): return [r for r in x if isinstance(r,dict)]
    if isinstance(x,dict):
        for v in x.values():
            if isinstance(v,list): return [r for r in v if isinstance(r,dict)]
    return []
M=f'{_ROOT}/data/shards'
shows={};
for f in glob.glob(M+'/*/shows.json'):
    for s in rows(json.load(open(f,encoding='utf-8'))): shows[s['id']]=f
titles={}
for f in glob.glob(M+'/*/titles.json'):
    for t in rows(json.load(open(f,encoding='utf-8'))): titles[t['id']]=(t.get('promotion'),f.rsplit('/',2)[1])
made=0
for f in glob.glob(M+'/*/reigns.json'):
    for r in rows(json.load(open(f,encoding='utf-8'))):
        ev=r.get('event')
        if not ev or ev in shows: continue
        promo,shard=titles.get(r.get('title'),(None,None)); shard=shard or f.rsplit('/',2)[1]; promo=promo or shard
        sf=f'{M}/{shard}/shows.json'; raw=json.load(open(sf,encoding='utf-8')) if os.path.exists(sf) else []
        if not isinstance(raw,list): print('skip non-list shows file',sf); continue
        L=raw
        won=(r.get('won') or {}) if isinstance(r.get('won'),dict) else {}
        name=re.sub(r'-(\d{4})-(\d{2})-(\d{2})$','',ev).replace('-',' ').title()
        stub={'id':ev,'promotion':promo,'name':name,'date':{'date':won.get('date') or 'unknown','precision':won.get('precision') or 'unknown','source':'named as the event of a title change in the promotion\'s own records; the card itself is not held'},'collected':False,'evidence':[{'source':f"the promotion's own title record: reign {r.get('id')} of {r.get('title')} names this event as where the title changed hands",'note':'the card itself is not held; the event exists here only as the venue of a recorded title change'}]}
        L.append(stub); json.dump(L,open(sf,'w',encoding='utf-8'),ensure_ascii=False,indent=1); open(sf,'a').write('\n'); shows[ev]=sf; made+=1; print('stub show',ev,'->',shard)
bf=0
for f in glob.glob(M+'/*/shows.json'):
    raw=json.load(open(f,encoding='utf-8'))
    if not isinstance(raw,list): continue
    ch=False
    for s_ in raw:
        if isinstance(s_,dict) and s_.get('collected') is False and not s_.get('evidence') and 'named as the event of a title change' in json.dumps(s_.get('date')):
            s_['evidence']=[{'source':"the promotion's own title record names this event as where a title changed hands",'note':'the card itself is not held; the event exists here only as the venue of a recorded title change'}]; ch=True; bf+=1
    if ch: json.dump(raw,open(f,'w',encoding='utf-8'),ensure_ascii=False,indent=1); open(f,'a').write('\n')
print('fix-orphan-reign-events: stubs created',made,'| evidence backfilled',bf)
