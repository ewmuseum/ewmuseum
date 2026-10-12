#!/usr/bin/env python3
"""Reign hygiene: end_how must be one of the enum. Maps finish words (pinned, submission, dq, countout, …) → lost-in-match; null/None/''
→ still-champion-at-record-end when no lost date is recorded, else lost-in-match. Idempotent; refuses while a gate runs.
c20 (2026-10-02): an ABSENT end_how on a row with an `end` date and no `lost` date stays absent (SCHEMA: unrecorded)."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,glob,subprocess,sys
if _live_running("scripts/gate[.]sh", _ROOT): sys.exit("REFUSED: a gate is running")
M=f'{_ROOT}'; OK={'lost-in-match','stripped','vacated','forfeited','awarded-on','retired','departed','still-champion-at-record-end'}
FIN={'pinned','pinfall','submission','submitted','dq','disqualified','countout','count-out','lost','beaten','defeated','knockout','ko'}
n=0
for f in glob.glob(f'{M}/data/shards/*/reigns.json'):
    R=json.load(open(f,encoding='utf-8')); ch=False
    for r in R:
        if not isinstance(r,dict): continue
        v=r.get('end_how')
        if v in OK: continue
        if 'end_how' not in r and isinstance(r.get('end'), dict) and r['end'].get('date') and not (r.get('lost') or {}).get('date'):
            continue   # c20 (2026-10-02, D216 S9): SCHEMA 'Absent means unrecorded' - a reign that ended without a losing match (an `end` date, no `lost`) keeps end_how absent
        if v is None or str(v).strip().lower() in ('','null','none'):
            r['end_how']='lost-in-match' if (r.get('lost') or {}).get('date') else 'still-champion-at-record-end'; ch=True; n+=1
        elif str(v).strip().lower() in FIN: r['end_how']='lost-in-match'; ch=True; n+=1
        elif 'end_how' in r: print('unmapped end_how',f.split('/')[-2],r.get('id'),repr(v))
    if ch: json.dump(R,open(f,'w',encoding='utf-8'),ensure_ascii=False,indent=1); open(f,'a').write('\n')
print('end_how fixed:',n)
