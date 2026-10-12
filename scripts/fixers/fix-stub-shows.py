#!/usr/bin/env python3
"""collected:false show stubs hold nothing to serve: strip matches / non-billed appearances / collection / page from them;
a character carrying staged_gender_grade without a real staged_gender drops the grade. Idempotent; gate-free window only."""
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
st = {'stubs': 0, 'grades': 0, 'stub-stripped': 0}
for f in glob.glob(f'{M}/data/shards/*/shows.json'):
    try: S = json.load(open(f, encoding='utf-8'))
    except Exception: continue
    ch = False
    for s in S:
        if isinstance(s, dict) and s.get('collected') is False:
            for k in ('matches', 'collection', 'page'):
                if k in s: s.pop(k); ch = True
            if 'appearances' in s and not s['appearances']: s.pop('appearances'); ch = True; st['stub-stripped'] += 1
            if s.get('appearances'):
                keep = [a for a in s['appearances'] if isinstance(a, dict) and a.get('kind') == 'billed']
                if len(keep) != len(s['appearances']): s['appearances'] = keep; ch = True
                if not s['appearances']: s.pop('appearances')
            if ch: st['stubs'] += 1
    if ch: json.dump(S, open(f, 'w', encoding='utf-8'), ensure_ascii=False, indent=1); open(f, 'a').write('\n')
for f in glob.glob(f'{M}/data/shards/*/characters.json'):
    try: C = json.load(open(f, encoding='utf-8'))
    except Exception: continue
    ch = False
    for c in C:
        if isinstance(c, dict) and 'staged_gender_grade' in c and c.get('staged_gender') in (None, '', 'unknown'):
            c.pop('staged_gender_grade'); st['grades'] += 1; ch = True
    if ch: json.dump(C, open(f, 'w', encoding='utf-8'), ensure_ascii=False, indent=1); open(f, 'a').write('\n')
print('stub shows stripped:', st['stubs'], '| gender grades dropped:', st['grades'])
