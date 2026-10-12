#!/usr/bin/env python3
"""Standing fixer (drafted 2026-09-21, to install in scripts/fixers/ORDER.txt after cycle 160 lands): a redaction marker whose
dash was double-escaped ("[redacted &amp;mdash; ...") renders the literal text "&mdash;" to the reader. Rewrites it to the
entity the law's marker carries. Pure rendering repair — the class phrase and the span are untouched.

hook c208 (the Janitor's D480, 2026-10-09: "(a) plain rename"): the two marker wordings carry no dash at all, so this
fixer reaches only the older eight. It stays standing, unchanged, because a page can still arrive carrying one: a wave
built before D480, or a Wayback capture of our own earlier output. It runs before fix-bare-redaction-markers.py and
fix-redaction-marker-canon.py, so a repaired marker is still wrapped, normalised and renamed in the same preflight."""
import glob, os, re, sys
root = os.environ.get("MUSEUM_ROOT", os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
pat = re.compile(r"\[redacted\s*&amp;mdash;")
n_files = n_spans = 0
for p in glob.glob(f"{root}/promotions/*/archive/*.html") + glob.glob(f"{root}/promotions/*/index.html"):
    t = open(p, encoding="utf-8").read()
    t2, c = pat.subn("[redacted &mdash;", t)
    if c:
        open(p, "w", encoding="utf-8").write(t2); n_files += 1; n_spans += c
print(f"fix-redaction-marker-escape: {n_spans} double-escaped marker(s) repaired on {n_files} page(s)")
