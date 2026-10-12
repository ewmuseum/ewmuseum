#!/usr/bin/env python3
"""fix-shard-assignment (2026-09-24): registry-validate hard-fails a character or unit filed under a shard its assignment rule
(shard-lib.mjs shardOf: tenures[0].promotion, else _unassigned) does not resolve to. A correction that gives an _unassigned record
its FIRST tenure (the memorial records: phillip-kennedy-sccw in COORD-PRIME-CARE, david-walter-smith when Logic folds into it)
leaves it in the wrong shard. This fixer moves such a row, unchanged, to the shard its rule names — only when that shard's
directory exists (a wing); otherwise it reports and leaves it. Order within a shard is not significant (apply-shard-append appends).
Each file keeps its own indent. --dry reports only. Idempotent; refuses while a gate runs."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
import glob, json, os, subprocess, sys
if _live_running("scripts/gate[.]sh", _ROOT):
    print("fix-shard-assignment: a gate is running — skipped"); sys.exit(0)
dry = "--dry" in sys.argv; S = f"{_ROOT}/data/shards"
def dump(f, rows):
    ind = 1
    if os.path.exists(f):
        raw = open(f, encoding="utf-8").read().split("\n")
        if len(raw) > 1 and raw[1].strip(): ind = (len(raw[1]) - len(raw[1].lstrip(" "))) or 1
    tmp = f + ".asg.new"; json.dump(rows, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=ind); open(tmp, "a").write("\n"); os.replace(tmp, f)
moved = 0; left = 0
for kind in ("characters", "units", "rps"):   # rps: hook c106 (the Janitor's D407, "add the fed later")
    data = {f: json.load(open(f, encoding="utf-8")) for f in glob.glob(f"{S}/*/{kind}.json")}
    moves = []
    for f, rows in data.items():
        here = f.split("/")[-2]
        for r in rows if isinstance(rows, list) else []:
            if not isinstance(r, dict) or not r.get("id"): continue
            if kind == "rps":   # hook c106: shard-lib shardOf("rps") = promotion ?? venue ?? _unassigned
                want = r.get("promotion") or r.get("venue") or "_unassigned"
            else:
                t0 = (r.get("tenures") or [None])[0]
                want = (t0.get("promotion") if isinstance(t0, dict) else None) or "_unassigned"
            if want != here:
                if os.path.isdir(f"{S}/{want}"): moves.append((r, f, f"{S}/{want}/{kind}.json"))
                else: left += 1; print(f"fix-shard-assignment: {r['id']} resolves to '{want}', which has no shard directory — left in {here}")
    for r, src, dst in moves:
        print(f"fix-shard-assignment: {kind} {r['id']}: {src.split('/')[-2]} -> {dst.split('/')[-2]}")
        moved += 1
        if dry: continue
        data[src] = [x for x in data[src] if x is not r]
        data.setdefault(dst, json.load(open(dst, encoding="utf-8")) if os.path.exists(dst) else [])
        data[dst].append(r)
    if not dry and moves:
        for f in {m[1] for m in moves} | {m[2] for m in moves}: dump(f, data[f])
print(f"fix-shard-assignment: {moved} row(s) {'to move' if dry else 'moved'}, {left} left" + (" [DRY]" if dry else ""))
