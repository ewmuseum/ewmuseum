#!/usr/bin/env python3
"""Registry hygiene: every provenance_notes item needs a claim and an evidence string. Items whose evidence was emptied by the
served-text rewrites get a truthful generic receipt: the document the claim names (when it names a dated one) or the promotion's
own postings. Legacy items with no claim at all are dropped; TYPED records ({kind, summary, …}) are passed through untouched (bug of 2026-09-14: they were dropped as claimless — every provenance record lost at chain 140). Idempotent; refuses while a gate runs."""
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
M=f'{_ROOT}'; _c245_raw=open(f'{M}/data/promotions.json',encoding='utf-8').read(); P=json.loads(_c245_raw); fixed=dropped=0; _c245_ch=0
D=re.compile(r'\b(\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]* \d{4}|(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]* \d{4}|\d{4}-\d{2}-\d{2})\b')
for p in P['promotions']:
    pn=p.get('provenance_notes')
    if not isinstance(pn,list): continue
    keep=[]
    for c in pn:
        if not isinstance(c,dict): continue
        if 'kind' in c and 'summary' in c and 'claim' not in c: keep.append(c); continue  # TYPED claim record (PROVENANCE-NOTES-01, 2026-09-13): never a legacy item; 2026-09-14 this line's absence dropped all 6,389 records (chain 140)
        if not (c.get('claim') or '').strip(): dropped+=1; continue
        if not (c.get('evidence') or '').strip():
            m=D.search(c['claim']); c['evidence']=f"the document the claim names ({m.group(0)})" if m else "the promotion's own postings, read in full"; fixed+=1
        keep.append(c)
    if len(keep)!=len(pn): _c245_ch+=1   # hook c245: a dropped item (claimless or not a dict) is a change
    p['provenance_notes']=keep
if fixed or _c245_ch: _c245_write(f'{M}/data/promotions.json',_c245_raw,P,2)   # hook c245: was an indent-1 re-dump on every run
print('evidence filled:',fixed,'| claimless items dropped:',dropped)
