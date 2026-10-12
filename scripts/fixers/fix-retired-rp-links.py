#!/usr/bin/env python3
"""Standing preflight fixer (2026-09-26, preflight 190: wave-COORD-DESK-RULINGS-0926-B retired argyle-pure under the Janitor's
D62 and the PURE rp "Testing" still named it in involves[]; registry-validate refuses an rp tied to an unknown character).
A plain retirement (characters-retire.json, no alias target) leaves nothing to repoint to, so repoint-retired.py can't help.
The ledger is every APPLIED wave's delta/data/characters-retire.json in the workshop. An id on that ledger that is neither a
live character/unit nor an alias is removed from rps' involves[] and references[]. Any other unknown id is left alone for
registry-validate to report (it may be a typo, not a retirement). Idempotent.

c67 SLOW-FIXERS-INCREMENTAL (2026-10-05, D308; CYCLE-TIME-AUDIT target 5: 25 s a preflight, 0 edits in 19 cycle logs,
nearly all of it in the recursive glob over the whole workshop, vault symlinks included). The glob finds every
<dir>/delta/data/characters-retire.json under a non-hidden directory reachable from the workshop (symlinks followed).
The manifest caches the walk: for each directory, its stat key (device, inode, mtime_ns, ctime_ns) — the kernel moves
mtime and ctime on every entry added, removed or renamed in it, and ctime cannot be set back — the names of its
non-hidden sub-directories and symlinks, and whether it holds a characters-retire.json. A directory whose key is the
same is not listed again (a key within 5 s of the walk's start is never trusted: it is stored as racy and the
directory is listed again next run, as git does for racy index entries); every directory is still stat'ed, every symlink re-resolved, and every retire file, APPLIED
marker, shard and alias file is read fresh each run, exactly as before. FULL WALK (the original glob, and a fresh
manifest) whenever: --full, RPLINKS_MODE=full or FIXERS_MODE=full; the manifest is missing, unreadable, of another
shape, schema, workshop root, python version; this file changed; the workshop path is not normalised; or any directory
could be stat'ed but not listed. --no-manifest never reads or writes it. The manifest lives OUTSIDE the museum tree:
$SCRATCH_ROOT/retired-rp-links-manifest.json (override RPLINKS_MANIFEST); written atomically."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
import json, glob
import hashlib, os, stat, sys, time
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
C67_SCHEMA = 1
C67_MANIFEST = _os.environ.get('RPLINKS_MANIFEST') or _os.path.join(_SCRATCH, 'retired-rp-links-manifest.json')
# ---- c67: the cached walk ----------------------------------------------------------------------------------------
def _c67_md5_path(q):
    try:
        with open(q, 'rb') as fh: return hashlib.md5(fh.read()).hexdigest()
    except OSError: return None
use_manifest = '--no-manifest' not in sys.argv
head = {'schema': C67_SCHEMA, 'workshop': os.path.realpath(_WORKSHOP), 'workshop_arg': _WORKSHOP,
        'fixer': _c67_md5_path(os.path.abspath(__file__)), 'python': '%d.%d' % sys.version_info[:2]}
prev_dirs, why = {}, None
if use_manifest:
    if '--full' in sys.argv or os.environ.get('RPLINKS_MODE') == 'full' or os.environ.get('FIXERS_MODE') == 'full':
        why = 'full requested'
    elif os.path.normpath(_WORKSHOP) != _WORKSHOP or not os.path.isabs(_WORKSHOP):
        why = 'workshop path not normalised'
    else:
        try:
            prev = json.load(open(C67_MANIFEST, encoding='utf-8'))
            if not isinstance(prev, dict) or not isinstance(prev.get('dirs'), dict):
                why = 'manifest of another shape'
            else:
                why = next((f'manifest {k} differs' for k, v in head.items() if prev.get(k) != v), None)
                if why is None:
                    prev_dirs = prev['dirs']
        except (OSError, ValueError):
            why = 'no readable manifest'
class _C67Doubt(Exception): pass
def _c67_walk(prev_dirs):
    """The glob's own walk (non-hidden names; directories and symlinks to directories followed), listing a directory only
    when its stat key moved. Returns (retire-file paths exactly as the glob spells them, the new cache, dirs listed)."""
    found, new_dirs, listed = [], {}, 0
    racy_from = time.time_ns() - 5 * 10**9   # a directory touched since then may still change within its timestamp tick
    todo = [('', _WORKSHOP)]
    while todo:
        rel, ab = todo.pop()
        try: st = os.stat(ab)
        except OSError: continue                      # the glob lists nothing under a path it cannot open
        if not stat.S_ISDIR(st.st_mode): continue
        key = [st.st_dev, st.st_ino, st.st_mtime_ns, st.st_ctime_ns]
        e = prev_dirs.get(rel)
        if isinstance(e, list) and len(e) == 3 and e[0] == key:
            names, has = e[1], e[2]
        else:
            names, has = [], False; listed += 1
            try:
                with os.scandir(ab) as it:
                    for entry in it:
                        if entry.name == 'characters-retire.json': has = True
                        if entry.name.startswith('.'): continue
                        try:
                            if entry.is_symlink() or entry.is_dir(follow_symlinks=False): names.append(entry.name)
                        except OSError: names.append(entry.name)   # re-resolved by the stat above when walked
            except OSError:
                raise _C67Doubt('a directory could be stat\'ed but not listed')
            names.sort()
        new_dirs[rel] = [key if max(st.st_mtime_ns, st.st_ctime_ns) < racy_from else None, names, has]
        if len(new_dirs) > 3000000 or rel.count('/') > 200: raise _C67Doubt('walk too large or too deep')
        parts = rel.split('/')
        if has and len(parts) >= 2 and parts[-2:] == ['delta', 'data']:
            found.append(os.path.join(_WORKSHOP, rel, 'characters-retire.json'))
        for n in names:
            todo.append((n if not rel else rel + '/' + n, os.path.join(ab, n)))
    return found, new_dirs, listed
retire_files = None
if use_manifest:
    try:
        retire_files, new_dirs, listed = _c67_walk(prev_dirs if why is None else {})
        print(f'fix-retired-rp-links: walk {"incremental" if why is None else "full (" + why + ")"}; '
              f'{len(new_dirs)} directories, {listed} listed')
        try:
            os.makedirs(os.path.dirname(C67_MANIFEST), exist_ok=True)
            tmp = f'{C67_MANIFEST}.tmp{os.getpid()}'
            with open(tmp, 'w', encoding='utf-8') as fh: json.dump(dict(head, dirs=new_dirs), fh)
            os.replace(tmp, C67_MANIFEST)
        except OSError as e:
            print(f'fix-retired-rp-links: manifest not written ({e.__class__.__name__})')
    except (_C67Doubt, RecursionError) as e:
        print(f'fix-retired-rp-links: walk full ({e}); no manifest written'); retire_files = None
        try: os.remove(C67_MANIFEST)
        except OSError: pass
if retire_files is None:
    retire_files = glob.glob(f'{_WORKSHOP}/**/delta/data/characters-retire.json', recursive=True)
retired = set()
for f in retire_files:
    if not _os.path.exists(f.split('/delta/data/')[0] + '/APPLIED'): continue
    try: retired |= {r['id'] for r in json.load(open(f, encoding='utf-8')) if isinstance(r, dict) and r.get('id')}
    except Exception: pass
live = set()
for f in glob.glob(f'{_ROOT}/data/shards/*/characters.json') + glob.glob(f'{_ROOT}/data/shards/*/units.json'):
    try: live |= {r['id'] for r in json.load(open(f, encoding='utf-8')) if isinstance(r, dict) and r.get('id')}
    except Exception: pass
try: aliased = {a['from'] for a in json.load(open(f'{_ROOT}/data/aliases.json', encoding='utf-8'))['aliases']}
except Exception: aliased = set()
gone = retired - live - aliased
n = 0; where = []; kept = []
for sf in glob.glob(f'{_ROOT}/data/shards/*/rps.json'):
    try: R = json.load(open(sf, encoding='utf-8'))
    except Exception: continue
    if not isinstance(R, list): continue
    ch = False
    for r in R:
        if not isinstance(r, dict): continue
        for k in ('involves', 'references'):
            v = r.get(k)
            if isinstance(v, list) and any(x in gone for x in v):
                # hook c106 (the Janitor's D407): a roleplay no fed claims (no `promotion`) is attached to its characters by
                # `involves` alone. Never empty it: the row is reported and left for registry-validate's hard check.
                if k == 'involves' and 'promotion' not in r and not [x for x in v if x not in gone]:
                    kept.append(r.get('id')); continue
                r[k] = [x for x in v if x not in gone]; ch = True; n += 1; where.append(r.get('id'))
    if ch: json.dump(R, open(sf, 'w', encoding='utf-8'), ensure_ascii=False, indent=1); open(sf, 'a').write('\n')
print(f'fix-retired-rp-links: {len(gone)} retired id(s) on the ledger; rp links removed {n}' + (f' ({", ".join(where[:8])})' if where else ''))
if kept: print(f'fix-retired-rp-links: REPORT {len(kept)} roleplay(s) with no promotion would lose every involves id; left unchanged for the coordinator: {", ".join(str(x) for x in kept[:8])}')
