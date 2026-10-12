#!/usr/bin/env python3
"""Standing preflight fixer (2026-09-12): a correction row whose `new` is the literal "__REMOVE__" means "drop the field";
apply-corrections wrote the sentinel into the registry once (hwf-acwdwfmerger-1996.full_name). Delete any field holding it."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json
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
for p in (f'{_ROOT}/data/promotions.json',f'{_ROOT}/data/frontier.json'):
    _c276_raw=open(p,encoding='utf-8').read(); d=json.loads(_c276_raw); rows=d['rows'] if p.endswith('frontier.json') else (d if isinstance(d,list) else next(v for v in d.values() if isinstance(v,list))); n=0   # hook c277: frontier.json's first list is _kind_values (strings), so its rows are named
    for r in rows:
        if not isinstance(r,dict): continue
        for k in [k for k,v in r.items() if v=='__REMOVE__']: del r[k]; n+=1
    if n: _c276_write(p,_c276_raw,d,2 if p.endswith('promotions.json') else 1)   # hook c276: the file's own indent (was a fixed indent), and only when the content changed
    print(f'fix-remove-sentinel: {p.split("/")[-1]} fields dropped {n}')
