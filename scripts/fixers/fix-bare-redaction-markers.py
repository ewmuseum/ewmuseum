#!/usr/bin/env python3
"""Standing fixer (2026-09-26, COORD-OOC-BYLINES-2): a redaction marker standing as bare page text, outside its
<span class="redacted">, renders as plain prose. The reader can't see where the Museum's hand touched the page, and
fix-redaction-marker-canon.py (which reads only spanned markers) never normalises it. The 2026-09-26 survey found
2,299 bare markers on 576 served pages.

This wraps each bare marker in its span, and a literally-escaped span back into markup. It works in the page <body>
only: a marker in <title> stays bare text, because a title can't carry markup. Marker counts don't change, so a
page's "carries N redactions" line stays true. Runs in ORDER.txt between fix-redaction-marker-escape.py and
fix-redaction-marker-canon.py, so the canon fixer then sees every marker. Idempotent. --dry reports without writing."""
import glob, os, re, sys
root = os.environ.get("MUSEUM_ROOT") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LIT = re.compile(r'&lt;span class="redacted"&gt;(\[(?:redacted|name withheld|detail withheld)[^\]]*\])&lt;/span&gt;')   # hook c208 (D480)
# hook c208 (the Janitor's D480, 2026-10-09: "(a) plain rename"): a bare marker in either wording is wrapped -- the
# two D480 forms and, for the transition, the older eight. A red-gate redactor writes a bare marker by design and this
# is what brings it inside its span, so it has to know the form the redactors now write.
BARE = re.compile(r'(?<!<span class="redacted">)(\[redacted\s*(?:—|&mdash;)[^\]]{0,160}\]|\[(?:name|detail) withheld\])')
dry = "--dry" in sys.argv
n_pages = n_marks = 0
for p in glob.glob(f"{root}/promotions/*/archive/*.html") + glob.glob(f"{root}/promotions/*/rp/*.html") + \
         glob.glob(f"{root}/promotions/*/index.html"):
    try:
        t = open(p, encoding="utf-8").read()
    except UnicodeDecodeError:
        continue   # never rewrite a page whose bytes aren't clean UTF-8 (a replace-decode would damage it)
    if "[redacted" not in t:
        continue
    b = t.find("<body")
    if b < 0:
        continue
    head, body = t[:b], t[b:]
    body2, c1 = LIT.subn(r'<span class="redacted">\1</span>', body)
    body2, c2 = BARE.subn(r'<span class="redacted">\1</span>', body2)
    if c1 or c2:
        n_pages += 1; n_marks += c1 + c2
        if not dry:
            open(p, "w", encoding="utf-8").write(head + body2)
print(f"fix-bare-redaction-markers: {'(DRY) ' if dry else ''}{n_marks} marker(s) wrapped on {n_pages} page(s)")
