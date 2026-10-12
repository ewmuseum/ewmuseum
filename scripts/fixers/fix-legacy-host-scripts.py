#!/usr/bin/env python3
"""Standing fixer (hook c200, 2026-10-09; the Janitor in chat, GAVELS 2026-10-09: "Eh kill those legacy script tags").
Takes out of the recovered period documents the script tags that the document's own host or forum software injected, which
the museum never wanted: they load nothing here (there is no /i.js) and run nothing that means anything. The museum's own
scripts (/js/theme.js, /js/pager.js, /js/list.js, /js/query.js and the inline glue on its own list and figure pages) are
never touched: this fixer only recognises the four host signatures below, byte for byte, and nothing else.

WHAT IT REMOVES (each match is exact; a shape that drifts is NOT removed, it is reported and the page is left alone):
  1. ijs      <script type="text/javascript" src="/i.js"></script>   (Freewebs' injected loader; the tag may be split
              across lines by whitespace, as the 2008 page aftermath08.html is), together with the empty `<!-- -->`
              comment that stands directly before it: the two are one injection. Also its cut-off form (#3).
  2. urchin   <script type="text/javascript">if(typeof(urchinTracker)=='function'){_uacct="UA-230305-2";_udn="freewebs.com";
              urchinTracker();}</script>   (Freewebs' Google Urchin tracker call). Also its cut-off form (#3).
  3. cut off  #1 or #2 cut short by the host's length limit: an exact PREFIX of the tag (at least through `<script type="text/`
              for #1, `if(typeof(urch` for #2) standing at the very end of the document body, i.e. followed only by whitespace and
              then the museum's wrapper (`</div>` or the provenance block) or the end of the file. Left in, such an unclosed tag
              swallows the rest of the page in a browser (the museum's provenance block among it).
  4. xenforo  <script class="js-extraPhrases" type="application/json">{ "lightbox_*": "...", ... }</script>  (XenForo's
              lightbox phrase table: an inert JSON block of interface strings, eight identical copies on team-2005 pages;
              not the author's words, read by no script of ours).

WHERE. Only .html files under promotions/ and memorials/ (the trees that hold period documents). Nothing outside them is
opened. Symlinks are skipped.

WHAT IT NEVER DOES. It never changes a byte of the document outside the removed spans: the match is cut out exactly,
and the blank lines and indentation around it stay as they were. It works on bytes, so a page that is not clean UTF-8 is
handled the same way and no other byte is re-encoded. Each write is a sibling temp file with the mode copied, then os.replace.
Idempotent: a second run finds nothing. A page is written only when something was removed.

Refuses (exit 1, nothing written) under a running gate or build, like every fixer here. --dry counts and writes nothing;
--list prints the paths of the pages it would change and nothing else.
Honours MUSEUM_ROOT only. Prints ONE summary line (counts by kind, pages changed), plus a line for any signature-bearing
span it could not match exactly (exit 0: reported, left alone)."""
import os, re, sys
_ROOT = os.environ.get('MUSEUM_ROOT') or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

TREES = ('promotions', 'memorials')
CANON_UR = b'''<script type="text/javascript">if(typeof(urchinTracker)=='function'){_uacct="UA-230305-2";_udn="freewebs.com";urchinTracker();}</script>'''
MIN_UR = len(b'<script type="text/javascript">if(typeof(urch')

def _prefix_rx(canon, minlen):
    """Regex for the canonical text OR any prefix of it of at least minlen bytes (greedy: the longest prefix present)."""
    rx = b''
    for ch in reversed(canon[minlen:]):
        rx = b'(?:' + re.escape(bytes([ch])) + rx + b')?'
    return re.escape(canon[:minlen]) + rx

# A truncated injection can only be the host's own: it is cut at the very end of the document body, where the museum's wrapper
# (the </div> closing the document, or the provenance block) begins. Anything else after a partial prefix is NOT taken.
END = rb'(?=\s*(?:</div>|<dl class="muted small provenance"|\Z))'
CANON_IJ = b'<script type="text/javascript" src="/i.js"></script>'
MIN_IJ = len(b'<script type="text/')
IJ_FULL = rb'<script\s+type="text/javascript"\s+src="/i\.js"></script>'
IJS = re.compile(rb'(?:<!-- -->)?(?:' + IJ_FULL + rb'|' + _prefix_rx(CANON_IJ, MIN_IJ) + END + rb')')
IJS_FULL = re.compile(rb'(?:<!-- -->)?' + IJ_FULL)
URCHIN = re.compile(rb'(?:' + re.escape(CANON_UR) + rb'|' + _prefix_rx(CANON_UR, MIN_UR) + END + rb')')
XENF = re.compile(rb'<script class="js-extraPhrases" type="application/json">\s*\{(?:\s*"lightbox_[a-z_]+":\s*"[^"]*",?)+\s*\}\s*</script>')
# any host signature at all: used only to REPORT a span the exact patterns above did not take
SIGN = re.compile(rb'src="/i\.js"|urchinTracker|_uacct|js-extraPhrases')

