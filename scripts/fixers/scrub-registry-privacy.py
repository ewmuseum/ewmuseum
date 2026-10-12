#!/usr/bin/env python3
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import csv, sys; csv.field_size_limit(sys.maxsize)
"""Gate 79 lesson: URL harvests put feds' own addresses into the served registry, and some of those paths are personal login
slugs the ledger denies; discovery-lane frontier candidates also carried operators' real names in `name`/`notes`; one Fandom
article title carries a real name. Privacy v74 outranks the URL FIELD rule on the SERVED side: this scrubs data/promotions.json
and data/frontier.json against every ledger DENY term (classes real-name, login-slug, contact-detail, contact, email, forename):
a `url` containing a denied term is dropped from the museum (the workshop harvest keeps it for the url-walk) and its host noted;
a `fandom` title containing one is dropped; `name`/`full_name`/`notes`/`qualifier`/`aka` occurrences become a role word.
Idempotent; gate-free window only. Prints counts only, never terms.

c67 SLOW-FIXERS-INCREMENTAL (2026-10-05, D308; CYCLE-TIME-AUDIT target 5: 119 s a preflight, and again in window B2; 93%
of it in `pat.search` over 376k strings). A row is CLEAN when no string scrub_row (or the wanted step) examines matches
`pat`; a clean row is left exactly as it was and bumps nothing. `pat` is <boundary>(term|term|...)<boundary>, so a string
matches under a term set exactly when it matches under one of its terms: a row clean under the old terms can only be
touched by a term ADDED since. The manifest records the md5 of every term (never a term), the md5 of every row a run
found clean (its JSON for promotions/frontier, its examined fields for wanted), and the md5 of each file as this fixer
left it. The next run searches a row it finds by hash with a pattern built from the added terms alone (none when no term
was added); a hit, and every new or changed row, takes the original scrub code with the full `pat`. A file whose bytes
hash as this fixer left them and none of whose rows changed would be re-dumped to the same bytes, so it is not
rewritten. Stats print exactly as before. FULL RUN (and a fresh manifest) whenever: --full, SCRUB_MODE=full or
FIXERS_MODE=full; the manifest is missing, unreadable, of another shape, schema, museum root, python or unicode version;
this file changed; or either term list is empty. --no-manifest never reads or writes it. The manifest lives OUTSIDE the
museum tree: $SCRATCH_ROOT/scrub-registry-privacy-manifest.json (override SCRUB_MANIFEST); written last, atomically."""
import json, re, subprocess, sys, csv, urllib.parse
import hashlib, unicodedata
C67_SCHEMA = 1
C67_MANIFEST = _os.environ.get('SCRUB_MANIFEST') or _os.path.join(_SCRATCH, 'scrub-registry-privacy-manifest.json')
A = f'{_WORKSHOP}'; M = f'{_ROOT}'
if _live_running("scripts/gate[.]sh", _ROOT): sys.exit("REFUSED: a gate is running")
CLASSES = None  # every deny class
terms = []
for row in csv.reader(open(f'{A}/privacy/redaction-ledger.tsv', encoding='utf-8'), delimiter='\t', quoting=csv.QUOTE_NONE):
    if len(row) < 3 or row[0].startswith('#') or row[2] != 'deny' or (len(row) > 3 and row[3].strip() and 'data/' not in row[3] and 'frontier' not in row[3]): continue  # global rows, plus rows scoped to the data files
    t = row[0].strip()
    if len(t) < (3 if row[1] == 'login-slug' else 4): continue
    terms.append((t, row[1]))
pat = re.compile(r'(?<![A-Za-z0-9])(' + '|'.join(re.escape(t) for t, _ in sorted(terms, key=lambda x: -len(x[0]))) + r')(?![A-Za-z0-9])', re.I)
slugpat = re.compile(r'(?<![A-Za-z0-9])(' + '|'.join(re.escape(t) for t, c in terms if c in ('login-slug', 'contact-detail', 'contact', 'email')) + r')(?![A-Za-z0-9])', re.I)
def _c245_write(p, raw, obj, default_indent):
    """hook c245 (lane MERGE-EVIDENCE-FIX, 2026-10-10): write a registry file only when its bytes change, in the file's OWN
    indent (memory registry-json-indent: promotions.json 2, frontier.json 1), by an atomic rename. An indent-1 re-dump of
    promotions.json on every window made merge_evidence refuse every merged pair's evidence from 2026-10-08. True when written."""
    import os as _o, re as _r, json as _j
    m = _r.match(r"[\[{][ \t]*\n( +)\S", raw[:256])
    out = _j.dumps(obj, ensure_ascii=False, indent=len(m.group(1)) if m else default_indent) + "\n"
    if out == raw: return False
    tmp = "%s.c245.%d.tmp" % (p, _o.getpid())
    with open(tmp, "w", encoding="utf-8") as fh: fh.write(out)
    _o.chmod(tmp, _o.stat(p).st_mode & 0o7777); _o.replace(tmp, p); return True
