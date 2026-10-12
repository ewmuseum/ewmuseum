#!/usr/bin/env python3
"""Remove the audit-trail claims apply-corrections.py appended to served provenance_notes for the served-text-rule batches
('<field> corrected from … (census 1990–1996 v2, 2026-09-04)' with evidence 'served-text rule, 10 September 2026'). Idempotent."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,re,subprocess,sys
def _c245_write(p, raw, obj, default_indent):
    """hook c245 (lane MERGE-EVIDENCE-FIX, 2026-10-10): write a registry file only when its bytes change, in the file's OWN
    indent (memory registry-json-indent: promotions.json 2, frontier.json 1), by an atomic rename. An indent-1 re-dump of
    promotions.json on every window made merge_evidence refuse every merged pair's evidence from 2026-10-08. True when written."""
    import os as _o, re as _r, json as _j
    m = _r.match(r"[\[{][ \t]*\n( +)\S", raw[:256])
    out = _j.dumps(obj, ensure_ascii=False, indent=len(m.group(1)) if m else default_indent) + "\n"
    if out == raw: return False
    tmp = "%s.c245.%d.tmp" % (p, _o.getpid())
    with open(tmp, "w", encoding="utf-8") as fh: fh.write(out)
    _o.chmod(tmp, _o.stat(p).st_mode & 0o7777); _o.replace(tmp, p); return True
if _live_running("scripts/gate[.]sh", _ROOT): sys.exit("REFUSED: a gate is running")
M=f'{_ROOT}'; _c245_raw=open(f'{M}/data/promotions.json',encoding='utf-8').read(); P=json.loads(_c245_raw); n=0
pat=re.compile(r'^(tier_source|closed|provenance_notes|depth|founded|years) corrected from ')
for p in P['promotions']:
    pn=p.get('provenance_notes')
    if not isinstance(pn,list): continue
    keep=[c for c in pn if not (isinstance(c,dict) and pat.match(c.get('claim','') or '') and 'served-text rule' in str(c.get('evidence','')))]
    if len(keep)!=len(pn): n+=len(pn)-len(keep); p['provenance_notes']=keep
if n: _c245_write(f'{M}/data/promotions.json',_c245_raw,P,2)   # hook c245: was an indent-1 re-dump on every run
print('audit claims stripped:',n)
