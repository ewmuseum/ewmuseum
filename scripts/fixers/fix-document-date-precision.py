#!/usr/bin/env python3
"""Standing (2026-09-14): documents.json rows whose document_date.date carries more resolution than its precision claims
(YYYY-MM-DD with precision month/year, YYYY-MM with precision year) get the precision the date actually has. Idempotent."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,re,sys,subprocess
if _live_running("^(sh -c )?node scripts/(privacy-check|cross-reference|validate|registry-validate|build-data)", _ROOT):
    print("fix-document-date-precision: gate/render running — skipped"); sys.exit(0)
P=f'{_ROOT}/data/documents.json'; d=json.load(open(P)); n=0
for r in d.get('documents',[]):
    dd=r.get('document_date') or {}; date=str(dd.get('date') or ''); prec=dd.get('precision')
    want=None
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}',date): want='exact'
    elif re.fullmatch(r'\d{4}-\d{2}',date): want='month'
    elif re.fullmatch(r'\d{4}',date): want='year'
    if prec=='day': dd['precision']='exact'; n+=1; continue
    if want and prec in ('exact','month','year') and prec!=want:
        # a coarser claimed precision with a finer date: trust the date (it came from the source header)
        if (prec=='month' and want=='exact') or (prec=='year' and want in ('exact','month')): dd['precision']=want; n+=1
if n: json.dump(d,open(P,'w'),indent=1,ensure_ascii=False); open(P,'a').write('\n')
print('fix-document-date-precision: fixed',n)
