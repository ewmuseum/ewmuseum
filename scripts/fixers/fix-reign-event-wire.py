#!/usr/bin/env python3
"""fix-reign-event-wire (2026-09-24, preflight 175 red): registry-validate hard-fails a reign that carries an EXACT `won` date and
a promotion for which exactly one exact-dated show shares that date, with no `event` wired ("a new show landing without its own
reigns being reconciled against it"). When a wave lands a show on the date of an already-held reign (PTC-FORUM-L1's WWA cards,
window 174), nothing reconciled them. This fixer runs the validator's own derivation: for such a reign, `event` is set to the
one show. A reign with circa/month precision, or with more than one candidate show, is never touched (those stay in the row's
note, as the validator says). Prints every wiring. Idempotent; refuses while a gate runs."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
import glob, json, os, subprocess, sys
if _live_running("scripts/gate[.]sh", _ROOT):
    print("fix-reign-event-wire: a gate is running — skipped"); sys.exit(0)
M = f"{_ROOT}/data/shards"
def load(p):
    try: return json.load(open(p, encoding="utf-8"))
    except Exception: return []
title_promo = {}
for f in glob.glob(f"{M}/*/titles.json"):
    for t in load(f):
        if isinstance(t, dict) and t.get("id"): title_promo[t["id"]] = t.get("promotion")
by_key = {}
for f in glob.glob(f"{M}/*/shows.json"):
    for s in load(f):
        if not isinstance(s, dict): continue
        d = s.get("date") or {}
        if isinstance(d, dict) and d.get("precision") == "exact" and d.get("date"):
            by_key.setdefault((s.get("promotion"), d["date"]), []).append(s.get("id"))
n = 0
for f in sorted(glob.glob(f"{M}/*/reigns.json")):
    rows = load(f); ch = False
    for r in rows if isinstance(rows, list) else []:
        if not isinstance(r, dict) or r.get("event"): continue
        w = r.get("won") or {}
        if not (isinstance(w, dict) and w.get("precision") == "exact" and w.get("date")): continue
        promo = title_promo.get(r.get("title"))
        if not promo: continue
        cands = by_key.get((promo, w["date"]), [])
        if len(cands) == 1:
            r["event"] = cands[0]; ch = True; n += 1
            print(f"fix-reign-event-wire: {r.get('id')} won {w['date']} -> event {cands[0]}")
    if ch:
        raw = open(f, encoding="utf-8").read().split("\n")
        ind = (len(raw[1]) - len(raw[1].lstrip(" "))) if len(raw) > 1 and raw[1].strip() else 1   # keep the shard's own indent
        tmp = f + ".rew.new"
        json.dump(rows, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=ind or 1); open(tmp, "a").write("\n"); os.replace(tmp, f)
print(f"fix-reign-event-wire: {n} reign event(s) wired")
