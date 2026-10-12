#!/usr/bin/env python3
"""Redact every PRIVACY-FAIL hit in a gate log on the served page it names (coordinator, 2026-09-15).
    python3 redact-gate-hits.py <gate log> [--dry]
Each line 'PRIVACY-FAIL: … ledger-row N class=C … : promotions/<page>:<line>:…' names a ledger term (main ledger, physical file line N → list index N-1); the term is replaced on that page — every occurrence, HTML-escaped variants too —
with the class's marker (real-name marker for names; contact marker for contact-detail and login-slug, including inside URLs).
Already-marked spans are never touched. Prints per-page counts. Museum-only; run between a red verdict and the next preflight.
REDACTORS NEVER WRITE INTO MARKUP (hook c80, 2026-10-05; gate 258): an occurrence inside a tag (its name, attributes, attribute
values) or inside a stamped chrome region (scripts/ops/markup_scope.py) is never replaced: it is printed as "in markup / in chrome:
not redacted — the generator must change" with page:line and left alone, so the red stops visibly instead of corrupting the page.
A marker this run inserts is never matched again by a later term. Text between tags outside the chrome is redacted as before."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import sys, re, csv, html, collections
sys.path.insert(0, _TOOLS); from markup_scope import scope_mask, span_kind, line_of, KIND_NAME, TEXT   # hook c80
M = f'{_ROOT}'; LED = f'{_WORKSHOP}/privacy/redaction-ledger.tsv'
log = sys.argv[1]; dry = '--dry' in sys.argv
led = [l.split('\t') for l in open(LED, encoding='utf-8').read().split('\n')]   # PHYSICAL lines: the gate's ledger-row N is file line N (1-based, header counted); csv.reader would merge quoted multi-line notes and shift indices
# hook c208 (the Janitor's D480, 2026-10-09: "(a) plain rename"): the marker carries no category word. The class of
# the gate hit still chooses WHICH of the two forms is written -- a real name takes the name form, everything else the
# detail form -- and the class itself stays in the privacy ledger it was read from, never on the page.
NAME = '<span class="redacted">[name withheld]</span>'
CONTACT = '<span class="redacted">[detail withheld]</span>'
hits = collections.defaultdict(set)
for l in open(log, encoding='utf-8', errors='replace'):
    m = re.search(r'PRIVACY-FAIL:.*?ledger-row (\d+) class=([a-z-]*).*?(?:: | in )(promotions/[^:]+\.html):(\d+)', l)
    if not m: continue
    row = int(m.group(1)); cls = m.group(2) or 'real-name'
    if row - 1 >= len(led) or not led[row - 1]: continue
    term = led[row - 1][0]
    hits[m.group(3)].add((term, cls))
# hook c80: a segment is cut into runs of one scope kind (text / markup / chrome); only text runs are written. Inside a text run
# each replacement is held as a placeholder character until the page is done, so a later term never matches inside a marker.
def runs(mask, a, b):
    i = a
    while i < b:
        k = mask[i]; j = i + 1
        while j < b and mask[j] == k: j += 1
        yield i, j, k; i = j
total = 0; total_kept = 0
for page, terms in sorted(hits.items()):
    p = f'{M}/{page}'
    try: s = open(p, encoding='utf-8').read()
    except FileNotFoundError: print('missing page', page); continue
    mask = scope_mask(s)
    parts = re.split(r'(<span class="redacted">.*?</span>)', s); n = 0; kept = []
    off = 0
    for i, seg in enumerate(parts):
        a, b = off, off + len(seg); off = b
        if seg.startswith('<span class="redacted">'): continue
        out = []
        for ra, rb, kind in runs(mask, a, b):
            run = s[ra:rb]
            for term, cls in terms:
                ph = '\x00' if cls == 'real-name' else '\x01'
                for v in (term, html.escape(term), html.escape(term).replace("'", '&#x27;')):
                    if not v or v not in run: continue
                    if kind == TEXT: n += run.count(v); run = run.replace(v, ph)
                    else:
                        q = 0
                        while True:
                            q = run.find(v, q)
                            if q == -1: break
                            kept.append((line_of(s, ra + q), KIND_NAME[kind])); q += len(v)
            out.append(run)
        parts[i] = ''.join(out).replace('\x00', NAME).replace('\x01', CONTACT)
    if n and not dry: open(p, 'w', encoding='utf-8').write(''.join(parts))
    total += n; print(f'{page}: {n} occurrence(s) of {len(terms)} term(s)')
    for ln, where in sorted(set(kept)):
        total_kept += 1; print(f'{page}:{ln}: {where}: not redacted — the generator must change')
if total_kept: print(f'in markup / in chrome: not redacted — the generator must change: {total_kept} place(s)')
print(f'{"DRY " if dry else ""}redacted {total} occurrence(s) on {len(hits)} page(s)')
