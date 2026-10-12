#!/usr/bin/env python3
"""2026-09-13: doc-class corrections filed as page-corrections must also land in museum/data/documents.json (the
provenance block, incl. its data-doc-class, is re-rendered from that registry by fix-provenance-block.py).
Usage: apply-docclass-to-registry.py <page-corrections.json> [more…]  — idempotent; prints rows updated."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,re,sys
R=f'{_ROOT}/data/documents.json'
d=json.load(open(R,encoding='utf-8')); by={r['page']:r for r in d['documents']}; n=0; miss=0
for f in sys.argv[1:]:
    for row in json.load(open(f,encoding='utf-8')):
        m=re.search(r'data-doc-class="([a-z-]+)"',row.get('new',''))
        if not m: continue
        pg=row['page']; pg='/'+pg if not pg.startswith('/') else pg
        r=by.get(pg)
        if r is None: miss+=1; continue
        if r.get('doc_class')!=m.group(1): r['doc_class']=m.group(1); n+=1
if n: json.dump(d,open(R,'w',encoding='utf-8'),indent=1,ensure_ascii=False); open(R,'a').write('\n')
print(f'documents.json doc_class updated: {n} | pages not in registry: {miss}')
