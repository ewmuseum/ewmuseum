#!/usr/bin/env python3
"""Standing preflight step (2026-09-25, preflight 182): a title lifecycle event is {type, date, note} (registry-validate.mjs,
THE TITLE-STATUS REFRAME). Lanes keep writing the older {kind, source}: wave-UFW-* shipped ufw-ultra-2000-womans with
kind/source and preflight 182 went red on the missing note. On an event with no note: source→note, and kind→type when type
is absent, on note-less events only (a noted event is left as it is); nothing else changes. Idempotent; museum only (every titles shard + the aggregate data/titles.json)."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import json, glob
M = _ROOT
ch = 0
for P in sorted(glob.glob(f'{M}/data/shards/*/titles.json')) + [f'{M}/data/titles.json']:
    raw = open(P, encoding='utf-8').read(); d = json.loads(raw)
    fmt = next(((i, ea) for i in (1, 2, 4, None) for ea in (False, True)
                if json.dumps(d, ensure_ascii=ea, indent=i) + ('\n' if raw.endswith('\n') else '') == raw), None)
    rows = d if isinstance(d, list) else next((v for v in d.values() if isinstance(v, list)), [])
    n = 0
    for t in rows:
        for e in t.get('events') or []:
            if not isinstance(e, dict) or (isinstance(e.get('note'), str) and e['note'].strip()): continue
            if not (isinstance(e.get('source'), str) and e['source'].strip()): continue   # nothing to promote: left for the validator
            e['note'] = e.pop('source'); n += 1
            if 'type' not in e and 'kind' in e: e['type'] = e.pop('kind')
            print(f"fix-title-event-shape: {P.split('/data/')[1]} {t.get('id')}")
    if n:
        if fmt is None: print(f'fix-title-event-shape: {P} does not round-trip; left alone'); continue
        open(P, 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=fmt[1], indent=fmt[0]) + ('\n' if raw.endswith('\n') else '')); ch += n
print(f'fix-title-event-shape: {ch} field(s) renamed')