def load(p): return json.load(open(p, encoding='utf-8'))
def dump(p, d): _c245_write(p, open(p, encoding='utf-8').read(), d, 1)   # hook c245: own indent (promotions 2, frontier 1), only on a byte change
stats = {}
def bump(k): stats[k] = stats.get(k, 0) + 1
def scrub_text(s):
    return pat.sub('the operator', s)
def scrub_row(r):
    u = r.get('url')
    if isinstance(u, str) and (pat.search(u) or slugpat.search(u)):
        host = urllib.parse.urlparse(u if '://' in u else 'http://' + u).hostname or ''
        r['url'] = None; r['notes'] = ((r.get('notes') or '') + f' Its own web address (a personal account page on {host}) is held in the workshop, not served.').strip(); bump('url-dropped')
    f = r.get('fandom')
    if isinstance(f, str) and pat.search(f): r.pop('fandom'); bump('fandom-dropped')
    def walk(o, path=''):
        if isinstance(o, dict):
            for k, v in list(o.items()):
                if k in ('url', 'id', 'fandom'): continue
                if isinstance(v, str):
                    if pat.search(v): o[k] = scrub_text(v); bump((path + k).split('.')[-1] + '-scrubbed')
                else: walk(v, path + k + '.')
        elif isinstance(o, list):
            for i, v in enumerate(o):
                if isinstance(v, str):
                    if pat.search(v): o[i] = scrub_text(v); bump('list-item-scrubbed')
                else: walk(v, path)
    walk(r)
    if isinstance(r.get('aka'), list):
        new = [a for a in r['aka'] if not (isinstance(a, str) and pat.search(a))]
        if len(new) != len(r['aka']): r['aka'] = new; bump('aka-dropped')
# ---- c67: the manifest (term md5s; clean-row md5s; each file's md5 as this fixer left it) ---------------------------
def _c67_md5(b): return hashlib.md5(b).hexdigest()
def _c67_md5_path(q):
    try:
        with open(q, 'rb') as fh: return _c67_md5(fh.read())
    except OSError: return None
use_manifest = '--no-manifest' not in sys.argv
head = {'schema': C67_SCHEMA, 'root': _os.path.realpath(M), 'fixer': _c67_md5_path(_os.path.abspath(__file__)),
        'python': '%d.%d' % sys.version_info[:2], 'unicode': unicodedata.unidata_version}
term_md5 = {t: _c67_md5(t.encode('utf-8')) for t, _ in terms}
prev, why = {}, None
if use_manifest:
    if '--full' in sys.argv or _os.environ.get('SCRUB_MODE') == 'full' or _os.environ.get('FIXERS_MODE') == 'full':
        why = 'full requested'
    elif not terms or not any(c in ('login-slug', 'contact-detail', 'contact', 'email') for t, c in terms):
        why = 'a term list is empty'
    else:
        try:
            prev = json.load(open(C67_MANIFEST, encoding='utf-8'))
            if not isinstance(prev, dict) or not isinstance(prev.get('terms'), list) or not isinstance(prev.get('clean'), dict) \
                    or not isinstance(prev.get('out'), dict):
                why = 'manifest of another shape'
            else:
                why = next((f'manifest {k} differs' for k, v in head.items() if prev.get(k) != v), None)
        except (OSError, ValueError):
            why = 'no readable manifest'
        if why: prev = {}
old_terms = set(prev.get('terms', []))
added = [t for t, _ in terms if term_md5[t] not in old_terms] if why is None else []
addpat = re.compile(r'(?<![A-Za-z0-9])(' + '|'.join(re.escape(t) for t in sorted(set(added), key=lambda x: -len(x))) + r')(?![A-Za-z0-9])', re.I) if added else None
if use_manifest:
    print(f'registry privacy scrub: mode {"incremental" if why is None else "full (" + why + ")"}' + (f'; {len(set(added))} term(s) added since the manifest' if why is None else ''))
new_clean = {'promotions': [], 'frontier': [], 'wanted': []}; new_out = {}
reused = 0
def _row_strings(r):
    """Every string scrub_row examines: the top-level url and fandom, and each string walk() visits (url/id/fandom keys
    are skipped at every depth, as walk skips them). The aka filter tests a subset of these."""
    for k in ('url', 'fandom'):
        if isinstance(r.get(k), str): yield r[k]
    stack = [r]
    while stack:
        o = stack.pop()
        if isinstance(o, dict):
            for k, v in o.items():
                if k in ('url', 'id', 'fandom'): continue
                if isinstance(v, str): yield v
                else: stack.append(v)
        elif isinstance(o, list):
            for v in o:
                if isinstance(v, str): yield v
                else: stack.append(v)
