#!/usr/bin/env python3
"""Standing preflight fixer (2026-09-25, preflight 183 red): served source pages (promotions/*/archive/*.html) keep two
things copied from the original site that validate.mjs refuses.
(1) ROOT-RELATIVE LINKS INTO THE OLD SITE ("/lil", "/fallout/ppv%20results.htm"): the validator reads them as broken
    museum links. gate81-validate-fixes.py unwraps empty, forum-relative and scheme-less hrefs but not these. An anchor
    is unwrapped (its text kept) only when its first path segment is NOT a museum top-level name (a directory or page of
    the museum tree), so a museum link the chain has yet to generate is never touched.
(2) INLINE style="…" ATTRIBUTES: removed, except on pages in validate.mjs's INLINE_STYLE_ALLOWLIST.
Idempotent; refuses while a gate runs; museum served archive pages only."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
import re, glob, subprocess, sys, urllib.parse
if _live_running("scripts/gate[.]sh", _ROOT): sys.exit("REFUSED: a gate is running")
M = _ROOT
top = {n[:-5] if n.endswith(".html") else n for n in _os.listdir(M) if not n.startswith(".")}
v = open(f"{M}/scripts/validate.mjs", encoding="utf-8").read()
m = re.search(r"INLINE_STYLE_ALLOWLIST\s*=\s*new Set\(\[(.*?)\]\)", v, re.S)
allow = set(re.findall(r"[\"']([^\"']+)[\"']", m.group(1))) if m else set()
anchor = re.compile(r'<a\b([^>]*)\bhref="(/[^"]*)"([^>]*)>(.*?)</a>', re.S | re.I)
style = re.compile(r'\s+style="[^"]*"', re.I)
nl = ns = files = 0
for p in sorted(glob.glob(f"{M}/promotions/*/archive/*.html")):
    rel = _os.path.relpath(p, M)
    t = open(p, encoding="utf-8", errors="surrogateescape").read(); o = t
    def un(mm):
        global nl
        path = urllib.parse.unquote(mm.group(2).split("#")[0].split("?")[0])
        seg = path.strip("/").split("/")[0]
        seg = seg[:-5] if seg.endswith(".html") else seg
        if path == "/" or seg in top: return mm.group(0)
        nl += 1; return mm.group(4)
    t = anchor.sub(un, t)
    if rel not in allow:
        t2, k = style.subn("", t); ns += k; t = t2
    if t != o:
        open(p, "w", encoding="utf-8", errors="surrogateescape").write(t); files += 1
print(f"fix-served-source-links-styles: {nl} old-site link(s) unwrapped, {ns} inline style(s) removed, {files} file(s)")
