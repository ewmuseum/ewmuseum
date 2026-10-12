#!/usr/bin/env python3
"""Order every wing's reigns within each title by won date (stable; undated rows keep their relative place at the end of
their title's run) — waves applied in alphabetical order otherwise leave later reigns listed before earlier ones, which
registry-validate flags. Museum shards only (wave copies are per-wave and already ordered). Idempotent; gate-free."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json, glob, subprocess, sys
M = f'{_ROOT}'
if _live_running("scripts/gate[.]sh", _ROOT): sys.exit("REFUSED: a gate is running")
MON = {m: i for i, m in enumerate(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
                                     'november', 'december'], 1)}
def wk(r):
    # 2026-09-30 (GCW-REIGNS lead): a bracketed or approximate won date ("between 2005-11-20 and 2006-01-14", "before 2003-09",
    # "between 7 April and 2 May 2003", "late 2002") sorts by its first date; it was sent to the end of its title's run, so pages
    # listed e.g. Chris Edge after Tessa Windsor. Only "unknown", "?" and no date stay at the end. Simulated on live: 17 runs reorder, none ambiguous.
    import re
    w = r.get('won') if isinstance(r, dict) else None
    if isinstance(w, dict): w = w.get('date')
    if not w: return (1, '')
    s = str(w)
    if s[0].isdigit(): return (0, s)
    m = re.search(r'\d{4}-\d\d(?:-\d\d)?', s)
    if m: return (0, m.group(0))
    y = re.search(r'\b(1[89]\d\d|20\d\d)\b', s)
    if not y: return (1, '')
    mo = re.search(r'\b(' + '|'.join(MON) + r')\b', s, re.I)
    if mo:
        d = re.search(r'\b(\d{1,2})\s+' + mo.group(1), s, re.I)
        return (0, f"{y.group(1)}-{MON[mo.group(1).lower()]:02d}" + (f"-{int(d.group(1)):02d}" if d else ''))
    return (0, y.group(1))
n = 0
for f in glob.glob(f'{M}/data/shards/*/reigns.json'):
    R = json.load(open(f, encoding='utf-8'))
    if not isinstance(R, list) or not all(isinstance(r, dict) for r in R): continue
    groups = {}; order = []
    for i, r in enumerate(R):
        t = r.get('title'); groups.setdefault(t, []).append(i)
    out = list(R); changed = False
    for t, idx in groups.items():
        rows = [R[i] for i in idx]; dated = [r for r in rows if wk(r)[0] == 0]; undated = [r for r in rows if wk(r)[0] == 1]
        srt = sorted(dated, key=wk) + undated
        if [r.get('id') for r in rows] != [r.get('id') for r in srt]:
            for i, r in zip(idx, srt): out[i] = r
            changed = True; n += 1
    if changed: json.dump(out, open(f, 'w', encoding='utf-8'), ensure_ascii=False, indent=1); open(f, 'a').write('\n')
print('title runs re-ordered:', n)
