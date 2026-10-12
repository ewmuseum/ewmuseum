#!/usr/bin/env python3
"""fix-alias-twins (the Janitor 2026-09-24: "Yes, clean those up"): a record whose id is an alias `from` (merge-character.py retired it)
but which is live again beside its live canonical target is a twin the old fix-lost-records loop resurrected from HEAD (382 on
2026-09-24; fix-lost-records honours aliases.json since window 174, so no new ones appear). The survivor already carries the
original merge's fold; this fixer re-folds defensively — any tenure of the twin the survivor lacks (same promotion + first_seen) is
appended when the survivor holds no tenure at that promotion (a differing stint at a held promotion is logged for review, never duplicated), the twin's name and aka join the survivor's aka — then removes the twin row. References are
left to repoint-retired.py (run at the end). Characters and units. --dry prints the plan and writes nothing. Idempotent; refuses
while a gate runs."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
import glob, json, os, subprocess, sys
if _live_running("scripts/gate[.]sh", _ROOT):
    print("fix-alias-twins: a gate is running — skipped"); sys.exit(0)
dry = "--dry" in sys.argv
M = _ROOT; S = f"{M}/data/shards"
AL = {a["from"]: a["to"] for a in json.load(open(f"{M}/data/aliases.json", encoding="utf-8")).get("aliases", []) if isinstance(a, dict) and a.get("from") and a.get("to")}
def canon(c, seen=()):
    return canon(AL[c], seen + (c,)) if c in AL and c not in seen else c
files = {}; where = {}
for kind in ("characters", "units"):
    for f in glob.glob(f"{S}/*/{kind}.json"):
        rows = json.load(open(f, encoding="utf-8")); files[f] = rows
        for i, r in enumerate(rows):
            if isinstance(r, dict) and r.get("id"): where.setdefault(r["id"], []).append(f)
pairs = []
for frm in AL:
    tgt = canon(frm)
    if tgt != frm and frm in where and tgt in where: pairs.append((frm, tgt))
changed = set(); folds = 0; akas = 0; removed = 0
def rec(i, f): return next(r for r in files[f] if isinstance(r, dict) and r.get("id") == i)
for frm, tgt in sorted(pairs):
    sf = where[tgt][0]; s = rec(tgt, sf)
    for ff in where[frm]:
        t = rec(frm, ff)
        cur = s.get("tenures") or []
        for ten in t.get("tenures") or []:
            if not isinstance(ten, dict) or ten in cur: continue
            if any(isinstance(x, dict) and x.get("promotion") == ten.get("promotion") and x.get("first_seen") == ten.get("first_seen") for x in cur): continue
            if not any(isinstance(x, dict) and x.get("promotion") == ten.get("promotion") for x in cur):
                cur.append(ten); folds += 1; print(f"  fold {frm} -> {tgt}: tenure {ten.get('promotion')} {ten.get('first_seen')}")
            else: print(f"  kept {tgt}'s own {ten.get('promotion')} tenure (the twin's differs: first_seen {ten.get('first_seen')}) — review")
        if cur: s["tenures"] = cur
        ak = s.get("aka") if isinstance(s.get("aka"), list) else ([] if not s.get("aka") else [s.get("aka")])
        for nm in [t.get("name")] + (t.get("aka") if isinstance(t.get("aka"), list) else []):
            if nm and nm != s.get("name") and nm not in ak: ak.append(nm); akas += 1
        if ak: s["aka"] = ak
        # identity folds as merge-character.py folds it: the twin's entries that do not name the survivor, deduped by with-set
        ids = [i for i in (s.get("identity") or []) if isinstance(i, dict) and frm not in (i.get("with") or [])]
        for i in t.get("identity") or []:
            if not isinstance(i, dict) or tgt in (i.get("with") or []): continue
            if not any(set(i.get("with") or []) == set(j.get("with") or []) for j in ids): ids.append(i)
        if ids: s["identity"] = ids
        elif "identity" in s: del s["identity"]
        files[ff] = [r for r in files[ff] if not (isinstance(r, dict) and r.get("id") == frm)]
        removed += 1; changed.add(ff); changed.add(sf)
print(f"fix-alias-twins: {len(pairs)} twin pair(s); {removed} twin row(s) {'to remove' if dry else 'removed'}; {folds} tenure fold(s); {akas} aka added" + (" [DRY]" if dry else ""))
if dry or not changed: sys.exit(0)
for f in sorted(changed):
    raw = open(f, encoding="utf-8").read().split("\n")
    ind = (len(raw[1]) - len(raw[1].lstrip(" "))) if len(raw) > 1 and raw[1].strip() else 1
    tmp = f + ".twin.new"; json.dump(files[f], open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=ind or 1); open(tmp, "a").write("\n"); os.replace(tmp, f)
r = subprocess.run(["python3", "-I", os.path.join(os.path.dirname(os.path.abspath(__file__)), "repoint-retired.py")], capture_output=True, text=True)
print((r.stdout or r.stderr).strip().splitlines()[-1] if (r.stdout or r.stderr).strip() else "repoint-retired: no output")
