#!/usr/bin/env python3
"""Standing preflight fixer (2026-09-28, after preflight 207 went red): a character's `portrays.figure` or
`portrayal_of` that names an external-figures id since folded forward in data/aliases.json is repointed to the alias's
target, when that target resolves in data/external-figures.json. Occasion: wave-FIGURES-DEDUP-0927 folded `taz-real`
into `tazz-real`; EBWF's 2008 pages (landed window 205/206, built before the fold) still pointed `taz-ebwf-2001` at the
retired id, and the registry validator does not follow figure aliases. Touches only those two reference fields (never
prose: fixers match references only), follows an alias chain to its end, writes each shard in its own indent, and
prints what it repointed. Exits 0 always."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import json, glob

def own_indent(raw):
    for line in raw.split("\n")[1:3]:
        s = len(line) - len(line.lstrip(" "))
        if s:
            return s
    return 1

def figure_ids():
    d = json.load(open(f"{_ROOT}/data/external-figures.json", encoding="utf-8"))
    ids = set()
    def walk(n):
        if isinstance(n, dict):
            if isinstance(n.get("id"), str):
                ids.add(n["id"])
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(d)
    return ids

def alias_map():
    a = json.load(open(f"{_ROOT}/data/aliases.json", encoding="utf-8"))
    rows = a.get("aliases", []) if isinstance(a, dict) else a
    return {r["from"]: r["to"] for r in rows if isinstance(r, dict) and "from" in r and "to" in r}

def resolve(fid, amap, figs):
    seen = set()
    while fid not in figs and fid in amap and fid not in seen:
        seen.add(fid)
        fid = amap[fid]
    return fid if fid in figs else None

figs, amap = figure_ids(), alias_map()
total = 0
for path in sorted(glob.glob(f"{_ROOT}/data/shards/*/characters.json")):
    raw = open(path, encoding="utf-8").read()
    data = json.loads(raw)
    rows = data if isinstance(data, list) else data.get("characters", [])
    changed = []
    for c in rows:
        if not isinstance(c, dict):
            continue
        p = c.get("portrays")
        if isinstance(p, dict) and isinstance(p.get("figure"), str) and p["figure"] not in figs:
            to = resolve(p["figure"], amap, figs)
            if to:
                changed.append((c.get("id"), "portrays.figure", p["figure"], to)); p["figure"] = to
        po = c.get("portrayal_of")
        if isinstance(po, str) and po not in figs:
            to = resolve(po, amap, figs)
            if to:
                changed.append((c.get("id"), "portrayal_of", po, to)); c["portrayal_of"] = to
    if changed:
        text = json.dumps(data, ensure_ascii=False, indent=own_indent(raw))
        if raw.endswith("\n"):
            text += "\n"
        open(path + ".tmp", "w", encoding="utf-8").write(text)
        _os.replace(path + ".tmp", path)
        for cid, field, old, new in changed:
            print(f"fix-figure-aliases: {cid} {field} {old} -> {new}")
        total += len(changed)
print(f"fix-figure-aliases: {total} reference(s) repointed through data/aliases.json")
