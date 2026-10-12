#!/usr/bin/env python3
"""Standing preflight step (2026-09-14, gate 141 run 6): drop documents.json rows that point at a page missing from the
museum tree AND are not present at HEAD (i.e. appended in this working tree by an earlier step for a wave not yet applied —
the apply step re-appends them from the wave's documents-append file when the pages land). Rows at HEAD are never touched."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,os,subprocess
M=f'{_ROOT}'
p=f'{M}/data/documents.json'
head=json.loads(subprocess.run(['git','-C',M,'show','HEAD:data/documents.json'],capture_output=True,text=True).stdout)
def rows(d): return d if isinstance(d,list) else d['documents']
headpages={r.get('page') for r in rows(head)}
d=json.load(open(p)); rs=rows(d)
keep=[]; dropped=[]
for r in rs:
    pg=r.get('page') or ''
    if pg and not os.path.exists(M+pg) and pg not in headpages: dropped.append(pg); continue
    keep.append(r)
if dropped:
    if isinstance(d,list): d=keep
    else: d['documents']=keep
    json.dump(d,open(p,'w'),indent=2,ensure_ascii=False); open(p,'a').write('\n')
print(f'fix-documents-orphan-rows: dropped {len(dropped)} row(s) for missing pages not at HEAD; kept {len(keep)}')
for pg in dropped[:8]: print('  ',pg)
