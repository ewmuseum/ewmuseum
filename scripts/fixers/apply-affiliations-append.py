#!/usr/bin/env python3
"""Standing preflight fixer (job J38b, 2026-09-27): lands a wave's affiliation EDGES into data/affiliations.json from
every filename the lanes actually used, not just the one the old glob matched.

apply-affiliation-rows.py takes one file on argv and window.sh only ever hands it `affiliations-rows-*.json`
(W:125-128) — the hyphen-suffix is required. So four APPLIED waves' edges were dropped on the filename alone:
affiliations-append-awa-ewcentral-2007.json (wave-SITES-B5, 3 edges), affiliations-append-brandwrestling.json
(wave-SITES-B6, 3), affiliations-append.json (wave-PTC-FORUM-L3, 1) and a bare affiliations-rows.json
(wave-FW-HUB, 2) — 9 edges, none in the live file (kit-j38/CURRENT-HITS.md). The standing backstop in
standing-window-fixers.sh §6h would not have caught them either: its own ALLW tree list has never included
desk/argyle/waves or prose-waves, which is where three of the four sit.

Model: apply-aliases-additions.py. Every APPLIED wave in WAVE_TREES, both filename families
(affiliations-append*.json and affiliations-rows*.json — the suffixed ones too, as the cross-tree backstop §6h is
missing; those already carry apply-affiliation-rows.py's own .APPLIED marker and are skipped), a per-file .APPLIED
marker, --dry writes nothing. Dedupe key is apply-affiliation-rows.py's own: (a, b, nature). A row is checked against
the live shape before it lands — the two endpoints, the nature against registry-validate.mjs's own AFFIL_NATURES set,
a held {id} against promotions.json, and `source` present (registry-validate warns without it) — and anything that
fails is printed and left, with the file unmarked, rather than landed half-formed.

NOTE for the coordinator: a new edge only RENDERS after `npm run refresh:links`, and registry-validate warns until it
does ("is not rendered anywhere on <page>"). Running from ORDER.txt means preflight's own regen chain does that in the
same run, straight after the fixers.
"""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
import json, glob, re, time, sys

DRY = '--dry' in sys.argv
GLOBS = ("affiliations-append*.json", "affiliations-rows*.json")

cfg = open(f"{_ROOT}/ops/config.env", encoding="utf-8").read()
m = re.search(r'WAVE_TREES="\$\{WAVE_TREES:-(.*?)\}"', cfg, re.S)
trees = [t.strip() for t in (_os.environ.get('WAVE_TREES') or (m.group(1) if m else "")).split("\n") if t.strip()]

AP = f"{_ROOT}/data/affiliations.json"; raw = open(AP, encoding="utf-8").read(); A = json.loads(raw)
rows = A if isinstance(A, list) else A["affiliations"]

# the nature vocabulary is read out of the validator that enforces it, never re-typed here (law-not-paraphrase)
rv = open(f"{_ROOT}/scripts/registry-validate.mjs", encoding="utf-8").read()
_m = re.search(r'const AFFIL_NATURES = new Set\(\[(.*?)\]\);', rv, re.S)
NATURES = set(re.findall(r'"([a-z-]+)"', _m.group(1))) if _m else {r.get("nature") for r in rows}
GRADES = ("primary-source", "user-attested", "presumed")
promos = {r.get("id") for r in json.load(open(f"{_ROOT}/data/promotions.json", encoding="utf-8"))["promotions"]}


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


def side_problem(e, which):
    if not isinstance(e, dict):
        return f"{which} is not an object"
    if e.get("id"):
        return None if e["id"] in promos else f'{which}.id "{e["id"]}" is not a held promotion (mark it {{name, unheld: true}} instead)'
    if e.get("name") and e.get("unheld") is True:
        return None
    return f"{which} needs either an id (held promotion) or name + unheld: true"


have = {key(r) for r in rows}
files = []
for t in trees:
    base = t if _os.path.isabs(t) else _os.path.join(_WORKSHOP, t)
    for g in GLOBS:
        for f in glob.glob(f"{base}/**/delta/data/{g}", recursive=True):
            wave = f.split("/delta/data/")[0]
            if not _os.path.exists(f"{wave}/APPLIED") or _os.path.exists(f + ".APPLIED"):
                continue
            files.append((f, wave))
files.sort()

added = seen = 0
for f, wave in sorted(set(files)):
    wn = _os.path.basename(wave); fn = _os.path.basename(f)
    C = json.load(open(f, encoding="utf-8"))
    new = C if isinstance(C, list) else (C.get("affiliations") or C.get("rows") or [C])
    ok = True
    for r in new or []:
        seen += 1
        if not isinstance(r, dict):
            print(f"apply-affiliations-append: {wn}/{fn}: row is not an object; left"); ok = False; continue
        bad = side_problem(r.get("a"), "a") or side_problem(r.get("b"), "b")
        if bad:
            print(f"apply-affiliations-append: {wn}/{fn}: {bad}; left"); ok = False; continue
        if r.get("nature") not in NATURES:
            print(f"apply-affiliations-append: {wn}/{fn}: nature {r.get('nature')!r} is not one of the registry's own; left"); ok = False; continue
        if not r.get("source"):
            print(f"apply-affiliations-append: {wn}/{fn}: edge with no source (the receipt); left"); ok = False; continue
        if r.get("grade") and r["grade"] not in GRADES:
            print(f"apply-affiliations-append: {wn}/{fn}: grade {r['grade']!r} is not one of {'|'.join(GRADES)}; left"); ok = False; continue
        k = key(r)
        if k in have:
            print(f"apply-affiliations-append: {wn}/{fn}: {k[2]} edge already held; skipped")
            continue
        rows.append(r)                                     # in memory either way; only the FILE write is gated on --dry
        have.add(k); added += 1
        ea = r["a"].get("id") or r["a"].get("name"); eb = r["b"].get("id") or r["b"].get("name")
        print(f"apply-affiliations-append: {wn}/{fn}: + {ea} —{r['nature']}→ {eb}")
    if ok and not DRY:
        open(f + ".APPLIED", "w").write(time.strftime("%Y-%m-%dT%H:%M:%S\n"))

if added and not DRY:
    ind = indent_of(raw)
    open(AP, "w", encoding="utf-8").write(json.dumps(A, ensure_ascii=False, indent=ind) + ("\n" if raw.endswith("\n") else ""))
print(("DRY " if DRY else "") + f"apply-affiliations-append: {added} edge(s) added from {seen} row(s) in {len(set(files))} file(s)")
