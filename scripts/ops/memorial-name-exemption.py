#!/usr/bin/env python3
"""memorial-name-exemption.py — THE MEMORIAL REGISTER IS THE EXEMPTION (the Janitor's standing
ruling, GAVELS 2026-09-24 evening, D2: "anyone added to the memorial section should remove
restrictions on naming them"; D5b "memorial exemption rules here"; CURATION #privacy v74:
"A memorial name — an entry in data/memorials.json — is never redacted, in any document,
under either exception").

ONE source of memorial names for every consumer of the privacy ledger, plus the two
report modes the standing mechanism needs:

  --names            print the exempt name set (one per line), for a shell consumer
  --dry-run          every ledger row (main ledger + every ledger-pending fragment +
                     every wave privacy-fragment.tsv) that the register's own exemption
                     suppresses, and what changes about it
  --sweep            the RE-SERVE LIST: every served page, and every wave delta page not
                     yet landed, where a memorial subject's OWN name is currently redacted
  --check            standing check (preflight): the exemption is wired into
                     museum/scripts/privacy-check.mjs, and no inert deny row is unreported.
                     Exit 0 always prints; exit 1 only if the exemption is NOT wired.

EXEMPT NAMES ARE THE SUBJECT'S OWN NAMES ONLY: data/memorials.json's `name`, any `aka`,
and the forename+surname short form of a three-or-more-part name ("Sean Williams" for
"Sean Simon Williams" — the form the register's own served_docs labels already use, and
the form land-check's L-MEM has always accepted). A relative, a fiancée, a fellow writer
or anyone else named near a memorial subject is a DIFFERENT term and stays under the
ordinary rules — the 2026-09-24 ReV 244 tribute keeps its own four redactions.

A wave's own delta/data/memorials-append*.json counts as the register too, so a memorial
lands and its documents serve in the SAME window (the ordering that made the andrew-doran
memorial red twice at gates 171).

Workshop-side; never writes anything.
"""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
if not _os.path.exists(_os.path.join(_ROOT, 'CURATION.md')):
    # the workshop copy of this tool lives three levels under archive/, not under museum/;
    # ops/config.env's own convention is that the two trees are siblings
    _cand = _os.path.join(_os.path.dirname(_ROOT), 'museum')
    if _os.path.exists(_os.path.join(_cand, 'CURATION.md')):
        _ROOT = _cand
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
import sys, os, re, json, glob

M = _ROOT
A = _WORKSHOP
LEDGER = f'{A}/privacy/redaction-ledger.tsv'
SENTINEL = 'MEMORIAL-EXEMPTION-01'

# ---------------------------------------------------------------- the register
def short_form(n):
    """Forename + surname of a three-or-more-part name; None otherwise."""
    p = n.split()
    return f'{p[0]} {p[-1]}' if len(p) > 2 else None

def register_rows():
    """Every memorial row the museum holds, plus every row a wave is about to land."""
    out = []
    try:
        d = json.load(open(f'{M}/data/memorials.json', encoding='utf-8'))
        out += [(r, 'data/memorials.json') for r in (d['memorials'] if isinstance(d, dict) else d)]
    except Exception as e:
        print(f'WARN: no register read from data/memorials.json ({e}) — the exemption is EMPTY, '
              f'which fails in the safe direction (every ledger row stands)', file=sys.stderr)
    for f in sorted(glob.glob(f'{A}/desk/**/waves/*/delta/data/memorials-append*.json', recursive=True)):
        try:
            rows = json.load(open(f, encoding='utf-8'))
            out += [(r, os.path.relpath(f, A)) for r in (rows if isinstance(rows, list) else rows.get('memorials', []))]
        except Exception:
            pass
    return out

def exempt_names():
    """{lowercased name -> (memorial id, the register file it came from, the display name)}"""
    names = {}
    for r, src in register_rows():
        if not isinstance(r, dict):
            continue
        for n in [r.get('name')] + list(r.get('aka') or []):
            if not n:
                continue
            for v in (str(n), short_form(str(n))):
                if v:
                    names.setdefault(v.lower(), (r.get('id') or '?', src, v))
    return names

# ------------------------------------------------------------- the ledger rows
def ledger_files():
    fs = [(LEDGER, 'ledger')]
    fs += [(f, 'ledger-pending') for f in sorted(glob.glob(f'{A}/privacy/ledger-pending/*.tsv'))]
    fs += [(f, 'wave-fragment') for f in sorted(glob.glob(f'{A}/desk/**/waves/*/privacy-fragment.tsv', recursive=True))]
    fs += [(f, 'wave-fragment') for f in sorted(glob.glob(f'{A}/desk/**/waves/*/delta/privacy-fragment.tsv', recursive=True))]
    return fs

