#!/usr/bin/env python3
"""Apply a wave's delta/data/page-corrections.json ([{page, old, new, why}]) to served pages: each `old` must occur exactly once
in the page (byte-matched) or the row is skipped and reported. Usage: apply-page-corrections.py <file>. Idempotent per row
(a row whose `new` is already present and `old` absent counts as applied)."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,sys,os
M=f'{_ROOT}'; f=sys.argv[1]; rows=json.load(open(f,encoding='utf-8')); ok=skip=0
for r in rows:
    p=os.path.join(M,r['page'].lstrip('/'));  # 2026-10-05 c77: a leading-slash page joined to an absolute path and skipped (window 141)
    if not os.path.exists(p): print('missing page:',r['page']); skip+=1; continue
    s=open(p,encoding='utf-8').read()
    if r['old'] not in s:
        if r['new'] in s: ok+=1; continue
        print('old not found:',r['page'],'|',r['old'][:60]); skip+=1; continue
    if s.count(r['old'])!=1: print('old not unique:',r['page']); skip+=1; continue
    open(p,'w',encoding='utf-8').write(s.replace(r['old'],r['new'],1)); ok+=1
print(f'apply-page-corrections: {os.path.basename(os.path.dirname(os.path.dirname(os.path.dirname(f))))} applied {ok} | skipped {skip}')
sys.exit(1 if skip else 0)  # 2026-09-27 J38d: a partial apply must not be stamped .APPLIED
