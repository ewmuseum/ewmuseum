#!/usr/bin/env python3
"""Standing preflight step (2026-09-14): for every READY/APPLIED wave in the workshop trees, append documents-append rows whose
page has NO row in museum/data/documents.json (never replaces an existing row, so later doc_class corrections survive).
Exists because rows appended in earlier windows were lost when documents.json was overwritten, while the .APPLIED markers
stayed and blocked re-application. Idempotent."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,glob,os,sys,subprocess
if _live_running("^(sh -c )?node scripts/(privacy-check|cross-reference|validate|registry-validate|build-data)", _ROOT):
    print("apply-documents-missing: gate/render running — skipped"); sys.exit(0)
A=f'{_WORKSHOP}'; DOCS=f'{_ROOT}/data/documents.json'
reg=json.load(open(DOCS)); rows=reg['documents']; pages={r.get('page') for r in rows}
def norm(p): return p if p.startswith('/') else '/'+p
trees=glob.glob(f'{A}/usenet-retro/scratch-*/wave-*')+glob.glob(f'{A}/url-walk/waves/wave-*')+glob.glob(f'{A}/pt-scene/wave-*')+glob.glob(f'{A}/fwrestling-census/waves/wave-*')+glob.glob(f'{A}/geocities-torrent/waves/wave-*')
added=0; files=0
for W in trees:
    if not (os.path.exists(f'{W}/READY') or os.path.exists(f'{W}/APPLIED')): continue
    for f in glob.glob(f'{W}/delta/data/documents-append-*.json'):
        try: new=json.load(open(f))
        except Exception: continue
        if not isinstance(new,list): continue
        for r in new:
            if not isinstance(r,dict) or not r.get('page'): continue
            pg=norm(r['page'])
            if pg in pages or r['page'] in pages: continue
            # only append if the served page actually exists (a row for a missing page reds validate-documents)
            if not os.path.exists(f'{_ROOT}'+pg): continue
            r=dict(r); r['page']=pg; rows.append(r); pages.add(pg); added+=1; files+=1
if added:
    json.dump(reg,open(DOCS,'w'),ensure_ascii=False,indent=1); open(DOCS,'a').write('\n')
print('apply-documents-missing: appended',added,'rows for served pages that had none')
