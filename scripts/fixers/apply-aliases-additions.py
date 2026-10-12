#!/usr/bin/env python3
"""Standing preflight fixer (2026-09-25): lands a wave's delta/data/aliases-additions.json into data/aliases.json.
No step of window.sh or apply-delta.py read that file, so every redirect a wave shipped in it was dropped without a word
(wave-UFW-B's the-think-tank-ufw-ultra-2000 -> the-think-tank-pcw never landed; found by wave-COORD-UWF-IDENTITIES-0925,
whose shiatsu-uwf -> kitsune fold ships one). Runs over every APPLIED wave in WAVE_TREES whose aliases-additions.json has
no .APPLIED marker beside it. --dry prints what would land and writes nothing. A row lands only when its "from" is not already an alias and not a live record id, and its
"to" is a live record id or an existing alias target; anything else is printed and left. Idempotent; appends, never
rewrites a row."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
import json, glob, re, time, sys
DRY = '--dry' in sys.argv
cfg = open(f"{_ROOT}/ops/config.env", encoding="utf-8").read()
m = re.search(r'WAVE_TREES="\$\{WAVE_TREES:-(.*?)\}"', cfg, re.S)
trees = [t.strip() for t in (_os.environ.get('WAVE_TREES') or (m.group(1) if m else "")).split("\n") if t.strip()]
AP = f"{_ROOT}/data/aliases.json"; raw = open(AP, encoding="utf-8").read(); A = json.loads(raw)
rows = A["aliases"] if isinstance(A, dict) else A
have = {r.get("from") for r in rows}
live = set()
# 2026-09-27: shows and titles too; aliases.json already forwards 7 retired shows (J27's four UWF duplicates ship more)
for f in glob.glob(f"{_ROOT}/data/shards/*/characters.json") + glob.glob(f"{_ROOT}/data/shards/*/units.json") + glob.glob(f"{_ROOT}/data/shards/*/shows.json") + glob.glob(f"{_ROOT}/data/shards/*/titles.json"):
    d = json.load(open(f, encoding="utf-8")); rs = d if isinstance(d, list) else next((v for v in d.values() if isinstance(v, list)), [])
    live |= {r.get("id") for r in rs if isinstance(r, dict)}
# 2026-09-27 (J49): external figures too (wave-FIGURES-DEDUP-0927 folds duplicate figure rows)
try:
    _xf = json.load(open(f"{_ROOT}/data/external-figures.json", encoding="utf-8"))
    live |= {r.get("id") for r in (_xf.get("external_figures") if isinstance(_xf, dict) else _xf) or [] if isinstance(r, dict)}
except FileNotFoundError: pass
targets = {r.get("to") for r in rows}
added = 0; files = 0
for t in trees:
    base = t if _os.path.isabs(t) else _os.path.join(_WORKSHOP, t)
    for f in sorted(glob.glob(f"{base}/**/delta/data/aliases-additions.json", recursive=True)):
        wave = f.split("/delta/data/")[0]
        if not _os.path.exists(f"{wave}/APPLIED") or _os.path.exists(f + ".APPLIED"): continue
        C = json.load(open(f, encoding="utf-8")); new = C.get("aliases") if isinstance(C, dict) else C
        ok = True
        for r in new or []:
            fr, to = r.get("from"), r.get("to")
            if not fr or not to: print(f"apply-aliases-additions: {wave}: row without from/to left"); ok = False; continue
            if fr in have: continue
            if fr in live: print(f"apply-aliases-additions: {wave}: {fr} is still a live record; left until it is retired"); ok = False; continue
            if to not in live and to not in targets: print(f"apply-aliases-additions: {wave}: target {to} not live; left"); ok = False; continue
            rows.append({k: v for k, v in r.items() if k in ("from", "to", "note")}); have.add(fr); added += 1
            print(f"apply-aliases-additions: {fr} -> {to} ({_os.path.basename(wave)})")
        files += 1
        if ok and not DRY: open(f + ".APPLIED", "w").write(time.strftime("%Y-%m-%dT%H:%M:%S\n"))
if added and not DRY:
    ind = next((i for i in (1, 2, 4) if json.dumps(json.loads(raw), ensure_ascii=False, indent=i) + ("\n" if raw.endswith("\n") else "") == raw), 1)
    open(AP, "w", encoding="utf-8").write(json.dumps(A, ensure_ascii=False, indent=ind) + ("\n" if raw.endswith("\n") else ""))
print(f"apply-aliases-additions: {added} alias(es) added from {files} file(s)")
