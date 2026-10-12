#!/usr/bin/env python3
"""Standing preflight fixer (2026-09-12): frontier rows' community_presence must be a list of {hub, first_seen, last_seen, source}
objects (registry-validate crashes with a TypeError on a bare string — gate 133 preflights b/c/d). A string entry that names the
fantasy newsgroup becomes an rspwf presence object carrying the text as its source (years parsed from the text); any other string
moves to the row's notes. Idempotent; gate-guarded by the caller."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,re
P=f'{_ROOT}/data/frontier.json'
d=json.load(open(P,encoding='utf-8'))
rows=d if isinstance(d,list) else d.get('rows') or next(v for v in d.values() if isinstance(v,list) and v and isinstance(v[0],dict))
fixed=0
for r in rows:
    cp=r.get('community_presence')
    if not isinstance(cp,list): continue
    out=[]
    for e in cp:
        if isinstance(e,dict): out.append(e); continue
        if not isinstance(e,str): fixed+=1; continue
        yrs=[int(y) for y in re.findall(r'\b(19[89]\d|20[0-2]\d)\b',e)]
        if re.search(r'rec\.sport\.pro-wrestling\.fantasy|rspwf|newsgroup',e,re.I):
            o={'hub':'rspwf','source':e}
            if yrs: o['first_seen']=min(yrs); o['last_seen']=max(yrs)
            out.append(o)
        else:
            r['notes']=((r.get('notes') or '').rstrip()+' '+e).strip()
        fixed+=1
    r['community_presence']=out
if fixed:
    json.dump(d,open(P,'w',encoding='utf-8'),ensure_ascii=False,indent=1); open(P,'a').write('\n')
print(f'fix-community-presence: entries repaired {fixed}')
