#!/usr/bin/env python3
"""Standing preflight fixer (coordinator 2026-09-27, preflight 203 red): every review-queue row's `candidates` must name
live registry records (registry-validate's review-queue check). Two ways a candidate goes stale, both reference upkeep:
  1. A RETIRED id (a merge or fold since the row was written; data/aliases.json forwards it): the candidate becomes the
     id the alias chain ends at, and a candidate list that then names one record twice keeps it once. The row's own
     `name` and `note` are NEVER touched (J40b: a retired id in a question's prose is the question itself).
  2. A REIGN id (reigns are not registry records): the candidate becomes the reign's `title` and its holders' ids; the
     reign id itself stays named in the row's note, where the question states it.
Runs at the END of ORDER.txt, after the appliers that append queue rows (apply-review-queue-append.py and
apply-review-queue-corrections.py), because rows written weeks ago can land after the merges that retired their
candidates. Idempotent. Rewrites review-queue.json in its own indent. Anything it can't resolve is printed and left
(the gate then says so)."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import json, glob, sys

M = _ROOT
QP = f"{M}/data/review-queue.json"; raw = open(QP, encoding="utf-8").read(); Q = json.loads(raw)
rows = Q["review_queue"] if isinstance(Q, dict) else Q
AL = {a["from"]: a["to"] for a in json.load(open(f"{M}/data/aliases.json", encoding="utf-8"))["aliases"]}

live = set()
def add_ids(path, key=None):
    for f in glob.glob(path):
        try: d = json.load(open(f, encoding="utf-8"))
        except Exception: continue
        d = d if isinstance(d, list) else (d.get(key) if key else None) or []
        for r in d:
            if isinstance(r, dict) and r.get("id"): live.add(r["id"])
for k in ("characters", "units", "titles", "shows", "rps"): add_ids(f"{M}/data/shards/*/{k}.json")
add_ids(f"{M}/data/promotions.json", "promotions"); add_ids(f"{M}/data/memorials.json", "memorials")
add_ids(f"{M}/data/external-figures.json", "figures"); add_ids(f"{M}/data/external-figures.json", "external_figures")
add_ids(f"{M}/data/essays.json", "essays")
reigns = {}
for f in glob.glob(f"{M}/data/shards/*/reigns.json"):
    for r in json.load(open(f, encoding="utf-8")):
        if isinstance(r, dict) and r.get("id"): reigns[r["id"]] = r

def canon(c, seen=()):
    return canon(AL[c], seen + (c,)) if c in AL and c not in seen else c

changed = 0; left = []
for i, q in enumerate(rows):
    if not isinstance(q, dict) or not isinstance(q.get("candidates"), list): continue
    if all(not isinstance(c, str) or c in live for c in q["candidates"]): continue   # a row whose candidates all resolve is never touched
    out = []                                                                             # (a list naming one live record twice is repoint damage J40b's waves restore)
    for c in q["candidates"]:
        if not isinstance(c, str) or c in live: out.append(c); continue
        new = [c]
        if c in AL and canon(c) in live: new = [canon(c)]
        elif c in reigns:
            r = reigns[c]; new = [x for x in [r.get("title")] + [h.get("id") for h in (r.get("holder") or []) if isinstance(h, dict)] if x] or [c]
        for x in new:
            if x not in out: out.append(x)
    if out != q["candidates"]:
        print(f"fix-review-queue-candidates: queue[{i}] ({str(q.get('name'))[:60]}): {q['candidates']} -> {out}")
        q["candidates"] = out; changed += 1
    for x in out:
        if isinstance(x, str) and x not in live: left.append((i, x))

def indent_of(text):
    obj = json.loads(text)
    for n in (1, 2, 4):
        if json.dumps(obj, ensure_ascii=False, indent=n) + ("\n" if text.endswith("\n") else "") == text: return n
    return 1
if changed:
    tmp = QP + ".tmp"; open(tmp, "w", encoding="utf-8").write(json.dumps(Q, ensure_ascii=False, indent=indent_of(raw)) + ("\n" if raw.endswith("\n") else "")); os = _os; os.replace(tmp, QP)
for i, x in left: print(f"fix-review-queue-candidates: queue[{i}]: candidate {x!r} still resolves to nothing (left for a ruling)")
print(f"fix-review-queue-candidates: {changed} row(s) corrected, {len(left)} unresolved")
