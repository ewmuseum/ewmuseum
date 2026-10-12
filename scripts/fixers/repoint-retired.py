#!/usr/bin/env python3
"""Repoint every reference to a retired (aliased) id whose record no longer exists — museum-wide (shards, pages, data/*.json)
and in READY-but-unapplied waves. Covers merge-character.py's step 3 when it did not complete. Idempotent; refuses while a gate runs.

c67 SLOW-FIXERS-INCREMENTAL (2026-10-05, D308; CYCLE-TIME-AUDIT target 5: 127 s a preflight, and again in window B4).
Whether a file is touched at all depends only on its own bytes and on the SET of retired ids (MAP's keys): every pattern
is <fixed opening>(one id)<fixed closing>, so a file matches under a key set exactly when it matches under one of its
keys. The manifest records MAP's keys and, for every file a run left BYTE-UNCHANGED (no reference found), the md5 of its
bytes. The next run treats a file whose bytes hash the same as clean under the old keys, so it can only be touched by
an id ADDED since: those files are searched with the same patterns built from the added ids alone (no search at all
when none was added); any hit, and every new or changed file, takes the original code with the full MAP. So no skip
ever skips a write, and the summary prints the same numbers. FULL RUN (and a fresh manifest) whenever: --full,
REPOINT_MODE=full or FIXERS_MODE=full; the manifest is missing, unreadable, of another shape, schema, museum or workshop
root, python or unicode version; or this file changed. --dry-run and --no-manifest never read or write it. The manifest
lives OUTSIDE the museum tree: $SCRATCH_ROOT/repoint-retired-manifest.json (override REPOINT_MANIFEST); written last,
atomically."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,glob,os,re,subprocess,sys
import hashlib,io,unicodedata
import merge_hygiene as _mh   # hook c281 (lane MERGE-HYGIENE, 2026-10-11): the repoint tidies the self-edges and doubled ids it makes
_C281=[[],0]   # hook c281: self-edges removed, doubled ids removed
C67_SCHEMA = 1
C67_MANIFEST = os.environ.get('REPOINT_MANIFEST') or os.path.join(_SCRATCH, 'repoint-retired-manifest.json')
if _live_running("scripts/gate[.]sh", _ROOT): sys.exit("REFUSED: a gate is running")
M=f'{_ROOT}'; W=f'{_WORKSHOP}'
AL={a['from']:a['to'] for a in json.load(open(f'{M}/data/aliases.json',encoding='utf-8'))['aliases']}
def canon(c,seen=()): return canon(AL[c],seen+(c,)) if c in AL and c not in seen else c
live=set()
for f in glob.glob(f'{M}/data/shards/*/characters.json')+glob.glob(f'{M}/data/shards/*/units.json'):
    for r in json.load(open(f,encoding='utf-8')):
        if isinstance(r,dict): live.add(r['id'])
MAP={a:canon(a) for a in AL if a not in live and canon(a) in live and canon(a)!=a}
print('retired ids with live targets:',len(MAP))
# 2026-09-27 (coordinator; lane UWF-FOLDS found it): the old bare-word pattern rewrote ANY standalone token equal to a
# retired id inside served verbatim text ("a destroyer of worlds" -> "a the-eliminator-danny-williams of worlds",
# "a large hessian bag", "shiatsu massages"), breaking #verbatim-serving. A reference is now ONLY: a whole JSON string
# equal to the id; a /characters/ or /units/ page path; a data-entity attribute; or a link query value (?who=<id>).
# Prose is never touched. The damage the old pattern already did is repaired by its own wave, not here.
ALT='|'.join(re.escape(k) for k in sorted(MAP,key=len,reverse=True)) or '(?!)'
REF=[re.compile(r'(/(?:characters|units)/)('+ALT+r')(\.html)'),
     re.compile(r'(data-entity=")('+ALT+r')(")'),
     re.compile(r'([?&][a-z_]+=)('+ALT+r')((?=["&#\s]))')]
JSTR=re.compile(r'(")('+ALT+r')(")')
DRY='--dry-run' in sys.argv
files=[f for f in glob.glob(f'{M}/data/shards/*/*.json')+glob.glob(f'{M}/promotions/**/*.html',recursive=True)+glob.glob(f'{M}/characters/**/*.html',recursive=True)+glob.glob(f'{M}/data/*.json') if not f.endswith('aliases.json')]
for w in glob.glob(f'{W}/usenet-retro/scratch-*/wave-*/')+glob.glob(f'{W}/pt-scene/wave-*/')+glob.glob(f'{W}/desk/provenance-clean/wave-*/')+glob.glob(f'{W}/desk/argyle/waves/wave-*/'):
    if os.path.exists(w+'READY') and not os.path.exists(w+'APPLIED'): files+=glob.glob(w+'delta/**/*.json',recursive=True)+glob.glob(w+'delta/**/*.html',recursive=True)
n=0; hits=0

# ---- c67: the manifest (MAP's keys; files this fixer left byte-unchanged, by md5) ------------------------------------
def _c67_md5_path(q):
    try:
        with open(q, 'rb') as fh: return hashlib.md5(fh.read()).hexdigest()
    except OSError: return None
use_manifest = not (DRY or '--no-manifest' in sys.argv)
head = {'schema': C67_SCHEMA, 'root': os.path.realpath(M), 'workshop': os.path.realpath(W),
        'fixer': _c67_md5_path(os.path.abspath(__file__)), 'python': '%d.%d' % sys.version_info[:2],
        'unicode': unicodedata.unidata_version}
prev_files, prev_keys, why = {}, set(), None
if use_manifest:
    if '--full' in sys.argv or os.environ.get('REPOINT_MODE') == 'full' or os.environ.get('FIXERS_MODE') == 'full':
        why = 'full requested'
    else:
        try:
            prev = json.load(open(C67_MANIFEST, encoding='utf-8'))
            if not isinstance(prev, dict) or not isinstance(prev.get('files'), dict) or not isinstance(prev.get('keys'), list):
                why = 'manifest of another shape'
            else:
                why = next((f'manifest {k} differs' for k, v in head.items() if prev.get(k) != v), None)
                if why is None:
                    prev_files, prev_keys = prev['files'], set(prev['keys'])
        except (OSError, ValueError):
            why = 'no readable manifest'
added = sorted(set(MAP) - prev_keys)
if use_manifest:
    print(f'repoint-retired: mode {"incremental" if why is None else "full (" + why + ")"}' + (f'; {len(added)} id(s) added since the manifest' if why is None else ''))
ALT_A='|'.join(re.escape(k) for k in sorted(added,key=len,reverse=True)) or '(?!)'
REF_A=[re.compile(r'(/(?:characters|units)/)('+ALT_A+r')(\.html)'),
       re.compile(r'(data-entity=")('+ALT_A+r')(")'),
       re.compile(r'([?&][a-z_]+=)('+ALT_A+r')((?=["&#\s]))')]
JSTR_A=re.compile(r'(")('+ALT_A+r')(")')
new_files = {}
reused = searched = 0

for f in files:
    try:
        raw=open(f,'rb').read()
        if use_manifest:
            fh_=hashlib.md5(raw).hexdigest()
            if prev_files.get(f) == fh_:   # clean under the old keys: only an added id can touch it
                if not added: new_files[f]=fh_; reused+=1; continue
                s=io.TextIOWrapper(io.BytesIO(raw),encoding='utf-8').read(); searched+=1
                if not any(rx.search(s) for rx in (REF_A+[JSTR_A] if f.endswith('.json') else REF_A)):
                    new_files[f]=fh_; reused+=1; continue
        s=io.TextIOWrapper(io.BytesIO(raw),encoding='utf-8').read()   # = open(f,encoding='utf-8').read()
    except Exception: continue
    k=0; _s0=s
    for rx in (REF+[JSTR] if f.endswith('.json') else REF):
        s,kk=rx.subn(lambda m: m.group(1)+MAP[m.group(2)]+m.group(3),s); k+=kk
    if k:
        n+=1; hits+=k
        if f.endswith('.json'): s,_e,_d=_mh.tidy(_s0,s); _C281[0]+=_e; _C281[1]+=_d   # hook c281 (merge_hygiene.py)
        if DRY: print('  would repoint',k,'in',f.replace(M+'/',''))
        else: open(f,'w',encoding='utf-8').write(s)
    elif use_manifest: new_files[f]=fh_   # recorded ONLY for a file left byte-unchanged
if use_manifest:
    try:
        os.makedirs(os.path.dirname(C67_MANIFEST), exist_ok=True)
        tmp=f'{C67_MANIFEST}.tmp{os.getpid()}'
        with open(tmp,'w',encoding='utf-8') as fh: json.dump(dict(head, keys=sorted(MAP), files=new_files), fh)
        os.replace(tmp, C67_MANIFEST)
        print(f'repoint-retired: {reused} of {len(files)} files reused from the manifest ({searched} searched for added ids); {len(new_files)} recorded ({C67_MANIFEST})')
    except OSError as e:
        print(f'repoint-retired: manifest not written ({e.__class__.__name__})')
print('merge hygiene (hook c281):',_mh.summary(*_C281))
print(('WOULD repoint' if DRY else 'files repointed:'),n,'| references:',hits)
