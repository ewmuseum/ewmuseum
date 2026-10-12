#!/usr/bin/env python3
"""aka collision (gate 119b): gyeah.aka carried "GW", which is the name of two other promotions (gw, gw-global-inc-1999).
An aka may not equal another promotion's own name (collision doctrine); drop it and keep the fact in notes. Idempotent."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json
def _c245_write(p, raw, obj, default_indent):
    """hook c245 (lane MERGE-EVIDENCE-FIX, 2026-10-10): write a registry file only when its bytes change, in the file's OWN
    indent (memory registry-json-indent: promotions.json 2, frontier.json 1), by an atomic rename. An indent-1 re-dump of
    promotions.json on every window made merge_evidence refuse every merged pair's evidence from 2026-10-08. True when written."""
    import os as _o, re as _r, json as _j
    m = _r.match(r"[\[{][ \t]*\n( +)\S", raw[:256])
    out = _j.dumps(obj, ensure_ascii=False, indent=len(m.group(1)) if m else default_indent) + "\n"
    if out == raw: return False
    tmp = "%s.c245.%d.tmp" % (p, _o.getpid())
    with open(tmp, "w", encoding="utf-8") as fh: fh.write(out)
    _o.chmod(tmp, _o.stat(p).st_mode & 0o7777); _o.replace(tmp, p); return True
p=f'{_ROOT}/data/promotions.json'; _c245_raw=open(p,encoding='utf-8').read(); D=json.loads(_c245_raw); rows=D['promotions'] if isinstance(D,dict) else D
rows=rows if isinstance(rows,list) else list(rows.values()); ch=False
for r in rows:
    if isinstance(r,dict) and r.get('id')=='gyeah' and 'GW' in (r.get('aka') or []):
        r['aka']=[a for a in r['aka'] if a!='GW'] or None
        if r['aka'] is None: del r['aka']
        note=(r.get('notes') or '').rstrip(); add='Its own posts also shorten the name to "GW", a short form shared with unrelated promotions and not treated as an alias.'
        if add not in note: r['notes']=(note+' '+add).strip()
        ch=True
if ch: _c245_write(p,_c245_raw,D,2)   # hook c245: own indent (was a fixed indent of 1)
print('gyeah aka fixed' if ch else 'gyeah aka: nothing to do')
