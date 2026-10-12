#!/usr/bin/env python3
"""Standing preflight fixer (2026-09-26, preflight 190: wave-FW-MIRROR-E2D-CSWA's characters-corrections set four
records' identity to a single object, and registry-validate crashed iterating it). identity[] is ALWAYS a list of
assertion objects. A bare object becomes a one-item list; a null becomes []. Shards only: build:data regenerates the
monoliths from them. Idempotent."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import json, glob
n = 0; where = []
def fix_rows(R):
    global n
    ch = False
    for r in R:
        if isinstance(r, dict) and 'identity' in r and not isinstance(r['identity'], list):
            v = r['identity']; r['identity'] = [] if v is None else [v]; ch = True; n += 1; where.append(r.get('id'))
    return ch
for sf in glob.glob(f'{_ROOT}/data/shards/*/*.json'):
    if '/_headers/' in sf: continue
    try: R = json.load(open(sf, encoding='utf-8'))
    except Exception: continue
    if isinstance(R, list) and fix_rows(R):
        json.dump(R, open(sf, 'w', encoding='utf-8'), ensure_ascii=False, indent=1); open(sf, 'a').write('\n')
print(f'fix-identity-shape: identity objects wrapped as lists {n}' + (f' ({", ".join(sorted(set(where))[:8])})' if where else ''))
