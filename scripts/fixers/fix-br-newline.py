#!/usr/bin/env python3
"""fix-br-newline v2 (2026-09-12): .document blocks render under `white-space: pre-wrap`, so `<br>` + newline draws TWO breaks.
Rule: inside the served document region (from the document div to the end of the page), a `<br>\n` whose own line carries
<= 90 characters of text (a card row, a results line, or an un-reflowed hard-wrapped line) becomes `\n` (one break); a `<br>\n`
after a longer line (a reflowed prose paragraph) is kept, since under pre-wrap it is the paragraph spacing the reflow tools
intend. Whitespace/markup-only, idempotent, never touches text, links or redaction spans. Refuses while a gate runs."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import glob, re, os, sys, html
M = f'{_ROOT}'
if _live_running('scripts/gate[.]sh|[n]pm run gate', _ROOT):
    print('fix-br-newline: a gate is running — skipped'); sys.exit(0)
LIMIT = 90
pages = 0; fixed = 0
for p in glob.glob(f'{M}/promotions/*/archive/*.html') + glob.glob(f'{M}/promotions/*/rp/*.html'):
    s = open(p, encoding='utf-8', errors='surrogateescape').read()
    i = s.find('<div class="document">')
    if i < 0 or '<br>\n' not in s[i:]: continue
    head, body = s[:i], s[i:]
    lines = body.split('\n'); out = []; n = 0
    for ln in lines:
        if ln.endswith('<br>'):
            text = html.unescape(re.sub(r'<[^>]+>', '', ln)).strip()
            if len(text) <= LIMIT:
                ln = ln[:-4]; n += 1
        out.append(ln)
    if n:
        open(p, 'w', encoding='utf-8', errors='surrogateescape').write(head + '\n'.join(out)); pages += 1; fixed += n
print(f'fix-br-newline: pages {pages} | doubled breaks collapsed {fixed}')
