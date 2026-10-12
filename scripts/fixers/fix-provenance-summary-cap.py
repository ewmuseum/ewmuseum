#!/usr/bin/env python3
"""Standing preflight fixer (coordinator 2026-10-02, cycle 236's red preflight): a typed provenance note's `summary` is a
preview capped at 160 characters (validate-provenance-notes rule 9). convert-provenance-notes.py truncates at conversion
only, so a later text correction can lengthen a summary past the cap (window 235: wave-GOLDEN-TURNBUCKLE-FIX's
"Ticket" -> "Turnbuckle" made ptc[10]'s summary 161 and stopped cycle 236). This re-caps ONLY a summary that is already a
truncated preview (it ends with the ellipsis "…"): it is cut back at the last word boundary so that, with "…", it is at most
160 characters. A complete summary that is too long is NOT touched (it is printed for a human; the validator still fails).
It edits museum/data/promotions.json by exact string replacement of the JSON-encoded summary (never a re-serialise, so the
file's own indent and order are kept), only where that encoded string occurs exactly once. Idempotent; deterministic."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import json, sys
P = _os.path.join(_ROOT, 'data', 'promotions.json')
CAP, ELL = 160, '…'
raw = open(P, encoding='utf-8').read()
d = json.loads(raw)
proms = d['promotions'] if isinstance(d, dict) else d
fixed, left, s = [], [], raw
for p in proms:
    for i, n in enumerate(p.get('provenance_notes') or []):
        if not isinstance(n, dict): continue
        sm = n.get('summary')
        if not isinstance(sm, str) or len(sm) <= CAP: continue
        where = '%s[%d]' % (p.get('id'), i)
        if not sm.endswith(ELL):
            left.append(where); continue
        body = sm[:-1].rstrip()
        cut = body[:CAP - 1]
        if ' ' in cut and len(body) > CAP - 1:
            cut = cut[:cut.rfind(' ')]
        new = cut.rstrip(' ,;:—-') + ELL
        assert len(new) <= CAP and new != sm
        enc_old = json.dumps(sm, ensure_ascii=False); enc_new = json.dumps(new, ensure_ascii=False)
        if s.count(enc_old) != 1:
            left.append(where + ' (encoded string not unique)'); continue
        s = s.replace(enc_old, enc_new); fixed.append('%s %d->%d' % (where, len(sm), len(new)))
if fixed:
    json.loads(s)
    tmp = P + '.capnew'
    open(tmp, 'w', encoding='utf-8').write(s); _os.replace(tmp, P)
print('fix-provenance-summary-cap: re-capped %d%s%s' % (len(fixed), (': ' + ', '.join(fixed)) if fixed else '',
      ('; LEFT for a human (complete summaries over the cap): ' + ', '.join(left)) if left else ''))
