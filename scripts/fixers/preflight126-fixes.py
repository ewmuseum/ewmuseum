#!/usr/bin/env python3
"""preflight 126b fixes (2026-09-12): (a) show appearances keyed "character" -> "who" (STRUCTURE-110 uwf-mar96, FTW-1997-SMALL whcw/empire-state);
(b) string show dates -> {date, precision, source}; (c) _unassigned characters whose own promotion resolves to a held wing -> that wing's shard;
(d) match entities missing from their show's own appearances -> append {who, kind: match}. Idempotent."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json, glob, os
M = f'{_ROOT}/data/shards'
def load(p):
    d = json.load(open(p)); return d, (d if isinstance(d, list) else d.get(os.path.basename(p)[:-5], d))
def save(p, d):
    json.dump(d, open(p, 'w'), indent=1, ensure_ascii=False); open(p, 'a').write('\n')
ren = dat = app = 0
for f in glob.glob(f'{M}/*/shows.json'):
    d, rows = load(f); changed = False
    for s in rows:
        if not isinstance(s, dict): continue
        for a in s.get('appearances') or []:
            if isinstance(a, dict) and 'who' not in a and 'character' in a:
                a['who'] = a.pop('character'); ren += 1; changed = True
        if isinstance(s.get('date'), str):
            s['date'] = {'date': s['date'], 'precision': 'exact', 'source': "the card's own posted date"}; dat += 1; changed = True
        have = {a.get('who') for a in s.get('appearances') or [] if isinstance(a, dict) and a.get('kind') == 'match'}
        for m in s.get('matches') or []:
            ents = []
            for side in m.get('sides') or []:
                ents += side.get('members', side) if isinstance(side, dict) else (side if isinstance(side, list) else [side])
            ents += m.get('participants') or []
            for e in ents:
                if isinstance(e, str) and e not in have:
                    s.setdefault('appearances', []).append({'who': e, 'kind': 'match'}); have.add(e); app += 1; changed = True
    if changed: save(f, d)
# (c) refile
moved = 0
up = f'{M}/_unassigned/characters.json'
if os.path.exists(up):
    d, rows = load(up); keep = []
    for c in rows:
        wing = c.get('promotion') or ((c.get('tenures') or [{}])[0].get('promotion'))
        tgt = f'{M}/{wing}/characters.json'
        if wing and wing != '_unassigned' and os.path.exists(tgt):
            td, trows = load(tgt)
            if not any(x.get('id') == c.get('id') for x in trows):
                trows.append(c); save(tgt, td)
            moved += 1
        else:
            keep.append(c)
    if moved:
        if isinstance(d, list): d[:] = keep
        else: d['characters'] = keep
        save(up, d)

# (e) tenure `roles` LIST entries outside the validator's enum (the free-text `role` field is NOT validated and must never be touched — 2026-09-12 lesson)
ROLES={'wrestler','manager','referee','authority-figure','commentator','mascot','other'}
rolefix=0
for f in glob.glob(f'{M}/*/characters.json'):
    d, rows = load(f); changed=False
    for c in rows:
        if not isinstance(c, dict): continue
        for t in c.get('tenures') or []:
            rl=t.get('roles') if isinstance(t,dict) else None
            if isinstance(rl,list):
                nl=[('wrestler' if str(x).lower() in ('billed','competitor','talent') else ('other' if x not in ROLES else x)) for x in rl]
                if nl!=rl: t['roles']=nl; rolefix+=1; changed=True
    if changed: save(f, d)
print(f'preflight126-fixes: tenure roles normalised={rolefix}')

print(f'preflight126-fixes: who-renamed={ren} dates-objectified={dat} appearances-added={app} refiled={moved}')
