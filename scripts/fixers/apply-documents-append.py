#!/usr/bin/env python3
"""Apply one documents-append-<wing>.json (rows shaped like museum/data/documents.json's own "documents"
array — see LANE-TEMPLATE-provenance.md) to museum/data/documents.json. Unlike apply-shard-append.py's
per-wing shards, documents.json is ONE flat file for the whole museum (like awards.json), and a row has
no "id" field — its identity is its own "page" path. A row whose page is new is appended; a row whose
page already exists REPLACES the existing row outright (a lane's fresh mint always wins over a stub —
there is no partial-merge concept for this file, unlike apply-shard-append.py's collected:false upgrade
path, because every field here is mechanically derived, not hand-curated over time).
Usage: apply-documents-append.py <documents-append-FILE>"""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json, sys, os

f = sys.argv[1]
base = os.path.basename(f)
# 2026-09-26: a wave naming its file plainly documents-append.json (no wing suffix) was skipped here, and
# wave-FW-MIRROR-F1's 20 served pages reached the museum with no rows (preflight 186 red). Both names are accepted.
if not ((base.startswith("documents-append-") or base == "documents-append.json") and base.endswith(".json")):
    print("append skipped (not a documents-append file):", base)
    sys.exit(0)

DOCS = f"{_ROOT}/data/documents.json"
if not os.path.exists(DOCS):
    print("append skipped (no museum/data/documents.json yet — run backfill-documents.py first)")
    sys.exit(1)

reg = json.load(open(DOCS, encoding="utf-8"))
rows = reg.get("documents") if isinstance(reg, dict) else reg
if not isinstance(rows, list):
    print("append skipped (documents.json shape unexpected)")
    sys.exit(1)

new_rows = json.load(open(f, encoding="utf-8"))
if isinstance(new_rows, dict):
    new_rows = new_rows.get("documents", [])
if not isinstance(new_rows, list):
    print("append skipped (delta file shape unexpected):", base)
    sys.exit(1)

by_page = {r.get("page"): i for i, r in enumerate(rows) if isinstance(r, dict)}
added = replaced = 0
for r in new_rows:
    if not isinstance(r, dict) or not r.get("page"):
        continue
    i = by_page.get(r["page"])
    if i is None:
        rows.append(r)
        by_page[r["page"]] = len(rows) - 1
        added += 1
    else:
        rows[i] = r
        replaced += 1

if added or replaced:
    if isinstance(reg, dict):
        reg["documents"] = rows
        out = reg
    else:
        out = rows
    json.dump(out, open(DOCS, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    open(DOCS, "a").write("\n")

print("documents.json rows appended:", added, "| replaced:", replaced)
