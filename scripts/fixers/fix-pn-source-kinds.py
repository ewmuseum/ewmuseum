#!/usr/bin/env python3
"""Standing preflight fixer (2026-09-22, cycle 166: hiwf-entity-e-1998): a provenance_notes record's sources[] row typed
"usenet-post" — the PROMOTION sources[] kind, which lanes carry over — is written in the record shape validate-provenance-notes
knows: {"kind": "newsgroup", "newsgroup": <the group>, "msg_id": <its identifier>}. Only provenance_notes are touched; a
promotion's own sources[] keeps "usenet-post". Idempotent."""
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
p=f'{_ROOT}/data/promotions.json'; _c276_raw=open(p,encoding='utf-8').read(); d=json.loads(_c276_raw); n=0
for r in d['promotions']:
    for rec in r.get('provenance_notes') or []:
        for i,s in enumerate((rec.get('sources') or []) if isinstance(rec,dict) else []):
            if isinstance(s,dict) and s.get('kind')=='usenet-post':
                ident=s.get('msg_id') or s.get('identifier') or ''
                ng=s.get('newsgroup') or 'rec.sport.pro-wrestling.fantasy'
                new={'kind':'newsgroup','newsgroup':ng,'msg_id':ident}
                if s.get('url'): new['url']=s['url']
                rec['sources'][i]=new; n+=1
if n: _c276_write(p,_c276_raw,d,2)   # hook c276: the file's own indent (was a fixed indent), and only when the content changed
print(f'fix-pn-source-kinds: provenance sources retyped {n}')
