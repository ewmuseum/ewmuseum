#!/usr/bin/env python3
"""fix-wing-placard-dl (hook c210, 2026-10-09; the Janitor's D466 "fix the launch list" -> finding C13 of the
adversarial review of 2026-10-09, "render the placard as a dl"). A wing's landing-page placard was ONE paragraph of
`<span class="k">Label</span> &nbsp; value<br>` rows, so a screen reader read the whole placard as a single run-on
line. This fixer turns that one paragraph into a definition list -- `<dl class="meta">`, with a
`<dt class="k">Label</dt><dd>value</dd>` pair per row -- inside the wing's own `<div class="placard">`, and nowhere
else.

WHAT IT TOUCHES: museum/promotions/*/index.html, the `<p class="meta">` that sits directly inside that page's
`<div class="placard">` (one per wing page). The museum's other `<p class="meta">` and `<ul class="meta">` placards --
character, title, award, figure, show and document pages, all stamped by cross-reference.mjs -- are a different page
type's markup and are not in this fixer's region at all.

NOT A WORD CHANGES. Per row: `<span class="k">` becomes `<dt class="k">`, the ` &nbsp; ` gap between label and value is
dropped (style.css's `.placard dl.meta dt::after` supplies it now, so the rendered gap is the same two spaces), the
value is wrapped in `<dd>`, and the `<br>` that ENDED the row is dropped (the row break is
`.placard dl.meta dd + dt::before` now). A `<br>` INSIDE a value -- a hand-written multi-line row -- stays exactly
where it is, inside the `<dd>`. The marker comments the generator stamps between rows keep their places.

IDEMPOTENT, so it is a standing fixer and not a one-shot: a placard that is already a `<dl class="meta">` is skipped,
and a wing page that arrives later in the old shape (a landed wave's own delta, a wing bootstrapped by hand) is healed
by running this again. Every page is checked after conversion -- the visible text, whitespace collapsed, must be
identical to the visible text before it, or the page is left untouched and named in the output.

Refuses to run while a gate is working, like every other standing fixer here.
"""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import glob, re, sys, html

M = f'{_ROOT}'
if _live_running('scripts/gate[.]sh|[n]pm run gate', _ROOT):
    print('fix-wing-placard-dl: a gate is running -- skipped'); sys.exit(0)

# The wing placard, and only the wing placard: the label the page carries, then its one meta block (paragraph or list).
PLACARD_RE = re.compile(
    r'(<div class="placard">\s*<span class="placard-label">Placard</span>\s*)'
    r'<(p|dl) class="meta">(.*?)</\2>(\s*</div>)', re.S)
ROW_START = re.compile(r'<span class="k">')
# the label, the " &nbsp; " gap, and the rest of this row's own segment
ROW_HEAD = re.compile(r'<span class="k">(.*?)</span>\s*&nbsp;\s*(.*)$', re.S)
# the value | the <br> that ended the row (the last row carries none) | the whitespace and markers trailing it
ROW_TAIL = re.compile(r'^(.*?)(<br>)?((?:\s|<!--(?:(?!-->).)*-->)*)$', re.S)
TAGS = re.compile(r'<[^>]+>')


def visible(s):
    """The words a visitor reads, whitespace collapsed -- a `<br>` reads as a space either way."""
    return ' '.join(html.unescape(TAGS.sub(' ', s)).split())


def convert_inner(inner):
    """One placard paragraph's inner html -> the same rows as dt/dd pairs. None if a row is not understood."""
    starts = [m.start() for m in ROW_START.finditer(inner)]
    if not starts:
        return None
    out = [inner[:starts[0]]]
    for i, st in enumerate(starts):
        seg = inner[st:(starts[i + 1] if i + 1 < len(starts) else len(inner))]
        head = ROW_HEAD.match(seg)
        if not head:
            return None
        tail = ROW_TAIL.match(head.group(2))
        if not tail or not tail.group(1).strip():
            return None
        out.append('<dt class="k">%s</dt><dd>%s</dd>%s' % (head.group(1), tail.group(1), tail.group(3)))
    return ''.join(out)


placards = done = already = nothing = 0
refused = []
for p in sorted(glob.glob(f'{M}/promotions/*/index.html')):
    s = open(p, encoding='utf-8', errors='surrogateescape').read()
    hits = list(PLACARD_RE.finditer(s))
    if not hits:
        nothing += 1
        continue
    placards += 1
    if len(hits) != 1:
        refused.append((p, 'more than one wing placard on the page')); continue
    m = hits[0]
    if m.group(2) == 'dl':
        already += 1; continue
    new_inner = convert_inner(m.group(3))
    if new_inner is None:
        refused.append((p, 'a placard row was not understood')); continue
    if visible(new_inner) != visible(m.group(3)):
        refused.append((p, 'the visible text would change')); continue
    if '<span class="k">' in new_inner:
        refused.append((p, 'a label span survived the conversion')); continue
    block = m.group(1) + '<dl class="meta">' + new_inner + '</dl>' + m.group(4)
    open(p, 'w', encoding='utf-8', errors='surrogateescape').write(s[:m.start()] + block + s[m.end():])
    done += 1

print('fix-wing-placard-dl: wing placards %d | converted %d | already a list %d | pages with no placard %d | not understood %d'
      % (placards, done, already, nothing, len(refused)))
for p, why in refused:
    print('fix-wing-placard-dl: LEFT ALONE %s -- %s' % (p, why))
sys.exit(1 if refused else 0)
