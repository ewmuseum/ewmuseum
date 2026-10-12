#!/usr/bin/env python3
"""Coordinator guard (2026-09-11; 2026-09-11 10:05 page-scoped allows under promotions/<wing>/archive/ now count as wing evidence — gate 119 run 1 missed three personas): a persona allow scoped only to its wing's promotions/ and shard paths fails the gate as soon
as the persona becomes a character record, because the name then propagates to generated surfaces (characters/*.html, the
a-z registers, titles/*.html, data/*.json, neighbouring pager links). For every allow row whose term is the name (or the
label of a reign holder) of a record in the scoped wing's shard, widen the scope to the museum-wide generated surfaces
(the Bilodeau precedent). Idempotent; prints what it widened.

c60 PREFLIGHT-INCREMENTAL (2026-10-05, D308; preflight 256 timed this fixer at 287 s). Two changes, neither of which
changes what is widened:
  1. EVERY INPUT FILE IS PARSED ONCE. The old loop re-read and re-parsed the wing's characters/units/reigns shards for
     every candidate allow row, and data/wanted.json (35 MB) for every row with no shard hit — 4,159 json.load calls,
     ~300 s of the run. The parsed objects are cached per path for the run (nothing writes them during it). The name
     test is the same substring test over a cached, lower-cased name list; a wing whose rows are not the plain shape
     (a row that is not an object, a name or aka that is not a string) is tested by the ORIGINAL per-row code, so a
     malformed shard behaves exactly as before, down to the crash.
  2. A WHOLE-RUN SKIP when nothing it reads has changed. After a run that widened NOTHING (the ledger unwritten), a
     manifest records the md5 of this file, of the ledger, and of every input path the run tried to read (or that it was
     missing). The next run skips only if all of them hash the same; then its answer is provably "0 widened" again.
     Any doubt runs full: --full or WIDEN_MODE=full; no/unreadable manifest; another schema, museum root or ledger
     path; this file changed; the ledger changed; any recorded input changed, appeared or vanished. --dry and
     --no-manifest never read or write it. The manifest lives OUTSIDE the museum tree:
     $SCRATCH_ROOT/widen-persona-allows-manifest.json (override WIDEN_MANIFEST); it is written atomically.
"""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,glob,re,sys,hashlib,io,unicodedata
L=f'{_WORKSHOP}/privacy/redaction-ledger.tsv'; M=f'{_ROOT}/data/shards'
BROAD=['characters/','titles/','units/','collections/','figures/','data/characters','data/reigns','data/promotions.json','data/wanted.json','data/search','data/units','data/awards','data/shows','data/matches','data/appearances','data/titles']

# ---- c60: manifest (whole-run skip) ------------------------------------------------------------------------------
WIDEN_SCHEMA = 1
MANIFEST = _os.environ.get('WIDEN_MANIFEST') or _os.path.join(_SCRATCH, 'widen-persona-allows-manifest.json')
DRY = '--dry' in sys.argv
USE_MANIFEST = not DRY and '--no-manifest' not in sys.argv
FORCE_FULL = '--full' in sys.argv or _os.environ.get('WIDEN_MODE') == 'full'
def _md5_bytes(b): return hashlib.md5(b).hexdigest()
def _text(b): return io.TextIOWrapper(io.BytesIO(b), encoding='utf-8').read()   # exactly open(p, encoding='utf-8').read()
def _md5_path(p):
    try:
        with open(p,'rb') as fh: return _md5_bytes(fh.read())
    except OSError: return None   # missing or unreadable: recorded as such, so appearing later forces a run
_SELF_MD5 = _md5_path(_os.path.abspath(__file__))
_HEAD = {'schema': WIDEN_SCHEMA, 'root': _os.path.realpath(_ROOT), 'ledger': _os.path.realpath(L), 'fixer': _SELF_MD5,
         'python': '%d.%d' % sys.version_info[:2], 'unicode': unicodedata.unidata_version}

ledger_bytes = open(L,'rb').read()
LEDGER_MD5 = _md5_bytes(ledger_bytes)

def _skip_reason():
    """None when the previous no-op answer provably still holds, else why a full run is needed."""
    if FORCE_FULL: return 'full requested'
    try: prev = json.load(open(MANIFEST, encoding='utf-8'))
    except (OSError, ValueError): return 'no readable manifest'
    if not isinstance(prev, dict) or not isinstance(prev.get('inputs'), dict): return 'manifest of another shape'
    for k, v in _HEAD.items():
        if prev.get(k) != v: return f'manifest {k} differs'
    if prev.get('ledger_md5') != LEDGER_MD5: return 'ledger changed'
    for p, h in prev['inputs'].items():
        if _md5_path(p) != h: return 'an input changed'
    return None

if USE_MANIFEST:
    _why = _skip_reason()
    if _why is None:
        print('widen-persona-allows: mode skip (ledger and every recorded input unchanged since a no-op run)')
        print('allows widened:', 0, '', [])
        sys.exit(0)
    print(f'widen-persona-allows: mode full ({_why})')

