#!/usr/bin/env python3
"""One-off (2026-09-12): wave-NWWF-READ-01 filed collection lot 0156 but stamped its GeoCities-derived records with the 1997 Usenet lot 0148.
Re-points nwwf-national-1997's GeoCities source and its shard records to 0156; the Usenet-walk source keeps 0148. Idempotent; scoped to the one wing."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,glob,os
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
M=f'{_ROOT}'
P=f'{M}/data/promotions.json'; _c276_raw=open(P,encoding='utf-8').read(); d=json.loads(_c276_raw); rows=d if isinstance(d,list) else next(v for v in d.values() if isinstance(v,list)); n=0
for r in rows:
    if r['id']!='nwwf-national-1997': continue
    for s in r.get('sources',[]):
        if s.get('accession')=='0148' and 'geocities' in (s.get('identifier') or '').lower(): s['accession']='0156'; n+=1
if n: _c276_write(P,_c276_raw,d,2)   # hook c276: the file's own indent (was a fixed indent), and only when the content changed
m=0
for f in glob.glob(f'{M}/data/shards/nwwf-national-1997/*.json'):
    s=open(f,encoding='utf-8').read(); t=s.replace('"accession": "0148"','"accession": "0156"')
    if t!=s: open(f,'w',encoding='utf-8').write(t); m+=t.count('"0156"')-s.count('"0156"')
print(f'fix-nwwf-lot: registry sources repointed {n}; shard stamps repointed {m}')
