#!/usr/bin/env python3
"""fix-alias-chains (2026-10-03, lane GTT-PASS2-LANDPREP; the Janitor's GTT host-fed ruling, D244 pass 2): every data/aliases.json
`to` that no longer resolves to a live entity is canonicalised through the retired-id chain to its live survivor.

Why: a merge retires an id that an EARLIER alias already points at (munson-prime -> munson-ptc, then munson-ptc folds into
munson-prime-2003). apply-aliases-additions skips a `from` that is already an alias; merge-character and repoint-retired both
skip aliases.json; registry-validate hard-fails '"to" target ... does not resolve to any entity'. repair-merge-prefix.py lines
36-43 canonicalised through aliases.json alone, as a side clause of a one-off MERGE-01 repair; this is the one durable home.

The chain: data/aliases.json's own from -> to rows first, then the workshop's retired-ids.tsv rows whose reason begins
"merged into <id>" (a retirement that has no alias row). Live = every id registry-validate's idIndex resolves: promotions,
the shards' characters/units/titles/shows/rps, memorials, essays, external figures.
  * touches ONLY the `to` value of a row whose `to` does not resolve; a `to` that resolves is never touched;
  * a cycle, or a chain that ends on an id that is neither live nor retired-into-something, is REFUSED loudly: that row is left
    as it is, the reason printed, and the run exits 3 (the rows that do resolve are still written);
  * aliases.json is rewritten in its OWN indent (1, 2 or 4, proven by a byte round-trip before anything is written; a file that
    round-trips at none is refused whole, exit 4), via a temp file and an atomic rename;
  * idempotent: a second run finds nothing to change and writes nothing. --dry reports only. Refuses while a gate runs.
Env: MUSEUM_ROOT, WORKSHOP_ROOT (retired-ids.tsv = $WORKSHOP_ROOT/desk/retired-ids.tsv; RETIRED_IDS overrides)."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
import glob, json, os, re, sys
if _live_running("scripts/gate[.]sh", _ROOT):
    print("fix-alias-chains: a gate is running - skipped"); sys.exit(0)
DRY = "--dry" in sys.argv
M = _ROOT; D = f"{M}/data"
RT = os.environ.get("RETIRED_IDS") or f"{_WORKSHOP}/desk/retired-ids.tsv"

def rows_of(d, key=None):
    if isinstance(d, list): return d
    if isinstance(d, dict):
        if key and isinstance(d.get(key), list): return d[key]
        return next((v for v in d.values() if isinstance(v, list)), [])
    return []

live = set()
for kind in ("characters", "units", "titles", "shows", "rps"):
    for f in glob.glob(f"{D}/shards/*/{kind}.json"):
        live |= {r.get("id") for r in rows_of(json.load(open(f, encoding="utf-8"))) if isinstance(r, dict) and r.get("id")}
for name, key in (("promotions", "promotions"), ("memorials", "memorials"), ("essays", "essays"), ("external-figures", "external_figures")):
    p = f"{D}/{name}.json"
    if os.path.exists(p):
        live |= {r.get("id") for r in rows_of(json.load(open(p, encoding="utf-8")), key) if isinstance(r, dict) and r.get("id")}
if not live: sys.exit("fix-alias-chains: no live ids read (wrong MUSEUM_ROOT?); nothing changed")

AP = f"{D}/aliases.json"; raw = open(AP, encoding="utf-8").read(); A = json.loads(raw)
rows = A["aliases"] if isinstance(A, dict) else A
nl = "\n" if raw.endswith("\n") else ""
ind = next((i for i in (1, 2, 4) if json.dumps(A, ensure_ascii=False, indent=i) + nl == raw), None)
if ind is None: print("fix-alias-chains: REFUSED - aliases.json does not round-trip at indent 1, 2 or 4; nothing changed"); sys.exit(4)

succ = {}; src = {}
for r in rows:
    if isinstance(r, dict) and r.get("from") and r.get("to") and r["from"] not in succ: succ[r["from"]] = r["to"]; src[r["from"]] = "alias"
MERGED = re.compile(r"^merged into ([a-z0-9][a-z0-9-]*[a-z0-9])\b")
if os.path.exists(RT):
    for l in open(RT, encoding="utf-8"):
        if not l.strip() or l.startswith("#"): continue
        p = l.rstrip("\n").split("\t")
        if len(p) < 2: continue
        m = MERGED.match(p[1].strip())
        if m and p[0] not in succ: succ[p[0]] = m.group(1); src[p[0]] = "retired-ids"
else:
    print(f"fix-alias-chains: NOTE {RT} not found; following aliases.json alone")

def resolve(start, frm):
    """(survivor, path) or (None, reason)."""
    path = [frm, start]; cur = start
    while cur not in live:
        nxt = succ.get(cur)
        if nxt is None: return None, f"chain {' -> '.join(path)} ends on '{cur}', which is neither live nor retired into anything"
        if nxt in path: return None, f"cycle {' -> '.join(path + [nxt])}"
        path.append(nxt); cur = nxt
        if len(path) > 64: return None, f"chain longer than 64 steps from '{frm}'"
    return cur, path

changed = []; refused = []; ok = 0
for r in rows:
    if not isinstance(r, dict) or not r.get("from") or not r.get("to"): continue
    if r["to"] in live: ok += 1; continue
    surv, info = resolve(r["to"], r["from"])
    if surv is None: refused.append((r["from"], info)); continue
    if surv == r["from"]: refused.append((r["from"], f"chain {' -> '.join(info)} returns to its own from")); continue
    changed.append((r["from"], r["to"], surv, " -> ".join(info[1:]), [src.get(x, "?") for x in info[1:-1]]))
    if not DRY: r["to"] = surv
for frm, old, new, chain, via in changed:
    print(f"fix-alias-chains: {frm}: to {old} -> {new} (chain {chain}; via {', '.join(via)})")
for frm, why in refused:
    print(f"fix-alias-chains: REFUSED {frm}: {why} - row left as it is")
if changed and not DRY:
    out = json.dumps(A, ensure_ascii=False, indent=ind) + nl
    after = json.loads(out)
    ar = after["aliases"] if isinstance(after, dict) else after
    assert len(ar) == len(rows) and all(isinstance(x, dict) for x in ar)
    want = {c[0]: c[2] for c in changed}
    before = json.loads(raw); br = before["aliases"] if isinstance(before, dict) else before
    for b, a in zip(br, ar):   # only `to` of the changed rows differs
        if b != a:
            assert set(b) == set(a) and {k: v for k, v in b.items() if k != "to"} == {k: v for k, v in a.items() if k != "to"} and want.get(b.get("from")) == a.get("to"), b
    tmp = AP + ".chains.new"; open(tmp, "w", encoding="utf-8").write(out); os.replace(tmp, AP)
print(f"fix-alias-chains: {len(changed)} alias target(s) {'to canonicalise' if DRY else 'canonicalised'}, {ok} already resolve, {len(refused)} refused (indent {ind})" + (" [DRY]" if DRY else ""))
sys.exit(3 if refused else 0)
