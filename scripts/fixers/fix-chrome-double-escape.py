#!/usr/bin/env python3
"""STANDING FIXER (coordinator, 2026-09-26). Page builders that run html.escape() over a title already carrying the entity
"&mdash;" write "&amp;mdash;", which shows a literal "&mdash;" in the museum's own chrome. Lane E5B found it in E5's
genpages.py. A survey found 276 occurrences on 228 served pages; 254 sit in the four chrome elements below (dry run 2026-09-26). The rest are left alone.
This rewrites "&amp;mdash;" -> "&mdash;" ONLY inside the museum's own chrome elements: <title>, the doc-head <h1>, the
<p class="crumb"> breadcrumb and the <span class="kicker">. It never touches a served document's body. Idempotent.
Runs from ORDER.txt."""
import glob, os, re, sys
root = os.environ.get("MUSEUM_ROOT") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
dry = "--dry" in sys.argv
ELEMS = [re.compile(r"(<title>)(.*?)(</title>)", re.S), re.compile(r"(<h1[^>]*>)(.*?)(</h1>)", re.S),
         re.compile(r'(<p class="crumb">)(.*?)(</p>)', re.S), re.compile(r'(<span class="kicker">)(.*?)(</span>)', re.S)]
def fix(m): return m.group(1) + m.group(2).replace("&amp;mdash;", "&mdash;") + m.group(3)
nf = ns = 0
for p in glob.glob(f"{root}/promotions/*/archive/*.html") + glob.glob(f"{root}/promotions/*/rp/*.html"):
    t = open(p, encoding="utf-8").read()
    if "&amp;mdash;" not in t: continue
    u = t
    for rx in ELEMS: u = rx.sub(fix, u)
    if u != t:
        ns += t.count("&amp;mdash;") - u.count("&amp;mdash;"); nf += 1
        if not dry: open(p, "w", encoding="utf-8").write(u)
print(f"fix-chrome-double-escape: {'(DRY) ' if dry else ''}{ns} chrome dash(es) unescaped on {nf} page(s)")
