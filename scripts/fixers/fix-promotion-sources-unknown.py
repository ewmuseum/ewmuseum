#!/usr/bin/env python3
"""Standing (2026-09-14): drop promotion sources[] entries of kind "unknown" that carry no accession — they are workshop narration
("an earlier processing pass…"), not a source; the registry validator requires kind/identifier/window/accession. Idempotent."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,sys,subprocess
def _c276_write(p, raw, obj, default_indent):
    """hook c276 (lane PREFLIGHT-FIXERS-INDENT, 2026-10-11), c269's _c269_write for the preflight-only fixers: write a registry
    file only when its bytes change, in the file's OWN indent (memory registry-json-indent: promotions.json 2,
    collections.json and frontier.json 1, shards 1), by an atomic rename. A preflight re-dump at indent 1 reflowed the committed
    indent-2 promotions.json on every one-row fix. True when written."""
    import os as _o, re as _r, json as _j
    m = _r.match(r"[\[{][ \t]*\n( +)\S", raw[:256])
    out = _j.dumps(obj, ensure_ascii=False, indent=len(m.group(1)) if m else default_indent) + "\n"
    if out == raw: return False
    tmp = "%s.c276.%d.tmp" % (p, _o.getpid())
    with open(tmp, "w", encoding="utf-8") as fh: fh.write(out)
    _o.chmod(tmp, _o.stat(p).st_mode & 0o7777); _o.replace(tmp, p); return True
if _live_running("^(sh -c )?node scripts/(privacy-check|cross-reference|validate|registry-validate|build-data)", _ROOT):
    print("fix-promotion-sources-unknown: gate/render running — skipped"); sys.exit(0)
P=f'{_ROOT}/data/promotions.json'; _c276_raw=open(P,encoding='utf-8').read(); d=json.loads(_c276_raw); rows=d['promotions'] if isinstance(d,dict) else d; n=0
for r in rows:
    src=r.get('sources')
    if isinstance(src,list):
        keep=[s for s in src if not (isinstance(s,dict) and not s.get('accession') and (s.get('kind')=='unknown' or 'not re-crawled' in str(s.get('window','')) or 'processing pass' in str(s.get('identifier',''))))]
        if len(keep)!=len(src): r['sources']=keep; n+=len(src)-len(keep)
if n: _c276_write(P,_c276_raw,d,2)   # hook c276: the file's own indent (was a fixed indent), and only when the content changed
print('fix-promotion-sources-unknown: dropped',n)