def deny_rows(names):
    """Every deny row whose term IS a memorial subject's own name. `status` is matched the way
    privacy-check.mjs matches it (exactly "deny") AND the way the ledger has actually been
    written ("deny (standing, applied not refiled)"), so a loosely-typed row is not missed."""
    out = []
    for path, kind in ledger_files():
        try:
            lines = open(path, encoding='utf-8', errors='replace').read().split('\n')
        except Exception:
            continue
        for i, line in enumerate(lines, 1):
            if not line.strip() or line.startswith('#'):
                continue
            c = (line.split('\t') + [''] * 6)[:6]
            term, cls, status, scope, caught, note = [x.strip() for x in c]
            if term.lower() not in names:
                continue
            # THE ONE ESCAPE HATCH, and it is explicit: a row a curator has RULED to be a
            # different person who happens to share a memorial subject's name (the coincidence
            # case CURATION's "James F" precedent models) carries the literal token
            # MEMORIAL-COLLISION in its note, or class `real-name-collision`. Such a row is NOT
            # suppressed — it keeps denying. No row carries it today; it exists so that a ruled
            # namesake has a place to live other than a silent hole in the exemption.
            collision = cls == 'real-name-collision' or 'MEMORIAL-COLLISION' in note
            out.append(dict(file=os.path.relpath(path, A), kind=kind, row=i, term=term, cls=cls,
                            status=status, scope=scope, caught=caught, note=note,
                            collision=collision,
                            any_deny=status.startswith('deny') and not collision,
                            mem=names[term.lower()]))
    return out

MARKER = re.compile(r'\[redacted\s*(?:—|&mdash;|&#8212;)|\[(?:name|detail) withheld\]')   # hook c208 (D480): both wordings

def page_state(abspath, term):
    """(exists, marker count, name present) for one page on disk."""
    if not os.path.exists(abspath):
        return (False, 0, False)
    t = open(abspath, encoding='utf-8', errors='replace').read()
    present = re.search(r'(?<![A-Za-z])' + re.escape(term) + r'(?![A-Za-z])', t, re.I) is not None
    return (True, len(MARKER.findall(t)), present)

# ---------------------------------------------------------------------- modes
def mode_names():
    for k, (mid, src, disp) in sorted(exempt_names().items()):
        print(f'{disp}\t{mid}\t{src}')

def mode_dry_run():
    names = exempt_names()
    rows = deny_rows(names)
    print(f'# MEMORIAL NAME EXEMPTION — DRY RUN over the real ledger and the real register')
    print(f'# register: {len(names)} exempt name form(s) from {len({v[0] for v in names.values()})} memorial subject(s)')
    print(f'# ledger files scanned: {len(ledger_files())}')
    print()
    if not rows:
        print('no deny row anywhere carries a memorial subject\'s own name — nothing changes')
        return
    print('WHAT CHANGES: each row below stays in the ledger, byte for byte, with its own catch')
    print('provenance intact. It is SUPPRESSED AT LOAD by the register, so it never enters')
    print('privacy-check.mjs\'s deny set: it can never red the gate, it can never be named in a')
    print('gate log, and therefore it can never be picked up by scripts/ops/redact-gate-hits.py')
    print('or scripts/ops/gate-fail-redact.py, which both key off that log. Every suppression is')
    print('reported as PRIVACY-INFO on every gate run, so a name collision stays visible.')
    print()
    for r in sorted(rows, key=lambda r: (r['file'], r['row'])):
        mid, src, disp = r['mem']
        eff = ('SUPPRESSED' if r['any_deny'] else
               'UNCHANGED — ruled namesake (MEMORIAL-COLLISION), keeps denying' if r['collision'] else
               'unchanged (allow row; kept for the header check)')
        print(f'{r["file"]}:{r["row"]}  status={r["status"]!r} class={r["cls"]!r}')
        print(f'    term        {r["term"]!r}  ==  memorial {mid} (recorded as {disp!r} in {src})')
        print(f'    scope       {(r["scope"] or "(tree-wide)")[:160]}')
        print(f'    caught      {r["caught"][:120]}')
        print(f'    effect      {eff}')
        print()
    hard = [r for r in rows if r['any_deny']]
    print(f'# {len(hard)} deny row(s) suppressed; {len(rows) - len(hard)} allow row(s) untouched')

