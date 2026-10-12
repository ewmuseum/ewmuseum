#!/usr/bin/env python3
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import csv, sys; csv.field_size_limit(sys.maxsize)
"""Standing (coordinator 2026-09-21, preflight 165): validate.mjs requires a served document of a wing that runs in a
language other than English to carry that language on its <div class="document">. A lane's page built without it
(HCW 4 Ever's May 2001 roster call, French) redded preflight. Adds lang="<wing language>" to a bare
<div class="document"> on the wing's own archive/ and rp/ pages. Never changes a lang already set."""
import json, glob, re, os
P = json.load(open(f"{_ROOT}/data/promotions.json", encoding="utf-8"))["promotions"]
n = 0
for p in P:
    lang = (p.get("language") or "").strip()
    if not lang or lang.lower().startswith("en"): continue
    for f in glob.glob(f"{_ROOT}/promotions/{p['id']}/archive/*.html") + glob.glob(f"{_ROOT}/promotions/{p['id']}/rp/*.html"):
        s = open(f, encoding="utf-8").read()
        t = re.sub(r'<div class="document">', f'<div class="document" lang="{lang}">', s)
        if t != s: open(f, "w", encoding="utf-8").write(t); n += 1
print(f"stamp-document-lang: pages stamped {n}")
