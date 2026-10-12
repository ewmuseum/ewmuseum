#!/usr/bin/env python3
"""Apply a wave's delta/data/promotions-append*.json to museum/data/promotions.json: rows whose id is absent are appended
(never replaces an existing wing). 2026-09-13: no chain or standing step applied these — the EHWA wing's record was
missing until appended by hand, leaving its characters' tenures dangling at preflight 140c. Idempotent."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,sys
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
P=f'{_ROOT}/data/promotions.json'
_c269_raw=open(P,encoding='utf-8').read(); d=json.loads(_c269_raw); ps=d if isinstance(d,list) else d['promotions']; have={p.get('id') for p in ps if isinstance(p,dict)}; n=0
for f in sys.argv[1:]:
    rows=json.load(open(f,encoding='utf-8')); rows=rows if isinstance(rows,list) else [rows]
    for r in rows:
        if isinstance(r,dict) and r.get('id') and r['id'] not in have: ps.append(r); have.add(r['id']); n+=1
if n: _c269_write(P,_c269_raw,d,2)   # hook c269: the file's own indent (was a fixed indent), and only when the content changed
print('promotions appended:',n)