def _clean_by_manifest(key, h, strings):
    """True when the row (by hash) was clean under the old terms and no added term touches it."""
    if why is not None or h not in prev_clean[key]: return False
    return addpat is None or not any(addpat.search(x) for x in strings())
prev_clean = {k: set(prev.get('clean', {}).get(k, [])) for k in new_clean}
def _scrub_rows(key, rows):
    """scrub_row on each row, skipping rows the manifest proves clean; True when any row changed."""
    global reused
    before = sum(stats.values())
    for r in rows:
        if use_manifest and isinstance(r, dict):
            h = _c67_md5(json.dumps(r, ensure_ascii=False).encode('utf-8'))
            if _clean_by_manifest(key, h, lambda: _row_strings(r)):
                new_clean[key].append(h); reused += 1; continue
            b = sum(stats.values()); scrub_row(r)
            if sum(stats.values()) == b: new_clean[key].append(h)   # recorded ONLY for a row scrub_row left as it was
        else:
            scrub_row(r)
    return sum(stats.values()) != before
def _write(key, p, d, changed, writer):
    """The original always re-dumps; a file whose bytes are what this fixer last left there, with no row changed,
    would be re-dumped to those same bytes, so it is left alone."""
    cur = _c67_md5_path(p)
    if not changed and cur is not None:   # hook c245: no row changed, nothing to write (full and first runs re-dumped every file)
        new_out[key] = cur; return
    if use_manifest and why is None and not changed and cur is not None and prev.get('out', {}).get(key) == cur:
        new_out[key] = cur; return
    writer(p, d); new_out[key] = _c67_md5_path(p)
p = f'{M}/data/promotions.json'; P = load(p)
_write('promotions', p, P, _scrub_rows('promotions', P['promotions']), dump)
p = f'{M}/data/frontier.json'; F = load(p)
_write('frontier', p, F, _scrub_rows('frontier', F['rows']), dump)

# data/wanted.json (the wanted list): a row whose name is a ledger term is a real person, not a fed — drop it; scrub notes
import os
wp = f'{M}/data/wanted.json'
if os.path.exists(wp):
    W = load(wp); key = 'wanted' if isinstance(W, dict) and 'wanted' in W else ('rows' if isinstance(W, dict) and 'rows' in W else None)
    rows = W[key] if key else (W if isinstance(W, list) else [])
    keep = []; before = sum(stats.values())
    for r in rows:
        if use_manifest and isinstance(r, dict):
            h = _c67_md5(json.dumps([r.get(k) for k in ('name', 'notes', 'why', 'note')], ensure_ascii=False).encode('utf-8'))
            if _clean_by_manifest('wanted', h, lambda: (r[k] for k in ('name', 'notes', 'why', 'note') if isinstance(r.get(k), str))):
                new_clean['wanted'].append(h); reused += 1; keep.append(r); continue
            b = sum(stats.values())
        if isinstance(r, dict) and isinstance(r.get('name'), str) and pat.search(r['name']): bump('wanted-row-dropped'); continue
        if isinstance(r, dict):
            for k in ('notes', 'why', 'note'):
                if isinstance(r.get(k), str) and pat.search(r[k]): r[k] = scrub_text(r[k]); bump('wanted-notes-scrubbed')
        if use_manifest and isinstance(r, dict) and sum(stats.values()) == b: new_clean['wanted'].append(h)   # left as it was
        keep.append(r)
    if key: W[key] = keep
    else: W = keep
    def _dump2(q, d): json.dump(d, open(q, 'w', encoding='utf-8'), ensure_ascii=False, indent=2); open(q, 'a').write('\n')
    _write('wanted', wp, W, sum(stats.values()) != before, _dump2)
if use_manifest:
    try:
        _os.makedirs(_os.path.dirname(C67_MANIFEST), exist_ok=True)
        tmp = f'{C67_MANIFEST}.tmp{_os.getpid()}'
        with open(tmp, 'w', encoding='utf-8') as fh:
            json.dump(dict(head, terms=sorted(set(term_md5.values())), clean=new_clean, out=new_out), fh)
        _os.replace(tmp, C67_MANIFEST)
        print(f'registry privacy scrub: {reused} rows reused from the manifest; {sum(map(len, new_clean.values()))} recorded clean ({C67_MANIFEST})')
    except OSError as e:
        print(f'registry privacy scrub: manifest not written ({e.__class__.__name__})')
print('registry privacy scrub:', stats)
