#!/usr/bin/env python3
"""Standing (2026-09-14): a unit record with no members[] and no membership_unknown flag gets membership_unknown: true
(the registry's honest-gap shape). Minted award/ranking recipients that are teams often know only the team name. Idempotent."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,glob,sys,subprocess
if _live_running("^(sh -c )?node scripts/(privacy-check|cross-reference|validate|registry-validate|build-data)", _ROOT):
    print("fix-units-membership-unknown: gate/render running — skipped"); sys.exit(0)
n=0
for p in glob.glob(f'{_ROOT}/data/shards/*/units.json'):
    d=json.load(open(p)); ch=False
    for u in d:
        if isinstance(u,dict) and not u.get('members') and not u.get('membership_unknown'):
            u['membership_unknown']=True; n+=1; ch=True
    if ch: json.dump(d,open(p,'w'),indent=2,ensure_ascii=False); open(p,'a').write('\n')
print('fix-units-membership-unknown: flagged',n)
