#!/usr/bin/env python3
"""Standing (2026-09-14): delete generated entity pages (characters/<id>.html, units/<id>.html, titles/<id>.html) whose id no longer
resolves to a registry record (retired or renamed ids). Generated pages regenerate from the registry; an orphan reds the gate. Idempotent.
(hook c230, lane D270-HONOURS-REBASE, 2026-10-09; desk D270) awards/<id>.html too, judged against the award ids ALONE: an
honour re-filed as a title keeps its id, so a pooled id set would leave its old award page standing. characters/, units/ and
titles/ pages are judged as before, against the ids of all three kinds."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,glob,os,sys,subprocess
if _live_running("^(sh -c )?node scripts/(privacy-check|cross-reference|validate|registry-validate|build-data)", _ROOT):
    print("fix-orphan-entity-pages: gate/render running — skipped"); sys.exit(0)
M=f'{_ROOT}'
ids=set()
for kind in ('characters','units','titles'):
    for f in glob.glob(f'{M}/data/shards/*/{kind}.json'):
        try: ids.update(r.get('id') for r in json.load(open(f)) if isinstance(r,dict))
        except Exception: pass
award_ids=set()   # hook c230: award pages are judged against award ids alone
for f in glob.glob(f'{M}/data/shards/*/awards.json'):
    try: award_ids.update(r.get('id') for r in json.load(open(f)) if isinstance(r,dict))
    except Exception: pass
n=0
for kind in ('characters','units','titles','awards'):
    live = award_ids if kind == 'awards' else ids
    if kind == 'awards' and not award_ids: continue   # hook c230: no award shard read -> never remove award pages blind
    for p in glob.glob(f'{M}/{kind}/*.html'):
        i=os.path.basename(p)[:-5]
        if i in ('index',) or i not in live:
            if i=='index': continue
            os.remove(p); n+=1; print('removed orphan',kind,i)
print('fix-orphan-entity-pages: removed',n)
