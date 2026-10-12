#!/usr/bin/env python3
"""Standing fixer (PROVENANCE-FOOTER-01, 2026-09-13 -- the Janitor gavel: the source block is now the
structured <dl class="muted small provenance"> rendered by fix-provenance-block.py; free-form
provenance prose must not remain anywhere on the page). Every served page under museum/promotions/*/
archive and */rp whose <footer> still carries a legacy prose run (the old "Source: <code>...</code>,
the promoter's own drive. This document carries N redactions ... See <a href="/curation.html">
Curation</a>." sentence, in any of its ~100 observed grammars) has that prose stripped, leaving the
footer CHROME untouched byte-for-byte:
  - the "THE E-WRESTLING MUSEUM / <wing> ... /" crumb line
  - the "back to ..." link (whatever its exact text -- "back to the archive", "back to WING Card
    Archive", "back to the museum", ...)
  - the <!-- footernav:start -->...<!-- footernav:end --> block
  - any <span data-doc-class="..."></span> marker (kept, repositioned onto its own line between the
    back-link and the footernav comment -- the shape every already-clean footer with no legacy prose
    already uses)
Anchor: the fixer finds the single `<a href="...">back ...</a>` link inside the footer (confirmed
unique across all 18,010 served pages) and treats everything between its end and the footernav
comment (or `</footer>` when a page has no footernav) as the legacy-prose region. A region containing
none of the known prose markers (Source:, This document carries, Recovered, Framing written,
reproduced from, Original held) is left alone -- this is what makes a second run a no-op. A footer
with no `back ...` link at all, or more than one, is reported as "did not understand" and left
untouched rather than guessed at.
--dry counts only; never touches disk. Refuses to run for real while a gate/build/privacy-check is
already running, exactly like fix-provenance-block.py and fix-content-notice.py."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import re, glob, sys, os, argparse, subprocess

FOOTER = re.compile(r'<footer\b[^>]*>(.*?)</footer>', re.S | re.I)
BACK = re.compile(r'<a\s+href="[^"]*"[^>]*>\s*back\b[^<]*</a>', re.I)
SPAN = re.compile(r'<span data-doc-class="[^"]*"></span>')
NAVSTART = '<!-- footernav:start -->'
PROSE_MARKERS = re.compile(
    r'Source:|This document carries|Recovered\b|Framing written|reproduced from|Original held', re.I)


def fix_footer_body(body):
    """Returns (new_body, changed, understood). understood=False means: leave this file's footer
    entirely alone (report it) -- the back-link anchor wasn't found exactly once."""
    backs = list(BACK.finditer(body))
    if len(backs) != 1:
        return body, False, False
    bm = backs[0]
    nav_pos = body.find(NAVSTART)
    region_end = nav_pos if nav_pos != -1 else len(body)
    region = body[bm.end():region_end]

    if not PROSE_MARKERS.search(region):
        return body, False, True  # already clean (no legacy prose in this footer)

    spans = SPAN.findall(region)
    middle = '\n    '
    for sp in spans:
        middle += sp + '\n    '

    new_body = body[:bm.end()] + middle + body[region_end:]
    return new_body, new_body != body, True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--museum-root', default=f'{_ROOT}')
    ap.add_argument('--dry', action='store_true')
    args = ap.parse_args()

    M = args.museum_root

    if not args.dry:
        if _live_running("scripts/gate[.]sh|registry-validate|cross-reference[.]mjs|privacy-check", M):
            sys.exit("REFUSED: a gate or build is running")

    files = sorted(glob.glob(f'{M}/promotions/*/archive/*.html') + glob.glob(f'{M}/promotions/*/rp/*.html'))

    rewritten = same = not_understood = no_footer = 0
    not_understood_pages = []

    for f in files:
        rel = '/' + os.path.relpath(f, M)
        s = open(f, encoding='utf-8', errors='replace').read()
        m = FOOTER.search(s)
        if not m:
            no_footer += 1
            continue

        new_footer_body, changed, understood = fix_footer_body(m.group(1))
        if not understood:
            not_understood += 1
            not_understood_pages.append(rel)
            continue

        if not changed:
            same += 1
            continue

        new_s = s[:m.start(1)] + new_footer_body + s[m.end(1):]
        if not args.dry:
            open(f, 'w', encoding='utf-8').write(new_s)
        rewritten += 1

    print(f'fix-footer-legacy-prose: rewritten {rewritten} | already clean {same} | '
          f'did not understand {not_understood} | no footer tag {no_footer}' + (' (dry)' if args.dry else ''))
    if not_understood_pages:
        print(f'  did-not-understand pages (left untouched), first 30 of {len(not_understood_pages)}:')
        for p in not_understood_pages[:30]:
            print('   ', p)


if __name__ == '__main__':
    main()
