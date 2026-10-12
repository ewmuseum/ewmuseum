#!/usr/bin/env python3
"""Standing (2026-09-14): shows[].matches[].eliminations[] entries written as strings ("Name (by Other, 10:50 elapsed)") become the
schema's objects {who, by?, time?, note?} — who/by keep the verbatim billed label (the eliminations escape hatch). Idempotent."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,glob,re,sys,subprocess
if _live_running("^(sh -c )?node scripts/(privacy-check|cross-reference|validate|registry-validate|build-data)", _ROOT):
    print("fix-eliminations-shape: gate/render running — skipped"); sys.exit(0)
def conv(s):
    s=s.strip(); who=s; by=None; time=None; note=None
    m=re.match(r'^(.*?)\s*\((.*)\)\s*$',s)
    if m:
        who=m.group(1).strip(); inner=m.group(2).strip()
        mb=re.match(r'^by\s+(.+?)(?:,\s*(.*))?$',inner)
        if mb:
            by=mb.group(1).strip(); rest=(mb.group(2) or '').strip()
            if rest:
                mt=re.match(r'^(\d{1,2}:\d{2}(?::\d{2})?)\s*(elapsed)?$',rest)
                if mt: time=mt.group(1)
                else: note=rest
        else: note=inner
    o={'who':who}
    if by:
        parts=[b.strip() for b in re.split(r'\s+(?:and|&)\s+',by) if b.strip()]
        o['by']=parts if len(parts)>1 else by
    if time: o['time']=time
    if note: o['note']=note
    return o
n=0
for p in glob.glob(f'{_ROOT}/data/shards/*/shows.json'):
    d=json.load(open(p)); ch=False
    for s in d:
        for m in (s.get('matches') or []) if isinstance(s,dict) else []:
            el=m.get('eliminations') if isinstance(m,dict) else None
            if isinstance(el,list) and any(isinstance(e,str) for e in el):
                m['eliminations']=[conv(e) if isinstance(e,str) else e for e in el]; n+=sum(1 for e in el if isinstance(e,str)); ch=True
    if ch: json.dump(d,open(p,'w'),indent=2,ensure_ascii=False); open(p,'a').write('\n')
print('fix-eliminations-shape: converted',n)
