#!/usr/bin/env python3
"""THE DOCUMENT-CLASS AMENDMENT as a STANDING fixer (CURATION v116 #doc-class-amendment, the Janitor 2026-09-19): every served document
carries a v109(a) class in the one vocabulary the two validators read. Lane spellings are respelled on the served page's
data-doc-class attribute and in data/documents.json:
  roleplay -> rp | charter, faq -> rules | index, none -> other
Ported into the repo 2026-09-20 after cycle 149 caught 18 'roleplay' rows from the 2000 waves — the workshop one-off had never
joined ORDER.txt, so preflight never ran it. Idempotent; refuses while a gate runs. Usage: fix-doc-class-v109.py [--dry]
"""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
import json, re, glob, subprocess, sys
M = _ROOT; dry = "--dry" in sys.argv
if not dry and _live_running("scripts/gate[.]sh", _ROOT): sys.exit("REFUSED: a gate is running")
MAP = {"roleplay": "rp", "charter": "rules", "faq": "rules", "index": "other", "none": "other"}
ATTR = re.compile(r'(data-doc-class\s*=\s*")([a-z-]+)(")')
pages = 0
for p in glob.glob(f"{M}/promotions/*/archive/*.html") + glob.glob(f"{M}/promotions/*/rp/*.html"):
    t = open(p, encoding="utf-8").read()
    t2 = ATTR.sub(lambda m: m.group(1) + MAP.get(m.group(2), m.group(2)) + m.group(3), t)
    if t2 != t:
        pages += 1
        if not dry: open(p, "w", encoding="utf-8").write(t2)
D = f"{M}/data/documents.json"; dj = json.load(open(D, encoding="utf-8")); rows = 0
for r in dj["documents"]:
    c = r.get("doc_class")
    if c in MAP: r["doc_class"] = MAP[c]; rows += 1
if not dry and rows: json.dump(dj, open(D, "w", encoding="utf-8"), ensure_ascii=False, indent=1); open(D, "a").write("\n")
print(f"fix-doc-class-v109: pages {pages} | documents.json rows {rows} | dry {dry}")
