#!/usr/bin/env python3
"""Standing preflight fixer (2026-09-25): lands a wave's delta/data/relationships-append-*.json into data/relationships.json.
No step of window.sh or apply-delta.py read those files, so every edge a wave shipped that way was dropped without a
word. wave-UFW-A (APPLIED) carried six Janitor-ruled same-handler edges that never landed; wave-COORD-GROAN-MENTOR and
wave-SITES-B10-PWA ship the same shape (found by lane DESK-WINGS-0925). Runs over every APPLIED wave in WAVE_TREES
whose file has no .APPLIED marker beside it.
- A row lands only when its id is new, both ends (a, b) are live character or unit ids, and its nature is one
  registry-validate.mjs accepts (RELATIONSHIP_NATURES, read from that file). A 'romantic' edge from wave-SITES-B8
  reddened preflight 184 on 2026-09-25 before this check existed; the museum files an on-screen couple as
  kayfabe-spouse with the detail saying no marriage is staged (kitsune-tsunami-oni-pairing).
- Keys are kept to the live schema (id, a, b, nature, detail, grade, source, era, note). The stray "kind" some lanes
  wrote is dropped.
- Anything else is printed and left.
Idempotent; appends, never rewrites a row. --dry prints and writes nothing."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
import json, glob, re, time, sys
DRY = '--dry' in sys.argv
KEYS = ("id", "a", "b", "nature", "detail", "grade", "source", "era", "note")
cfg = open(f"{_ROOT}/ops/config.env", encoding="utf-8").read()
m = re.search(r'WAVE_TREES="\$\{WAVE_TREES:-(.*?)\}"', cfg, re.S)
trees = [t.strip() for t in (_os.environ.get('WAVE_TREES') or (m.group(1) if m else "")).split("\n") if t.strip()]
RP = f"{_ROOT}/data/relationships.json"; raw = open(RP, encoding="utf-8").read(); R = json.loads(raw)
rows = R["relationships"]; have = {r.get("id") for r in rows}
_rv = open(f"{_ROOT}/scripts/registry-validate.mjs", encoding="utf-8").read()
_m = re.search(r'RELATIONSHIP_NATURES\s*=\s*new Set\(\[([^\]]*)\]', _rv)
NATURES = set(re.findall(r'"([^"]+)"', _m.group(1))) if _m else set()
if not NATURES: sys.exit("apply-relationships-append: could not read RELATIONSHIP_NATURES from registry-validate.mjs; refusing")
live = set()
for f in glob.glob(f"{_ROOT}/data/shards/*/characters.json") + glob.glob(f"{_ROOT}/data/shards/*/units.json"):
    d = json.load(open(f, encoding="utf-8")); rs = d if isinstance(d, list) else next((v for v in d.values() if isinstance(v, list)), [])
    live |= {r.get("id") for r in rs if isinstance(r, dict)}
added = files = 0
for t in trees:
    base = t if _os.path.isabs(t) else _os.path.join(_WORKSHOP, t)
    for f in sorted(glob.glob(f"{base}/**/delta/data/relationships-append-*.json", recursive=True)):
        wave = f.split("/delta/data/")[0]
        if not _os.path.exists(f"{wave}/APPLIED") or _os.path.exists(f + ".APPLIED"): continue
        C = json.load(open(f, encoding="utf-8")); new = C.get("relationships") if isinstance(C, dict) else C
        ok = True
        for r in new or []:
            rid = r.get("id")
            if not rid or rid in have:
                continue
            if r.get("nature") not in NATURES:
                print(f"apply-relationships-append: {_os.path.basename(wave)}: {rid}: nature {r.get('nature')!r} is not one of {'|'.join(sorted(NATURES))}; left")
                ok = False; continue
            if r.get("a") not in live or r.get("b") not in live:
                print(f"apply-relationships-append: {_os.path.basename(wave)}: {rid}: an end is not a live record ({r.get('a')}, {r.get('b')}); left")
                ok = False; continue
            rows.append({k: r[k] for k in KEYS if k in r}); have.add(rid); added += 1
            print(f"apply-relationships-append: {rid} ({_os.path.basename(wave)})")
        files += 1
        if ok and not DRY: open(f + ".APPLIED", "w").write(time.strftime("%Y-%m-%dT%H:%M:%S\n"))
if added and not DRY:
    ind = next((i for i in (1, 2, 4, None) if json.dumps(json.loads(raw), ensure_ascii=False, indent=i) + ("\n" if raw.endswith("\n") else "") == raw), 1)
    open(RP, "w", encoding="utf-8").write(json.dumps(R, ensure_ascii=False, indent=ind) + ("\n" if raw.endswith("\n") else ""))
print(f"apply-relationships-append: {added} edge(s) added from {files} file(s)")
