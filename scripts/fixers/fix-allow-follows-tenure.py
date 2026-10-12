#!/usr/bin/env python3
"""fix-allow-follows-tenure (2026-09-24, after gates 173 and 174 went red on the same ledger row): an allow row scoped to a wing's
shard (data/shards/<wing>/) covers in-fiction names in that wing's tenure notes. merge-batch.py folds a retired record's tenures into
a survivor that may live in ANOTHER shard, carrying those notes with them — and the gate then finds the name outside the allow's
scope (ledger row 4726: uwf-mar96 → cswa, ffa-toc-2002, bra-1999). This fixer lets the allow follow the tenure: for every allow row
whose scope names data/shards/<P>/, any character or unit whose tenure at promotion P carries the allow's term, living in shard S ≠ P,
gets data/shards/<S>/ appended to that allow's scope — but only where a deny for the same term reaches S (tree-wide, or
scoped to it), so no allow widens where nothing is denied. Only allow rows are touched, only by appending a shard scope already implied by
the row's own wing scope; every change is logged to stdout and to the row's note. Ledger edited by line replacement. Idempotent;
refuses while a gate runs."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
import glob, json, os, re, subprocess, sys, datetime, hashlib
if _live_running("scripts/gate[.]sh", _ROOT):
    print("fix-allow-follows-tenure: a gate is running — skipped"); sys.exit(0)
M = _ROOT; LEDGER = f"{_WORKSHOP}/privacy/redaction-ledger.tsv"
if not os.path.exists(LEDGER): print("fix-allow-follows-tenure: no ledger — skipped"); sys.exit(0)
lines = open(LEDGER, encoding="utf-8").read().split("\n")
allows = []   # (line index, term, wing shards named in scope)
for i, l in enumerate(lines):
    c = l.split("\t")
    if len(c) < 4 or c[2].strip() != "allow" or not c[0].strip(): continue
    wings = re.findall(r"data/shards/([^/,\s]+)/", c[3])
    if wings: allows.append((i, c[0].strip(), set(wings)))
if not allows: print("fix-allow-follows-tenure: 0 allow rows with shard scopes"); sys.exit(0)
denies = {}   # term (lower) -> list of scopes ("" = tree-wide)
for l in lines:
    c = l.split("\t")
    if len(c) >= 4 and c[2].strip() == "deny" and c[0].strip(): denies.setdefault(c[0].strip().lower(), []).append(c[3].strip())
def _denied_in(term, shard):
    # only where a deny for the same term reaches the shard: tree-wide, or scoped to it / to data/ as a whole
    for sc in denies.get(term.lower(), []):
        if not sc: return True
        for part in sc.split(","):
            part = part.strip()
            if part and (f"data/shards/{shard}/".startswith(part) or part in ("data/", "data/shards/")): return True
    return False
need = {}     # line index -> set of shards to add
for kind in ("characters", "units"):
    for f in glob.glob(f"{M}/data/shards/*/{kind}.json"):
        shard = f.split("/")[-2]
        try: rows = json.load(open(f, encoding="utf-8"))
        except Exception: continue
        for r in rows if isinstance(rows, list) else []:
            if not isinstance(r, dict): continue
            for t in r.get("tenures") or []:
                if not isinstance(t, dict): continue
                p = t.get("promotion")
                if not p or p == shard: continue
                blob = json.dumps(t, ensure_ascii=False)
                for (i, term, wings) in allows:
                    if p in wings and shard not in wings and _denied_in(term, shard) and re.search(r"(?<![\w])" + re.escape(term) + r"(?![\w])", blob, re.I):
                        need.setdefault(i, set()).add(shard)
if not need: print("fix-allow-follows-tenure: 0 allow scopes extended"); sys.exit(0)
today = datetime.date.today().isoformat(); n = 0
for i, shards in sorted(need.items()):
    c = lines[i].split("\t"); add = [s for s in sorted(shards) if f"data/shards/{s}/" not in c[3]]
    if not add: continue
    c[3] = c[3].rstrip(",") + "," + ",".join(f"data/shards/{s}/" for s in add)
    c[-1] = c[-1] + f" | {today} fix-allow-follows-tenure: +{', '.join(add)} (a merged tenure carried the in-fiction use)"
    lines[i] = "\t".join(c); n += 1
    print(f"fix-allow-follows-tenure: ledger line {i+1} (sha1:{hashlib.sha1(c[0].strip().lower().encode('utf-8')).hexdigest()[:8]} len {len(c[0].strip())}) +{', '.join(add)}")   # hook c282: a fingerprint, never the term
tmp = LEDGER + ".fat.new"; open(tmp, "w", encoding="utf-8").write("\n".join(lines)); os.replace(tmp, LEDGER)
print(f"fix-allow-follows-tenure: {n} allow scope(s) extended")
