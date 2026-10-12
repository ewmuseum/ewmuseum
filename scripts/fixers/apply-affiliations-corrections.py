#!/usr/bin/env python3
"""Standing preflight fixer (job J38b, 2026-09-27): lands a wave's delta/data/affiliations-corrections.json onto the
matching row of data/affiliations.json.

No applier has ever corrected an EXISTING affiliation edge — apply-affiliation-rows.py only appends new ones — so
wave-COORD-SELF-PORTRAY-A was stamped APPLIED with three note rewrites that never happened: all three rows still read
"the same self-portrayed ... persona" today, at exactly the indices the file recorded (265, 266, 267).

Row shape (the shape the lane filed, which is apply-corrections.py's {field, old, new} with the edge's own identity in
place of a slug): {a, b, nature, field, old, new, index_at_filing?}. The edge is found by (a, b, nature) — the same key
apply-affiliation-rows.py dedupes on — and `index_at_filing` is used only to confirm the match, never to address the
row, because the live file's indices move every time an edge is appended.

**The old value must match.** A correction lands only where the live field still equals `old` byte for byte; a stale
`old` is printed and left and the file is not marked (apply-collections-corrections.py's rule, and the same reason:
a correction whose premise has already changed is a ruling to re-take, not a write to force). Idempotent: once the
field equals `new`, the row is reported as already-correct and skipped. Model: apply-aliases-additions.py — every
APPLIED wave in WAVE_TREES, a per-file .APPLIED marker, --dry writes nothing.
"""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
import json, glob, re, time, sys

DRY = '--dry' in sys.argv
NAME = "affiliations-corrections.json"
# a correction may only touch a field the live rows already use; a new field on an edge is a schema change, not a fix
FIELDS = ("note", "source", "period", "status_note", "grade", "nature")

cfg = open(f"{_ROOT}/ops/config.env", encoding="utf-8").read()
m = re.search(r'WAVE_TREES="\$\{WAVE_TREES:-(.*?)\}"', cfg, re.S)
trees = [t.strip() for t in (_os.environ.get('WAVE_TREES') or (m.group(1) if m else "")).split("\n") if t.strip()]

AP = f"{_ROOT}/data/affiliations.json"; raw = open(AP, encoding="utf-8").read(); A = json.loads(raw)
rows = A if isinstance(A, list) else A["affiliations"]


def indent_of(text):
    obj = json.loads(text)
    for i in (1, 2, 4):
        if json.dumps(obj, ensure_ascii=False, indent=i) + ("\n" if text.endswith("\n") else "") == text:
            return i
    for line in text.split("\n")[1:]:
        if line.startswith(" "):
            return len(line) - len(line.lstrip(" "))
    return 1


def key(r):
    return (json.dumps(r.get("a"), sort_keys=True), json.dumps(r.get("b"), sort_keys=True), r.get("nature"))


def label(c):
    a = (c.get("a") or {}); b = (c.get("b") or {})
    return f"{a.get('id') or a.get('name')} —{c.get('nature')}→ {b.get('id') or b.get('name')}"


files = []
for t in trees:
    base = t if _os.path.isabs(t) else _os.path.join(_WORKSHOP, t)
    for f in glob.glob(f"{base}/**/delta/data/{NAME}", recursive=True):
        wave = f.split("/delta/data/")[0]
        if not _os.path.exists(f"{wave}/APPLIED") or _os.path.exists(f + ".APPLIED"):
            continue
        files.append((f, wave))
files.sort()

fixed = already = seen = 0
for f, wave in files:
    wn = _os.path.basename(wave)
    C = json.load(open(f, encoding="utf-8"))
    new = C if isinstance(C, list) else (C.get("corrections") or C.get("rows") or [C])
    ok = True
    for c in new or []:
        seen += 1
        if not isinstance(c, dict):
            print(f"apply-affiliations-corrections: {wn}: row is not an object; left"); ok = False; continue
        fld = c.get("field")
        if fld not in FIELDS or "new" not in c:
            print(f"apply-affiliations-corrections: {wn}: {label(c)}: field {fld!r} is not a correctable edge field, or no new value; left"); ok = False; continue
        hits = [r for r in rows if key(r) == key(c)]
        if len(hits) != 1:
            print(f"apply-affiliations-corrections: {wn}: {label(c)}: {len(hits)} live edge(s) match that a/b/nature; left"); ok = False; continue
        r = hits[0]
        idx = rows.index(r)
        if c.get("index_at_filing") is not None and c["index_at_filing"] != idx:
            print(f"apply-affiliations-corrections: {wn}: {label(c)}: index moved {c['index_at_filing']} -> {idx} (matched on a/b/nature, which is the real key)")
        if r.get(fld) == c["new"]:
            already += 1
            print(f"apply-affiliations-corrections: {wn}: {label(c)}: {fld} already reads the corrected value; skipped")
            continue
        if "old" not in c:
            print(f"apply-affiliations-corrections: {wn}: {label(c)}: no old value to match against; left"); ok = False; continue
        if r.get(fld) != c["old"]:
            print(f"apply-affiliations-corrections: {wn}: {label(c)}: live {fld} does not match this row's own `old` — stale correction, left for a ruling"); ok = False; continue
        r[fld] = c["new"]                                   # in memory either way; only the FILE write is gated on --dry
        fixed += 1
        print(f"apply-affiliations-corrections: {wn}: {label(c)}: {fld} corrected at index {idx}")
    if ok and not DRY:
        open(f + ".APPLIED", "w").write(time.strftime("%Y-%m-%dT%H:%M:%S\n"))

if fixed and not DRY:
    ind = indent_of(raw)
    open(AP, "w", encoding="utf-8").write(json.dumps(A, ensure_ascii=False, indent=ind) + ("\n" if raw.endswith("\n") else ""))
print(("DRY " if DRY else "") + f"apply-affiliations-corrections: {fixed} field(s) corrected, {already} already correct, "
      f"{seen} row(s) read from {len(files)} file(s)")
