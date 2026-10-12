#!/usr/bin/env python3
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import csv, sys; csv.field_size_limit(sys.maxsize)
"""RETIRED from ORDER.txt 2026-09-22 after one run: it compared restored records by summary, so when a restored record's summary was later rewritten to pass validate-provenance-notes it appended the original again (five duplicates, preflight 165 run 5). Its one job is done (29 records restored) and apply-corrections.py now takes the {wing, record} shape itself. Kept for audit; do not re-add to ORDER.txt.
Original note (coordinator 2026-09-21): until today LANE-TEMPLATE-provenance-notes.md taught lanes a
{wing, record} row shape that apply-corrections.py silently skipped, so 29 typed provenance records from eight landed
waves (ATT-1995-1996, ATT-1998-H2, ATT-1999, C00-DEDICATED-EMWC/-PCWF/-UWF, C00-PACKET-134, C96-DEDICATED-AWI) never
reached data/promotions.json. apply-corrections.py now takes the shape; this restores what was skipped. For every
APPLIED wave's registry-corrections.json, each {wing, record} row whose record is not already on the wing's
provenance_notes (compared by kind + summary, else by whole record) is appended. Never removes or reorders."""
import json, glob, os
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
M = f'{_ROOT}/data/promotions.json'; _c276_raw = open(M, encoding='utf-8').read(); P = json.loads(_c276_raw)
rows = P if isinstance(P, list) else P['promotions']; by = {r.get('id'): r for r in rows}
seen = set(); added = 0; missing_wing = set()
for f in sorted(glob.glob(f'{_WORKSHOP}/usenet-retro/scratch-*/wave-*/delta/data/registry-corrections.json') + glob.glob(f'{_WORKSHOP}/*/scratch*/wave-*/delta/data/registry-corrections.json')):
    real = os.path.realpath(f)
    if real in seen or not os.path.exists(real + '.APPLIED'): continue
    seen.add(real)
    try: R = json.load(open(real, encoding='utf-8'))
    except Exception: continue
    for c in (R if isinstance(R, list) else [R]):
        if not (isinstance(c, dict) and isinstance(c.get('record'), dict) and 'field' not in c and 'new' not in c): continue
        w = c.get('wing') or c.get('id'); r = by.get(w); rec = c['record']
        if not r: missing_wing.add(w); continue
        cur = r.get('provenance_notes')
        if not isinstance(cur, list): continue
        if any(isinstance(x, dict) and (x == rec or (rec.get('summary') and x.get('kind') == rec.get('kind') and x.get('summary') == rec.get('summary'))) for x in cur): continue
        cur.append(rec); added += 1
if added:
    _c276_write(M, _c276_raw, P, 2)   # hook c276: the file's own indent (was a fixed indent), and only when the content changed
print(f'fix-skipped-provenance-records: restored {added}' + (f' | wings not held: {sorted(missing_wing)}' if missing_wing else ''))
