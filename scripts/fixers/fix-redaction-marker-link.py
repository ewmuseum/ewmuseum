#!/usr/bin/env python3
"""STANDING FIXER (hook c185, 2026-10-09; the Janitor's D466, finding C04 of the adversarial review). The first redaction
marker on a served page is wrapped in a link to the privacy rule, so a reader who meets "per the privacy rule" can read the
rule. The marker was unlinked plain text about 50,000 times across the site.

THE WRAP IS OUTSIDE THE SPAN, and that is the whole design: <a class="redaction-link" ...><span class="redacted">[...]</span></a>
leaves `class="redacted">[redacted` byte-identical, so fix-redaction-marker-canon.py still normalises that marker,
fix-bare-redaction-markers.py's negative lookbehind still sees the span, land-check's L-MARKER-CANON still reads it, and every
"[redacted" counter and contact-line proximity test in land-check.py, privacy-check.mjs and fix-disclosure-counts.py counts
exactly what it counted before.

FIRST ONLY: one link a page, in the <body>, so a page with 107 markers carries one link and not 107. Idempotent (a page that
already carries class="redaction-link" is skipped). Runs from ORDER.txt immediately after fix-redaction-marker-canon.py, so the
marker it links has already been normalised. --dry reports without writing."""
import glob, os, re, sys
root = os.environ.get("MUSEUM_ROOT") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from gate_detect import live_running as _live_running
HREF = '/curation.html#privacy'
OPEN = '<a class="redaction-link" href="%s">' % HREF
SPAN = re.compile(r'<span class="redacted">\[[^\]]*\]</span>')
dry = "--dry" in sys.argv
if not dry and _live_running("scripts/gate[.]sh|registry-validate|cross-reference[.]mjs|privacy-check", root):
    sys.exit("REFUSED: a gate or build is running")
n_pages = n_skipped = 0
for p in glob.glob(f"{root}/promotions/*/archive/*.html") + glob.glob(f"{root}/promotions/*/rp/*.html"):
    try:
        t = open(p, encoding="utf-8").read()
    except UnicodeDecodeError:
        continue   # never rewrite a page whose bytes aren't clean UTF-8
    if 'class="redacted">' not in t:
        continue
    if 'class="redaction-link"' in t:
        n_skipped += 1; continue
    b = t.find("<body")
    if b < 0:
        continue
    head, body = t[:b], t[b:]
    m = SPAN.search(body)
    if not m:
        continue       # a marker shape this fixer does not recognise: left exactly as written
    body = body[:m.start()] + OPEN + m.group(0) + "</a>" + body[m.end():]
    n_pages += 1
    if not dry:
        open(p, "w", encoding="utf-8").write(head + body)
print(f"fix-redaction-marker-link: {'(DRY) ' if dry else ''}first marker linked on {n_pages} page(s); {n_skipped} already linked")
