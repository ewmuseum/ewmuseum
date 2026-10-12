#!/usr/bin/env python3
"""Match/show/unit shape fixes surfaced by preflight 90b (2026-09-09): a match `result` outside draw|no-contest|double-pin
is a finish type (countout, dq, submission…) — moved into the match's `how` note and dropped so winner_side stands; a
draw/no-contest with a winner_side drops the winner_side; empty-string show fields are dropped; a unit filed in a wing
shard with no tenures gets one in that wing so the sharding rule resolves. Idempotent; gate-free window only."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json, glob, subprocess, sys, os
M = f'{_ROOT}'
if _live_running("scripts/gate[.]sh", _ROOT): sys.exit("REFUSED: a gate is running")
OK = {'draw', 'no-contest', 'double-pin'}; st = {'result-moved': 0, 'winner-dropped': 0, 'empty-dropped': 0, 'unit-tenure': 0, 'stub-stripped': 0}
def _own_indent(path, default=1):
    # 2026-09-28: rewrite a shard in its OWN indent (shards vary: 1, 2 or 4), never a fixed guess
    try:
        with open(path, encoding='utf-8') as _fh: _fh.readline(); _l = _fh.readline()
        return (len(_l) - len(_l.lstrip(' '))) or default
    except Exception: return default
# 2026-09-28 (preflight 206 red): the unit ids and their members, for an elimination whose `who` is a list
UNIT_MEMBERS = {}
for _uf in glob.glob(f'{M}/data/shards/*/units.json'):
    try:
        for _u in json.load(open(_uf, encoding='utf-8')):
            if isinstance(_u, dict) and _u.get('id'):
                UNIT_MEMBERS[_u['id']] = {x.get('character_id') for x in (_u.get('members') or []) if isinstance(x, dict)}
    except Exception: pass
for f in glob.glob(f'{M}/data/shards/*/shows.json'):
    try: S = json.load(open(f, encoding='utf-8'))
    except Exception: continue
    ch = False
    for s in S:
        if not isinstance(s, dict): continue
        for k in list(s):
            v = s[k]
            if v is None or (isinstance(v, str) and v.strip() == '') or (isinstance(v, dict) and not any(str(x).strip() for x in v.values())): s.pop(k); st['empty-dropped'] += 1; ch = True
        if s.get('collected') is False:
            for k in ('matches', 'collection', 'page'):
                if k in s: s.pop(k); ch = True; st['stub-stripped'] += 1
            if 'appearances' in s and not s['appearances']: s.pop('appearances'); ch = True; st['stub-stripped'] += 1
            if s.get('appearances'):
                keep = [a for a in s['appearances'] if isinstance(a, dict) and a.get('kind') == 'billed']
                if len(keep) != len(s['appearances']): s['appearances'] = keep; ch = True; st['stub-stripped'] += 1
                if not s['appearances']: s.pop('appearances')
        for m in s.get('matches') or []:
            if not isinstance(m, dict): continue
            # 2026-09-27 (preflight 203 red): a match needs exactly one of sides/participants. A correction that adds
            # `sides` to a match already carrying `participants` (wave UWF-DUPLICATES-0927, uwf-wnu-2003-04-30) leaves
            # both; when the sides name exactly the participants, the flat list is redundant and is dropped.
            if isinstance(m.get('sides'), list) and isinstance(m.get('participants'), list):
                flat = [x for side in m['sides'] if isinstance(side, list) for x in side]
                if sorted(map(str, flat)) == sorted(map(str, m['participants'])):
                    m.pop('participants'); st['sides-participants'] = st.get('sides-participants', 0) + 1; ch = True
            # 2026-09-28 (preflight 206 red, sccw-2005 Killzone 19 m4): an elimination's `who` must be one id or label. A
            # list naming exactly one unit id plus only members of that unit is the unit's elimination: `who` becomes the
            # unit id. Any other list is left for the validator and a reader.
            for e in m.get('eliminations') or []:
                if isinstance(e, dict) and isinstance(e.get('who'), list):
                    us = [x for x in e['who'] if x in UNIT_MEMBERS]
                    if len(us) == 1 and all(x == us[0] or x in UNIT_MEMBERS[us[0]] for x in e['who']):
                        e['who'] = us[0]; st['elim-who-unit'] = st.get('elim-who-unit', 0) + 1; ch = True
            r = m.get('result')
            if r is not None and r not in OK:
                if m.get('winner_side') is not None:
                    m['how'] = (m.get('how') or '') + ((' ' if m.get('how') else '') + f'finish: {r}'); m.pop('result'); st['result-moved'] += 1; ch = True
                else: m['how'] = (m.get('how') or '') + ((' ' if m.get('how') else '') + f'finish: {r}'); m['result'] = 'no-contest'; st['result-moved'] += 1; ch = True
            elif r in OK and m.get('winner_side') is not None:
                m.pop('winner_side'); st['winner-dropped'] += 1; ch = True
    if ch: _ind = _own_indent(f); json.dump(S, open(f, 'w', encoding='utf-8'), ensure_ascii=False, indent=_ind); open(f, 'a').write('\n')
for f in glob.glob(f'{M}/data/shards/*/units.json'):
    wing = f.split('/shards/')[1].split('/')[0]
    if wing.startswith('_'): continue
    try: U = json.load(open(f, encoding='utf-8'))
    except Exception: continue
    ch = False
    for u in U:
        if isinstance(u, dict) and not u.get('tenures'):
            u['tenures'] = [{'promotion': wing, 'roles': ['wrestler'], 'first_seen': None, 'last_seen': None, 'source': "Billed on the promotion's own cards."}]; st['unit-tenure'] += 1; ch = True
    if ch: _ind = _own_indent(f); json.dump(U, open(f, 'w', encoding='utf-8'), ensure_ascii=False, indent=_ind); open(f, 'a').write('\n')
print('fix-matches-shape:', st)
