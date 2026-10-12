#!/usr/bin/env python3
"""Append a wave's delta/data/collections-rows.json rows to museum/data/collections.json (ids not already present). Idempotent.
Usage: apply-collections-rows.py <wave dir> [<wave dir>…]"""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,sys,os
def _c269_write(p, raw, obj, default_indent):
    """hook c269 (lane MERGE-EVIDENCE-WINDOW-A, 2026-10-10), c245's _c245_write for the window-A appliers: write a registry
    file only when its bytes change, in the file's OWN indent (memory registry-json-indent: promotions.json 2,
    collections.json and frontier.json 1), by an atomic rename. A window-A re-dump at indent 1 made merge_evidence refuse the
    same window's merged pairs ("refused-indent", merge-batch 2026-10-10 lines 122 and 172). True when written."""
    import os as _o, re as _r, json as _j
    m = _r.match(r"[\[{][ \t]*\n( +)\S", raw[:256])
    out = _j.dumps(obj, ensure_ascii=False, indent=len(m.group(1)) if m else default_indent) + "\n"
    if out == raw: return False
    tmp = "%s.c269.%d.tmp" % (p, _o.getpid())
    with open(tmp, "w", encoding="utf-8") as fh: fh.write(out)
    _o.chmod(tmp, _o.stat(p).st_mode & 0o7777); _o.replace(tmp, p); return True
M=f'{_ROOT}/data/collections.json'
_c269_raw=open(M,encoding='utf-8').read(); C=json.loads(_c269_raw); rows=C if isinstance(C,list) else C.get('collections') or C.get('lots'); have={r['id'] for r in rows}; n=0
for w in sys.argv[1:]:
    p=os.path.join(w,'delta/data/collections-rows.json')
    if not os.path.exists(p): continue
    for r in json.load(open(p,encoding='utf-8')):
        if r['id'] in have: continue
        rows.append({k:r[k] for k in ('id','kind','blurb','note') if k in r}); have.add(r['id']); n+=1; print('collection added',r['id'],'from',w.split('/')[-1])
# 2026-09-26 (preflight 189 red): lots must stay in true acquisition order, parsed as integers. Waves land out of lot order
# (0168, 0166, 0162 in one window), so after appending, re-sort numerically. A stable sort, so equal or non-numeric ids keep their place.
_before=[r['id'] for r in rows]
rows.sort(key=lambda r: (0, int(r['id'])) if str(r.get('id','')).isdigit() else (1, 0))
if n or [r['id'] for r in rows]!=_before: _c269_write(M,_c269_raw,C,1)   # hook c269: the file's own indent (was a fixed indent), and only when the content changed
print('collections appended:',n)
