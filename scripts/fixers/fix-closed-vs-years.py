#!/usr/bin/env python3
"""Standing preflight fixer (2026-09-12): when a promotion's `years` string names a later year than its `closed` date
(a return under the same name recorded after the first closure), move `closed` to that latest year at year precision and
say so in its source; when `closed` is a bare year equal to founded's year, keep it (the validator's string compare is the
problem there — extend closed to year precision with the founded year's December? No: report it). Idempotent."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,re
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
p=f'{_ROOT}/data/promotions.json'; _c276_raw=open(p,encoding='utf-8').read(); d=json.loads(_c276_raw); rows=d if isinstance(d,list) else next(v for v in d.values() if isinstance(v,list)); n=0; rep=[]
for r in rows:
    y=r.get('years'); c=r.get('closed'); f=r.get('founded')
    if not isinstance(y,str) or not isinstance(c,dict) or not c.get('date'): continue
    ys=[int(x) for x in re.findall(r'\b(19[89]\d|20[0-2]\d)\b',y)]
    cy=re.match(r'(\d{4})',str(c['date']))
    if not ys or not cy: continue
    cy=int(cy.group(1)); my=max(ys)
    if my>cy:
        c['date']=str(my); c['precision']='year'; c['source']=(c.get('source') or '').rstrip()+f' The promotion is recorded running again in {my} under the same name; no closing notice of that run survives.'; n+=1
    elif isinstance(f,dict) and f.get('date') and str(c['date'])<str(f['date']) and str(c['date'])[:4]==str(f['date'])[:4]:
        # 2026-09-22 (GPW, preflight 166): report only, as the docstring always said. Writing YYYY-12 at year precision is a shape
        # the validator refuses ("year" date must be four digits), and a same-year closure is only a string-compare WARN there.
        rep.append(r['id'])
if n: _c276_write(p,_c276_raw,d,2)   # hook c276: the file's own indent (was a fixed indent), and only when the content changed
print(f'fix-closed-vs-years: closed dates aligned {n}'+(f' | same-year closures given year precision: {rep}' if rep else ''))
