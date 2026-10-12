#!/usr/bin/env python3
"""Identity entries whose `with` ids do not exist: resolve through data/aliases.json, else drop the id (an entry left with no
ids is dropped, its note kept on the record); assertion "unresolved" becomes "presumed-same"; stale generated character
pages for aliased ids are removed. Museum shards + wave copies. Idempotent; gate-free window only.
Hook c141 (2026-10-08): a merged / presumed-same entry dropped because its id folded into THIS record (alias -> the record
itself) first files its note on the record's wing as a typed provenance_notes record (merge_evidence.py), as merge-character
now does; the fixer also keeps a shard in its own indent (it wrote every shard it touched at indent 1). ORDER.txt runs it twice:
after the merge-time repairs and again after apply-shard-enrich.py, whose identity_append rows can name a retired id."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json, glob, os, subprocess, sys
M = f'{_ROOT}'; A = f'{_WORKSHOP}'
if _live_running("scripts/gate[.]sh", _ROOT): sys.exit("REFUSED: a gate is running")
def load(p): return json.load(open(p, encoding='utf-8'))
import re, datetime
import merge_evidence as _me   # hook c141
def dump(p, d):
    # hook c141: the file's OWN indent (shards are 1, 2 or 4; a fixed 1 reflowed a whole indent-2 shard), as merge-character.py does
    _m = re.match(r'[\[{][ \t]*\n( +)\S', open(p, encoding='utf-8').read(256)); _i = len(_m.group(1)) if _m else 1
    json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=_i); open(p, 'a').write('\n')
known = set()
for f in glob.glob(f'{M}/data/shards/*/characters.json') + glob.glob(f'{M}/data/shards/*/units.json'):
    for r in load(f):
        if isinstance(r, dict) and r.get('id'): known.add(r['id'])
alias = {a['from']: a['to'] for a in load(f'{M}/data/aliases.json')['aliases']}
fixed = 0; dropped = 0; evid = []
def resolve(x):
    x2 = alias.get(x, x)
    while x2 in alias: x2 = alias[x2]
    return x2
for f in glob.glob(f'{M}/data/shards/*/characters.json') + glob.glob(f'{M}/data/shards/*/units.json') + glob.glob(f'{A}/*/waves/wave-*/delta/data/shards/*/characters.json') + glob.glob(f'{A}/*/waves/wave-*/delta/data/shards/*/units.json'):
    try: R = load(f)
    except Exception: continue
    if not isinstance(R, list): continue
    ch = False
    live = f.startswith(M + '/data/shards/'); wing = os.path.basename(os.path.dirname(f))   # hook c141: wave copies are not filed
    for r in R:
        if not isinstance(r, dict) or not isinstance(r.get('identity'), list): continue
        keep = []
        for e in r['identity']:
            if not isinstance(e, dict): continue
            if e.get('assertion') == 'unresolved': e['assertion'] = 'presumed-same'; ch = True; fixed += 1
            w = e.get('with') if isinstance(e.get('with'), list) else ([e['with']] if e.get('with') else [])
            w2 = []
            for x in w:
                x2 = alias.get(x, x)
                while x2 in alias: x2 = alias[x2]
                if x2 in known and x2 != r.get('id'): w2.append(x2)
            if w2 != w: ch = True; fixed += 1
            if w and not w2:
                note = e.get('note') or e.get('notes')
                # 2026-09-27: append once. A wave re-applied by A4 kept re-adding the same entry each window, and this line
                # appended its note each time (kitsune.notes held the ruling 16 times).
                if note and str(note).strip() not in (r.get('notes') or ''): r['notes'] = ((r.get('notes') or '') + ' ' + str(note)).strip()
                if live and e.get('assertion') in ('merged', 'presumed-same'):
                    for x in w:   # hook c141: an id that folded into this very record: file the note before the entry goes
                        if x != r.get('id') and resolve(x) == r.get('id'):
                            evid.append(_me.carry(M, A, r['id'], wing, x, [e], datetime.date.today().isoformat()).split(';')[0])
                dropped += 1; continue
            e['with'] = w2; keep.append(e)
        if len(keep) != len(r['identity']): ch = True
        r['identity'] = keep
    if ch: dump(f, R)
rm = 0
for a in alias:
    if a in known: continue   # hook c171 (adversarial review 1009, C10): an alias id that is ALSO a record in a shard (rage: a promotion renamed 2026-09-08, and a live character) keeps its page
    p = f'{M}/characters/{a}.html'
    if os.path.exists(p): os.remove(p); rm += 1
print('identity ids resolved/normalised:', fixed, '| entries dropped:', dropped, '| stale alias pages removed:', rm, '| evidence notes: filed %d, already present %d, not filed %d' % (evid.count('filed'), evid.count('present'), len(evid) - evid.count('filed') - evid.count('present')))
