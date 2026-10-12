#!/usr/bin/env python3
"""Standing preflight fixer (2026-09-28, wave-WSO-EBWF-D2, on wave-WSO-EBWF-C's own finding): the promotion-level
auto-linker wired the word "Iron Man" in ebwf-2001's own served index epitaph to another wing's character page
(/characters/jack-paine-sewf.html, an unrelated SEWF character whose name happens to match), instead of leaving it
as EBWF's own Iron Man Championship -- the title row that did not exist yet when that index page was first stamped.
Now that wave-WSO-EBWF-C has landed titles.json's "ebwf-2001-iron-man" row (and its generated /titles/ebwf-2001-
iron-man.html page), this repoints the one known-bad anchor to it. A one-time auto-link error, not something the
auto-linker will re-derive correctly on its own (it never re-scans text already inside an anchor), so this is a
targeted repair of the live page rather than a data correction -- references only, idempotent (a no-op once fixed
or if the page is not present)."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))

BAD = '<a href="/characters/jack-paine-sewf.html" class="entity-link" data-entity="jack-paine-sewf">Iron Man</a>'
GOOD = '<a href="/titles/ebwf-2001-iron-man.html" class="entity-link" data-entity="ebwf-2001-iron-man">Iron Man</a>'

p = f'{_ROOT}/promotions/ebwf-2001/index.html'
n = 0
if _os.path.exists(p):
    s = open(p, encoding='utf-8').read()
    if BAD in s:
        s = s.replace(BAD, GOOD)
        open(p, 'w', encoding='utf-8').write(s)
        n = 1
print(f'fix-ebwf-iron-man-link: repointed {n}')
