#!/usr/bin/env python3
"""check-memorial-exemption.py — THE STANDING FIXER for the memorial-name exemption
(the Janitor's standing ruling, GAVELS 2026-09-24 evening RULINGS, D2: "anyone added to the
memorial section should remove restrictions on naming them"; D5b "memorial exemption rules
here"; CURATION #privacy v74, #the-memorial-register).

Proposed ORDER.txt line (museum/scripts/fixers/ORDER.txt, anywhere after
scrub-registry-privacy.py):

    check-memorial-exemption.py

WHAT IT FIXES, AND WHAT IT DELIBERATELY DOES NOT. This fixer NEVER rewrites the privacy
ledger and NEVER un-redacts a page. Three reasons, all of them scars:
  - the ledger is not the register: CURATION defines the exemption as membership in
    data/memorials.json, and a fixer that copies the register into the ledger makes a
    COPY, which drifts the moment either side moves (#the-graph-and-the-bounded-prose-
    surface: if it can be an edge, it's an edge — not a paragraph in 11,967 rows);
  - a rewrite destroys the deny row's own catch provenance (msg_id, page, the ruling that
    filed it) — the 2026-09-04 registry-shape-fixer incident is exactly this shape, run
    museum-wide over existing rows;
  - un-redacting a page is a content judgment (which marker was whose name, and whether a
    namesake is involved), and the Janitor's own review is what the re-serve list is for.

So this fixer's whole job is to keep the mechanism HONEST and the debt VISIBLE:
  1. ASSERT the exemption is actually wired into museum/scripts/privacy-check.mjs
     (sentinel MEMORIAL-EXEMPTION-01). If a future edit drops it, every memorial name
     silently needs hand-filed allow rows again — this is the only thing here that reds.
  2. REPORT every ledger deny row the register suppresses — an inert row that wants
     retiring, or a namesake question for the desk.
  3. REPORT the non-canonical-status rows the gate silently ignores
     (status "deny (standing, applied not refiled)" is not "deny": privacy-check.mjs's
     own `status !== "deny"` test drops it, so such a row has never denied anything).
  4. REGENERATE the re-serve list from files, never by hand (no-hand-maintained-readouts):
     <workshop>/privacy/memorial-reserve-list.tsv.

Exit 1 only on (1). Everything else prints.
"""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
if not _os.path.exists(_os.path.join(_ROOT, 'CURATION.md')):
    _cand = _os.path.join(_os.path.dirname(_ROOT), 'museum')
    if _os.path.exists(_os.path.join(_cand, 'CURATION.md')):
        _ROOT = _cand
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
import sys, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
# The register reader is shared by this fixer and by anything else that needs the exempt name
# set. In the museum it belongs beside land-check.py in scripts/ops/; in the workshop it sits
# next to this file. Both are looked for, in that order.
TOOL = next((p for p in (os.path.join(HERE, '..', 'ops', 'memorial-name-exemption.py'),
                         os.path.join(HERE, 'memorial-name-exemption.py'),
                         os.path.join(_ROOT, 'scripts', 'ops', 'memorial-name-exemption.py'))
             if os.path.exists(p)), os.path.join(HERE, 'memorial-name-exemption.py'))
SENTINEL = 'MEMORIAL-EXEMPTION-01'
OUT = f'{_WORKSHOP}/privacy/memorial-reserve-list.tsv'

def run(mode):
    return subprocess.run([sys.executable, TOOL, mode], capture_output=True, text=True,
                          env={**os.environ, 'MUSEUM_ROOT': _ROOT, 'WORKSHOP_ROOT': _WORKSHOP})

rc = 0
pc = f'{_ROOT}/scripts/privacy-check.mjs'
try:
    wired = SENTINEL in open(pc, encoding='utf-8').read()
except Exception as e:
    wired, _ = False, print(f'check-memorial-exemption: cannot read {pc}: {e}')
print(f'check-memorial-exemption: privacy-check.mjs memorial exemption {"WIRED" if wired else "MISSING"}')
if not wired:
    print(f'check-memorial-exemption: RED — {SENTINEL} is not in scripts/privacy-check.mjs. '
          f'The memorial exemption is not enforced by construction, so every memorial '
          f'subject\'s name is back to needing hand-filed allow rows page by page '
          f'(GAVELS 2026-09-24 D2 retires exactly that). Restore it.', file=sys.stderr)
    rc = 1

# 2 + 3: inert and silently-ignored rows
r = run('--check')
for line in (r.stdout + r.stderr).splitlines():
    if 'suppressed' in line or 'exempt name form' in line:
        print('check-memorial-exemption: ' + line.strip().removeprefix('memorial-exemption: '))

# 4: the re-serve list, regenerated from files
s = run('--sweep')
try:
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('# memorial-reserve-list.tsv — REGENERATED every preflight by '
                'scripts/fixers/check-memorial-exemption.py. Never hand-edited.\n'
                '# Served pages and unlanded wave deltas where a memorial subject\'s OWN name is\n'
                '# currently redacted (GAVELS 2026-09-24 D2). Re-serving is a curator action.\n')
        f.write(s.stdout)
    n = sum(1 for l in s.stdout.splitlines() if l and not l.startswith(('#', '##', '(')))
    print(f'check-memorial-exemption: re-serve list regenerated at '
          f'{os.path.relpath(OUT, _WORKSHOP)} ({n} row(s))')
except Exception as e:
    print(f'check-memorial-exemption: could not write the re-serve list: {e}')

sys.exit(rc)
