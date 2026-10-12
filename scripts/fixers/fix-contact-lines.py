#!/usr/bin/env python3
"""Standing preflight step (2026-09-15, gate 143 run 3): out-of-character contact lines on served pages — "AOL IM = handle",
"AIM: handle", "ICQ = 12345678", "MSN/Yahoo IM: handle", "E-mail: user@host" — are contact details (LAW-INDEX §2) whatever
the ledger holds. The value is replaced by the contact marker when it is handle-shaped: no spaces, 5–40 chars, and carrying a
digit, '@', '.', or mixed/lower case (a plain Capitalised word such as "Mail" is left alone). Already-redacted values are skipped.
Every new handle is appended to privacy/redaction-ledger.tsv as a tree-wide contact-detail deny so the gate enforces it.

c67 SLOW-FIXERS-INCREMENTAL (2026-10-05, D308; CYCLE-TIME-AUDIT target 5: 48 s a preflight, 0 edits in 19 cycle logs).
A page's rewrite, and the handles it yields, are a pure function of its own bytes, this file and /usr/share/dict/words
(handle_shaped's dictionary); a page left byte-unchanged yields no handle (a handle is collected only where it is
replaced). The manifest records, for every page a run left BYTE-UNCHANGED, the md5 of its bytes; the next run skips a
page only when its bytes hash the same, so a skip never skips a write or a handle, and the ledger step runs as before.
FULL RUN (and a fresh manifest) whenever: --full, CONTACT_MODE=full or FIXERS_MODE=full; the manifest is missing,
unreadable, of another shape, schema, museum root, python or unicode version; this file or the dictionary changed.
--no-manifest never reads or writes it. The manifest lives OUTSIDE the museum tree:
$SCRATCH_ROOT/contact-lines-manifest.json (override CONTACT_MANIFEST); written atomically, before the ledger step."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import re, glob, csv, html, os
import hashlib, io, json, sys, unicodedata
C67_SCHEMA = 1
C67_MANIFEST = os.environ.get('CONTACT_MANIFEST') or os.path.join(_SCRATCH, 'contact-lines-manifest.json')
M = f'{_ROOT}'; LED = f'{_WORKSHOP}/privacy/redaction-ledger.tsv'
MARK = '<span class="redacted">[detail withheld]</span>'  # the law's own span (CURATION §2), 2026-09-21; its words, the Janitor's D480, hook c208
LABEL = re.compile(r'((?:AOL\s*IM|AIM|ICQ|MSN(?:\s*IM)?|Yahoo(?:\s*IM)?|E-?mail|Email)\s*[=:]\s*)([^\s<\[][^\s<]{2,40})', re.I)
try:
    _DICT = {w.strip().lower() for w in open('/usr/share/dict/words', encoding='utf-8', errors='ignore') if w.strip().isalpha()}
except Exception:
    _DICT = set()
STOP = {'timezone', 'time zone', 'tag-team', 'tag team', 'tagteam', 'e-wrestling', 'ewrestling', 'e wrestling', 'wrestling', 'subject', 'unknown', 'mailto', 'none', 'address', 'addresses', 'available', 'wrestler', 'wrestlers', 'yahoo', 'aol', 'hotmail', 'here', 'below', 'above', 'coming', 'soon', 'me', 'us'}
def handle_shaped(v):
    v = html.unescape(v).rstrip('.,;:)!')
    lo = v.lower()
    if len(v) < 5 or lo.startswith(('[redacted', 'http', 'www.')) or lo.rstrip("'s") in STOP: return None
    # 2026-09-21 (TimeZone, E-Wrestling, Tag-Team): a candidate made only of dictionary words (split on hyphen/space) is a label or prose, never a handle
    if "@" not in v and not any(ch.isdigit() for ch in v):
        _parts = [x for x in lo.replace("-", " ").replace("_", " ").split() if x]
        if _parts and all(x in _DICT for x in _parts): return None
    if "'" in v or '/' in v or '"' in v or v.isupper() or not v[0].isalnum() or lo in ('e-mail', 'email', 'e-mail:'): return None   # prose, slashes, ALL-CAPS labels, punctuation-led fragments, a label used as a value
    if '@' in v or any(c.isdigit() for c in v): return v                       # addresses and numbered handles
    if v.islower() and len(v) >= 8 and v.isalpha():                            # long lowercase handles (an unbroken lowercase word)
        if v in _DICT: return None                                             # 2026-09-20: an ordinary English word after "E-mail:" is prose, not a handle ("organized" was filed as a tree-wide deny)
        return v
    if any(c.isupper() for c in v[1:]) and any(c.islower() for c in v): return v   # mixed-case handles (an inner capital after the first letter)
    return None
try:
    _DICT = {w.strip().lower() for w in open('/usr/share/dict/words', encoding='utf-8', errors='replace') if w.strip().isalpha()}
except Exception:
    _DICT = {"organized","organised","wrestling","federation","championship","everyone","anything","something","information","application","interested","available"}
handles = set(); pages = 0

# ---- c67: the manifest (pages this fixer left byte-unchanged, by md5) ------------------------------------------------
def _c67_md5_path(q):
    try:
        with open(q, 'rb') as fh:
            return hashlib.md5(fh.read()).hexdigest()
    except OSError:
        return None
use_manifest = '--no-manifest' not in sys.argv
head = {'schema': C67_SCHEMA, 'root': os.path.realpath(M), 'fixer': _c67_md5_path(os.path.abspath(__file__)),
        'dict': _c67_md5_path('/usr/share/dict/words'), 'python': '%d.%d' % sys.version_info[:2],
        'unicode': unicodedata.unidata_version}
prev_pages, why = {}, None
if use_manifest:
    if '--full' in sys.argv or os.environ.get('CONTACT_MODE') == 'full' or os.environ.get('FIXERS_MODE') == 'full':
        why = 'full requested'
    else:
        try:
            prev = json.load(open(C67_MANIFEST, encoding='utf-8'))
            if not isinstance(prev, dict) or not isinstance(prev.get('pages'), dict):
                why = 'manifest of another shape'
            else:
                why = next((f'manifest {k} differs' for k, v in head.items() if prev.get(k) != v), None)
                if why is None:
                    prev_pages = prev['pages']
        except (OSError, ValueError):
            why = 'no readable manifest'
    print(f'fix-contact-lines: mode {"incremental" if why is None else "full (" + why + ")"}')
new_pages = {}
reused = n_seen = 0

for p in glob.glob(f'{M}/promotions/*/archive/*.html') + glob.glob(f'{M}/promotions/*/rp/*.html'):
    n_seen += 1
    raw = open(p, 'rb').read()
    if use_manifest:
        rel = os.path.relpath(p, M); ph = hashlib.md5(raw).hexdigest()
        if prev_pages.get(rel) == ph:   # left byte-unchanged by a run of this same file: the same bytes give the same no-op
            new_pages[rel] = ph; reused += 1
            continue
    s = io.TextIOWrapper(io.BytesIO(raw), encoding='utf-8').read()   # = open(p, encoding='utf-8').read()
    if 'IM' not in s and 'ICQ' not in s and 'mail' not in s.lower():
        if use_manifest: new_pages[rel] = ph
        continue
    def rep(m):
        v = handle_shaped(m.group(2))
        if not v: return m.group(0)
        handles.add(v); return m.group(1) + MARK
    t = LABEL.sub(rep, s)
    if t != s: open(p, 'w', encoding='utf-8').write(t); pages += 1
    elif use_manifest: new_pages[rel] = ph   # recorded ONLY for a page left byte-unchanged

if use_manifest:
    try:
        os.makedirs(os.path.dirname(C67_MANIFEST), exist_ok=True)
        tmp = f'{C67_MANIFEST}.tmp{os.getpid()}'
        with open(tmp, 'w', encoding='utf-8') as fh:
            json.dump(dict(head, pages=new_pages), fh)
        os.replace(tmp, C67_MANIFEST)
        print(f'fix-contact-lines: {reused} of {n_seen} pages reused from the manifest; {len(new_pages)} recorded ({C67_MANIFEST})')
    except OSError as e:
        print(f'fix-contact-lines: manifest not written ({e.__class__.__name__})')
have = {r[0] for r in csv.reader(open(LED, encoding='utf-8'), delimiter='\t') if r}
n = 0
with open(LED, 'a', newline='', encoding='utf-8') as f:
    w = csv.writer(f, delimiter='\t', lineterminator='\n')
    for h in sorted(handles):
        if h in have: continue
        w.writerow([h, 'contact-detail', 'deny', '', 'fix-contact-lines standing fixer', 'Instant-messenger handle or address in an out-of-character contact line on a served page (LAW-INDEX §2).']); n += 1
print(f'fix-contact-lines: pages edited {pages} | handles {len(handles)} | ledger rows appended {n}')