def spans(data):
    """[(start, end, kind)] of every removable span in data, non-overlapping, in order."""
    out = []
    for kind, rx in (('ijs', IJS), ('urchin', URCHIN), ('xenforo', XENF)):
        for m in rx.finditer(data):
            k = kind
            if kind == 'ijs' and not IJS_FULL.fullmatch(m.group(0)):
                k = 'ijs_trunc'
            if kind == 'urchin' and m.group(0) != CANON_UR:
                k = 'urchin_trunc'
            out.append((m.start(), m.end(), k))
    out.sort()
    for a, b in zip(out, out[1:]):
        assert a[1] <= b[0], 'overlapping spans'
    return out

def strip(data):
    """(new bytes, [(start, end, kind)])"""
    sp = spans(data)
    parts, pos = [], 0
    for s, e, _ in sp:
        parts.append(data[pos:s]); pos = e
    parts.append(data[pos:])
    return b''.join(parts), sp

def unmatched(data):
    """Signature hits left in data after stripping (the shape drifted)."""
    return [m.start() for m in SIGN.finditer(data)]

def pages(root):
    for t in TREES:
        base = os.path.join(root, t)
        for dp, dn, fn in os.walk(base):
            dn.sort()
            for f in sorted(fn):
                if f.endswith('.html'):
                    p = os.path.join(dp, f)
                    if not os.path.islink(p):
                        yield p

def main(argv):
    dry = '--dry' in argv
    lst = '--list' in argv
    if lst:   # the relative paths of the pages that would change, one a line; writes nothing, takes no gate check
        for p in pages(_ROOT):
            data = open(p, 'rb').read()
            if spans(data):
                print(os.path.relpath(p, _ROOT))
        return 0
    if not dry:
        from gate_detect import live_running
        if live_running("scripts/gate[.]sh|registry-validate|cross-reference[.]mjs|privacy-check", _ROOT):
            print('fix-legacy-host-scripts: a gate or build is running on this museum; nothing changed')
            return 1
    n = {'ijs': 0, 'ijs_trunc': 0, 'urchin': 0, 'urchin_trunc': 0, 'xenforo': 0}
    comments = changed = left = 0
    drift = []
    for p in pages(_ROOT):
        data = open(p, 'rb').read()
        if b'/i.js' not in data and b'urchinTracker' not in data and b'js-extraPhrases' not in data and b'_uacct' not in data:
            continue
        new, sp = strip(data)
        rest = unmatched(new)
        if rest:
            left += len(rest); drift.append(os.path.relpath(p, _ROOT))
        if not sp:
            continue
        assert len(new) + sum(e - s for s, e, _ in sp) == len(data)
        for s, e, k in sp:
            n[k] += 1
            if k in ('ijs', 'ijs_trunc') and data[s:s + 8] == b'<!-- -->':
                comments += 1
        changed += 1
        if not dry:
            tmp = p + '.lhs-tmp'
            with open(tmp, 'wb') as fh:
                fh.write(new)
            os.chmod(tmp, os.stat(p).st_mode & 0o7777)
            os.replace(tmp, p)
    print('fix-legacy-host-scripts: %s%d page(s) changed; removed i.js loaders %d (+%d cut off), their <!-- --> comments %d, urchin calls %d (+%d cut off), xenforo phrase tables %d'
          % ('(DRY) ' if dry else '', changed, n['ijs'], n['ijs_trunc'], comments, n['urchin'], n['urchin_trunc'], n['xenforo']))
    for r in drift[:10]:
        print('fix-legacy-host-scripts: a host signature is left on %s (shape not matched exactly; left alone)' % r)
    if left:
        print('fix-legacy-host-scripts: %d signature hit(s) left on %d page(s)' % (left, len(drift)))
    return 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
