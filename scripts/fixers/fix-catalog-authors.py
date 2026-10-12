#!/usr/bin/env python3
"""Standing preflight fixer (2026-09-29, after preflight 216 went red): a data/rp-catalog.json row whose `author` no
longer resolves to a live character or unit is re-credited from the museum's own records, in this order:
  1. the author id is folded forward in data/aliases.json -> the alias's target, when it resolves;
  2. the row is held (`rps_id`) and that served rps row names exactly one `involves` id that resolves -> that id (the
     served roleplay's byline, which the wave that retired the author already re-credited);
  3. the author is a PLACEHOLDER in the workshop's retired-ids.tsv (a fed's stand-in for an unrevealed participant, not a
     person) -> the settled unknown-author shape: `author` dropped, `author_unknown: true` in its place.
Occasion: wave-PLACEHOLDERS-0929 retired `mystery-opponent` and re-credited uwf-promo-250/274/282 in the uwf shard, but
the catalog's four rows (three held, one unheld incard) kept the retired id. Anything none of the three rules settles is
printed and left for the registry validator to red. References only (never prose), own indent, idempotent. Exits 0."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
import json, glob

def own_indent(raw):
    for line in raw.split("\n")[1:3]:
        s = len(line) - len(line.lstrip(" "))
        if s:
            return s
    return 1

def rows_of(d, key):
    return d if isinstance(d, list) else d.get(key, [])

live = set()
for f in glob.glob(f"{_ROOT}/data/shards/*/characters.json") + glob.glob(f"{_ROOT}/data/shards/*/units.json"):
    for r in rows_of(json.load(open(f, encoding="utf-8")), "characters"):
        if isinstance(r, dict) and isinstance(r.get("id"), str):
            live.add(r["id"])

a = json.load(open(f"{_ROOT}/data/aliases.json", encoding="utf-8"))
amap = {r["from"]: r["to"] for r in (a.get("aliases", []) if isinstance(a, dict) else a)
        if isinstance(r, dict) and "from" in r and "to" in r}

def via_alias(cid):
    seen = set()
    while cid not in live and cid in amap and cid not in seen:
        seen.add(cid)
        cid = amap[cid]
    return cid if cid in live else None

involves = {}
for f in glob.glob(f"{_ROOT}/data/shards/*/rps.json"):
    for r in rows_of(json.load(open(f, encoding="utf-8")), "rps"):
        if isinstance(r, dict) and isinstance(r.get("id"), str):
            involves[r["id"]] = r.get("involves") or []

placeholders = set()
ledger = f"{_WORKSHOP}/desk/retired-ids.tsv"
if _os.path.exists(ledger):
    for line in open(ledger, encoding="utf-8"):
        cols = line.rstrip("\n").split("\t")
        if len(cols) > 1 and "PLACEHOLDER" in cols[1]:
            placeholders.add(cols[0])

path = f"{_ROOT}/data/rp-catalog.json"
raw = open(path, encoding="utf-8").read()
data = json.loads(raw)
rows = data["rp_catalog"]
changed, left = [], []
for i, r in enumerate(rows):
    au = r.get("author")
    if not isinstance(au, str) or au in live:
        continue
    to = via_alias(au)
    if not to and r.get("held") and r.get("rps_id") in involves:
        inv = [x for x in involves[r["rps_id"]] if isinstance(x, str)]
        if len(inv) == 1 and inv[0] in live:
            to = inv[0]
    if to:
        r["author"] = to
        changed.append((i, r.get("title"), au, to))
    elif au in placeholders:
        rows[i] = {("author_unknown" if k == "author" else k): (True if k == "author" else v) for k, v in r.items()}
        changed.append((i, r.get("title"), au, "author_unknown"))
    else:
        left.append((i, r.get("title"), au))
if changed:
    text = json.dumps(data, ensure_ascii=False, indent=own_indent(raw))
    if raw.endswith("\n"):
        text += "\n"
    open(path + ".tmp", "w", encoding="utf-8").write(text)
    _os.replace(path + ".tmp", path)
for i, t, old, new in changed:
    print(f"fix-catalog-authors: rp-catalog[{i}] ({t!r}) {old} -> {new}")
for i, t, old in left:
    print(f"fix-catalog-authors: rp-catalog[{i}] ({t!r}) author {old} unresolved; no rule settles it (left)")
print(f"fix-catalog-authors: {len(changed)} author(s) re-credited, {len(left)} left")
