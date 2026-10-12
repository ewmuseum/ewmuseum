#!/usr/bin/env python3
"""Standing preflight step (2026-09-14, preflight 142b): three shape rules the validator enforces that lanes keep getting wrong.
(a) promotions.roster_policy must be real|fantasy|blended: "mixed" → "blended"; "unknown"/""/None → the key is removed (an unread
    record carries no roster_policy). (b) an aka may not equal another promotion's own name or aka (case-insensitive): the offending
    aka is dropped from the LATER-minted row (higher position in the file) and logged. (c) a match's "eliminations" must be a
    non-empty array: an empty array is removed (fix-eliminations-shape.py already converts strings). Idempotent; museum only."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json, glob, os
M = f'{_ROOT}'
P = f'{M}/data/promotions.json'; d = json.load(open(P)); rows = d if isinstance(d, list) else d['promotions']
ch = 0; log = []
for r in rows:
    rp = r.get('roster_policy')
    if rp == 'mixed': r['roster_policy'] = 'blended'; ch += 1; log.append(f"{r['id']}: roster_policy mixed→blended")
    elif 'roster_policy' in r and rp not in ('real', 'fantasy', 'blended'): del r['roster_policy']; ch += 1; log.append(f"{r['id']}: roster_policy {rp!r} removed")
names = {}
for i, r in enumerate(rows):          # a promotion's own NAME always outranks any aka, whatever the file order
    if r.get('name'): names.setdefault(r['name'].lower(), (i, r['id'], 'name'))
for i, r in enumerate(rows):
    for n in (r.get('aka') or []):
        if n and n.lower() not in names: names[n.lower()] = (i, r['id'], 'aka')
for i, r in enumerate(rows):
    if not r.get('aka'): continue
    keep = []
    for a in r['aka']:
        o = names.get(a.lower())
        if o and o[1] != r['id'] and (o[2] == 'name' or o[0] < i): log.append(f"{r['id']}: aka {a!r} dropped (collides with {o[1]}.{o[2]})"); ch += 1
        else: keep.append(a)
    if keep: r['aka'] = keep
    else: r.pop('aka', None)
if ch:
    tmp = P + f'.{os.getpid()}.tmp'; json.dump(d, open(tmp, 'w'), indent=2, ensure_ascii=False); open(tmp, 'a').write('\n'); os.replace(tmp, P)
e = 0
for f in glob.glob(f'{M}/data/shards/*/shows.json'):
    try: shows = json.load(open(f))
    except Exception: continue
    t = 0
    for s in shows:
        if not isinstance(s, dict): continue
        for m in s.get('matches') or []:
            if isinstance(m, dict) and 'eliminations' in m and m['eliminations'] in ([], None, ''): del m['eliminations']; t += 1
    if t:
        tmp = f + f'.{os.getpid()}.tmp'; json.dump(shows, open(tmp, 'w'), indent=2, ensure_ascii=False); open(tmp, 'a').write('\n'); os.replace(tmp, f); e += t
print(f'fix-registry-enums: promotions changes {ch} | empty eliminations removed {e}')
for l in log[:12]: print('  ', l)