def mode_sweep():
    names = exempt_names()
    rows = [r for r in deny_rows(names) if r['any_deny']]
    # pages a deny row names: its scope prefixes, plus any .html path in its caught/note
    PATH = re.compile(r'(?:promotions|memorials|characters|units|titles|collections|figures|essays)/[A-Za-z0-9._/-]+\.html')
    cand = {}          # (page, term) -> {cites, notes}
    for r in rows:
        paths = [p.strip() for p in r['scope'].split(',') if p.strip().endswith('.html')]
        paths += PATH.findall(r['caught']) + PATH.findall(r['note'])
        for p in paths:
            e = cand.setdefault((p, r['term']), {'cites': set(), 'notes': []})
            e['cites'].add(f'{r["file"]}:{r["row"]}')
            e['notes'].append(r['note'])
    served, waves = [], []
    for (page, term), e in sorted(cand.items()):
        ex, mk, present = page_state(f'{M}/{page}', term)
        if ex and mk and not present:
            served.append((page, mk, sorted(e['cites']), term, ' | '.join(e['notes'])[:240]))
    # Wave delta pages not yet landed. PAGE-LEVEL EVIDENCE ONLY, exactly as for served pages:
    # a deny row on that exact name must NAME THIS PAGE (in its scope, its caught column or its
    # note). A tree-wide deny row is deliberately NOT enough on its own — "this page carries some
    # marker and does not contain the name" is true of thousands of pages that never carried it,
    # and a re-serve list padded with those is a list nobody can act on.
    for f in sorted(glob.glob(f'{A}/desk/**/waves/*/delta/**/*.html', recursive=True)):
        m = re.search(r'/waves/([^/]+)/delta/(.+)$', f)
        if not m:
            continue
        wave, rel = m.group(1), m.group(2)
        t = open(f, encoding='utf-8', errors='replace').read()
        mk = len(MARKER.findall(t))
        if not mk:
            continue
        for k, (mid, src, disp) in names.items():
            if re.search(r'(?<![A-Za-z])' + re.escape(disp) + r'(?![A-Za-z])', t, re.I):
                continue
            hits = [r for r in rows if r['term'].lower() == k
                    and (rel in r['scope'] or rel in r['caught'] or rel in r['note']
                         or os.path.basename(rel) in r['scope'])]
            if hits:
                waves.append((wave, rel, mk, disp, sorted({f'{h["file"]}:{h["row"]}' for h in hits})))
    print('# RE-SERVE LIST — a memorial subject\'s OWN name is currently redacted here')
    print('# (evidence: a deny row on that exact name names the page, the page carries redaction')
    print('#  markers, and the name itself is absent from the page)')
    print()
    print('# markers = the page\'s TOTAL redaction markers, not the memorial name\'s own count:')
    print('# once a name is redacted it is gone from the page, so only the ledger row can say')
    print('# WHICH marker was his. That is why the row is suppressed and never deleted.')
    print()
    print(f'## served pages ({len(served)})')
    for page, mk, cites, term, note in served:
        print(f'{page}\tmarkers={mk}\tname={term!r}\trows={",".join(cites)}\tshape={note}')
    if not served:
        print('(none)')
    print()
    print(f'## wave delta pages not yet landed ({len(waves)})')
    for wave, rel, mk, disp, cites in waves:
        print(f'{wave}\t{rel}\tmarkers={mk}\tname={disp!r}\trows={",".join(cites)}')
    if not waves:
        print('(none)')

def mode_check():
    """Standing preflight check. Reports; only a MISSING exemption is a failure."""
    names = exempt_names()
    rows = deny_rows(names)
    pc = f'{M}/scripts/privacy-check.mjs'
    wired = False
    try:
        wired = SENTINEL in open(pc, encoding='utf-8').read()
    except Exception:
        pass
    hard = [r for r in rows if r['any_deny']]
    print(f'memorial-exemption: {len(names)} exempt name form(s); '
          f'{len(hard)} deny row(s) the register suppresses; '
          f'privacy-check.mjs exemption {"WIRED" if wired else "MISSING"}')
    for r in sorted(hard, key=lambda r: (r['file'], r['row'])):
        print(f'  memorial-exemption: suppressed {r["file"]}:{r["row"]} class={r["cls"]} '
              f'len={len(r["term"])} (memorial {r["mem"][0]}) — inert row, retire or rule on it')
    if not wired:
        print(f'memorial-exemption: RED — {SENTINEL} not found in scripts/privacy-check.mjs; '
              f'the memorial exemption is not enforced by construction (GAVELS 2026-09-24 D2). '
              f'Until it is ported, every memorial name still needs its hand-filed allow rows.',
              file=sys.stderr)
        return 1
    return 0

if __name__ == '__main__':
    mode = (sys.argv[1] if len(sys.argv) > 1 else '--check')
    sys.exit({'--names': mode_names, '--dry-run': mode_dry_run,
              '--sweep': mode_sweep, '--check': mode_check}[mode]() or 0)
