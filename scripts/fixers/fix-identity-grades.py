#!/usr/bin/env python3
"""Standing preflight fixer (2026-09-22, preflight 167: 48 "asserted" grades from the NIWF, MEW, SSW and TCW waves): an
identity[] entry whose grade is outside primary-source|user-attested|presumed fails registry-validate. A DISTINCT or
POSSIBLY guard takes "presumed" (it never merges). A presumed-same or merged entry is NOT relabelled — under the Janitor's
2026-09-22 probables ruling a presumed-same graded "presumed" merges, so those are reported for a human read. Idempotent."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,glob
OK={'primary-source','user-attested','presumed'}; n=0; held=[]
for sf in glob.glob(f'{_ROOT}/data/shards/*/*.json'):
    if '/_headers/' in sf: continue
    try: R=json.load(open(sf,encoding='utf-8'))
    except Exception: continue
    if not isinstance(R,list): continue
    ch=False
    for r in R:
        for i in (r.get('identity') or []) if isinstance(r,dict) else []:
            if isinstance(i,dict) and i.get('grade') not in OK:
                if i.get('assertion') in ('distinct','possibly'): i['grade']='presumed'; ch=True; n+=1
                else: held.append((r.get('id'),i.get('assertion'),i.get('grade')))
    if ch: json.dump(R,open(sf,'w',encoding='utf-8'),ensure_ascii=False,indent=1); open(sf,'a').write('\n')
print(f'fix-identity-grades: distinct/possibly guards regraded {n}' + (f' | NOT relabelled (read by hand): {held[:10]}' if held else ''))