# ---- c60: parse each input once ----------------------------------------------------------------------------------
_READ = {}      # path -> md5 at first read (None: missing/unreadable)
_JSON = {}      # path -> ('ok', obj) | ('err', exc)
def _load(p):
    if p not in _JSON:
        try:
            b = open(p,'rb').read()
        except Exception as e:
            _READ[p] = None; _JSON[p] = ('err', e); return _JSON[p]
        _READ[p] = _md5_bytes(b)
        try: _JSON[p] = ('ok', json.loads(_text(b)))
        except Exception as e: _JSON[p] = ('err', e)
    return _JSON[p]

_NAMES = {}     # characters/units path -> (n_rows, '\n'.join(lowered names)) or None (irregular: use the original loop)
def _names(p, rows):
    if p not in _NAMES:
        v = None
        if isinstance(rows, list) and all(type(r) is dict for r in rows):
            out = []; ok = True
            for r in rows:
                xs = [r.get('name') or ''] + list(r.get('aka') or [])
                if not all(type(x) is str for x in xs) or not all(type(x) is str for x in (r.get('aka') or [])):
                    ok = False; break
                out.extend(x.lower() for x in xs)
            if ok: v = (len(rows), '\n'.join(out))
        _NAMES[p] = v
    return _NAMES[p]

_LABELS = {}    # reigns path -> '\n'-joined lowered labels of the rows BEFORE the first one the original loop raised on
def _labels(p, rows):
    if p not in _LABELS:
        out = []
        try:
            for r in rows: out.append((r.get('label') or '').lower())
        except Exception: pass
        _LABELS[p] = out
    return _LABELS[p]

_WANTED = []    # [set of lowered names in the prefix before the first raising row] — computed once
def _wanted_names():
    if not _WANTED:
        names = set()
        st, Wd = _load(f'{_ROOT}/data/wanted.json')
        if st == 'ok':
            try:
                wrows=Wd if isinstance(Wd,list) else Wd.get('wanted',Wd.get('rows',[]))
                for r in wrows:
                    if isinstance(r,dict): names.add((r.get('name') or '').lower())
            except Exception: pass
        _WANTED.append(names)
    return _WANTED[0]

lines=_text(ledger_bytes).split('\n'); n=0; out=[]
for i,l in enumerate(lines):
    f=l.split('\t')
    if len(f)<6 or f[2]!='allow': continue
    scope=[s.strip() for s in f[3].split(',') if s.strip()]
    wings={m.group(1) for s in scope for m in [re.match(r'promotions/([^/]+)/',s+'/')] if m}
    if not wings or any(s.startswith('characters/') for s in scope): continue
    term=f[0].lower(); hit=False
    for w in wings:
        for kind in ('characters','units'):
            p=f'{M}/{w}/{kind}.json'
            st, rows = _load(p)
            if st != 'ok': continue
            nm = _names(p, rows)
            if nm is not None:
                # a term never holds '\n' (the ledger is split on it), so a substring of the joined list is a substring
                # of one name; with no rows the original any() never ran.
                if nm[0] and term in nm[1]: hit=True
                continue
            for r in rows:   # irregular shard: the original per-row test, unchanged
                names=[r.get('name') or '']+list(r.get('aka') or [])
                if any(term in (x or '').lower() for x in names): hit=True
        st, rows = _load(f'{M}/{w}/reigns.json')
        if st == 'ok':
            lab = _labels(f'{M}/{w}/reigns.json', rows)
            if lab and term in '\n'.join(lab): hit=True
    if not hit:
        if term in _wanted_names(): hit=True
    if hit:
        f[3]=','.join(scope+[b for b in BROAD if b not in scope]+[f'data/shards/{w}/' for w in sorted(wings) if f'data/shards/{w}/' not in scope]); f[5]+=' || 2026-09-11 coordinator: scope widened to the generated surfaces (character, title, register and data pages) because the persona is a held record.'
        lines[i]='\t'.join(f); n+=1; out.append(('sha1:'+hashlib.sha1(f[0].strip().lower().encode('utf-8')).hexdigest()[:8],sorted(wings)))   # hook c282: a fingerprint, not the term's first characters
if n and not DRY: open(L,'w',encoding='utf-8').write('\n'.join(lines))
print('allows widened:',n,('(dry)' if DRY else ''),out[:12])

if USE_MANIFEST:
    if n == 0:
        # inputs re-hashed now: a file that moved during the run must not be recorded with its old hash
        rec = dict(_HEAD, ledger_md5=LEDGER_MD5, inputs={p: _md5_path(p) for p in sorted(_READ)})
        if any(rec['inputs'][p] != _READ[p] for p in _READ) or _md5_path(L) != LEDGER_MD5:
            print('widen-persona-allows: an input moved during the run; manifest not written')
        else:
            try:
                _os.makedirs(_os.path.dirname(MANIFEST), exist_ok=True)
                tmp = f'{MANIFEST}.tmp{_os.getpid()}'
                with open(tmp,'w',encoding='utf-8') as fh: json.dump(rec, fh)
                _os.replace(tmp, MANIFEST)
            except OSError as e:
                print(f'widen-persona-allows: manifest not written ({e.__class__.__name__})')
    else:
        try: _os.remove(MANIFEST)   # the ledger moved: the next run is a full one, and records then
        except OSError: pass
