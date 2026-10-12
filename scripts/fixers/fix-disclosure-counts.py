#!/usr/bin/env python3
"""Set every served page's 'carries N redaction(s)' declaration to its actual marker count (the markers are the truth). Ported into scripts/fixers 2026-09-20 (standing; ORDER.txt). Usage: fix-disclosure-counts.py [--dry]"""
import re,glob,sys
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
M=_ROOT; dry="--dry" in sys.argv; n=0
# 2026-09-19: the structured provenance block (the Janitor 2026-09-13) declares in a <dl>; ignoring it added a second footer declaration to 5,782 pages after chain 147 (gate red on the merge)
WITHHELD_ROW=re.compile(r"<dd>(\d+ passages? withheld, marked in place)</dd>")  # hook c152: the withheld-only Redactions row
WORD={"one":1,"two":2,"three":3,"four":4,"five":5,"six":6,"seven":7,"eight":8,"nine":9,"ten":10,"eleven":11,"twelve":12}
for p in glob.glob(f"{M}/promotions/*/archive/*.html")+glob.glob(f"{M}/promotions/*/rp/*.html"):
    t=open(p,encoding="utf-8",errors="replace").read()
    # 2026-09-20 (gate 152): a lane template wrote the count twice — a prose line plus the <dl> row — and the gate sums every
    # "N redactions" phrase; the <dl> row is the museum's one declaration, the prose line goes.
    _t0=t; t=re.sub(r'\s*<p class="muted small">(?:\w+|\d+) redactions? applied where the privacy rule requires\.</p>',"",t)
    if t!=_t0 and not dry: open(p,"w",encoding="utf-8").write(t)
    mk=len(re.findall(r"\[redacted\s*(?:—|&mdash;)|\[(?:name|detail) withheld\]",t))   # hook c208 (D480): both wordings
    if mk and "carries no redactions" in t:  # 2026-09-19: a page redacted for the first time still says "no redactions" — that IS its declaration; set it, never add a second one
        t2=t.replace("carries no redactions",f"carries {mk} redaction{'s' if mk!=1 else ''}",1)
        if not dry: open(p,"w").write(t2)
        n+=1; print(p.split("/promotions/")[1],"'no redactions' set to",mk); continue
    provs=re.findall(r'<p class="muted small(?: provenance)?"[^>]*>[\s\S]*?</p>',t)+re.findall(r'<dl class="muted small provenance"[^>]*>[\s\S]*?</dl>',t); foot=re.search(r"<footer[\s\S]*?</footer>",t)
    text="\n".join(provs)+(foot.group(0) if foot else "")
    ms=list(re.finditer(r"(?:carries\s+)?\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+redactions?\b",text,re.I))
    if not ms:
        if mk==0: continue
        # hook c152 (2026-10-08): a page whose one declaration is fix-provenance-block.py's withheld row ("W passages withheld,
        # marked in place") and that now carries privacy markers takes the combined row in place, never a second declaration
        wr=WITHHELD_ROW.search(text)
        if wr:
            t2=t.replace(wr.group(0),f"<dd>carries {mk} redaction{'s' if mk!=1 else ''}; {wr.group(1)}</dd>",1)
            if not dry: open(p,"w").write(t2)
            n+=1; print(p.split("/promotions/")[1],"withheld row: redactions added",mk); continue
        # hook c208 (the Janitor's D480, 2026-10-09: "(a) plain rename"): this note read the page's own markers
        # to name the class in its own prose ("a contact detail standing out of fiction"), which put back into the
        # page exactly what the ruling took off it. It says what came out now, and not what kind it was.
        note=f'<p class="muted small provenance">This document carries {mk} redaction{"s" if mk!=1 else ""}: details standing out of fiction, removed per the privacy rule and marked in place.</p>\n'
        t2=t.replace("<footer",note+"<footer",1) if "<footer" in t else t.replace("</body>",note+"</body>",1)
        if not dry: open(p,"w").write(t2)
        n+=1; print(p.split("/promotions/")[1],"disclosure added",mk); continue
    declared=sum(int(m.group(1)) if m.group(1).isdigit() else WORD[m.group(1).lower()] for m in ms)
    if declared==mk: continue
    if len(ms)==1:
        t2=re.sub(r"(carries\s+)(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(\s+redactions?\b)",lambda m: f"{m.group(1)}{mk} redaction"+("s" if mk!=1 else ""),t,count=1,flags=re.I)
        if t2==t: t2=re.sub(r"\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(\s+redactions?\b)",lambda m: f"{mk} redaction"+("s" if mk!=1 else ""),t,count=1,flags=re.I)
    else:
        # several declarations: rewrite the first to the total and neutralise the rest
        first=True
        def rep(m):
            global first
            if first: first=False; return f"{mk} redaction"+("s" if mk!=1 else "")
            return "redaction" if m.group(2).strip().startswith("redaction") and False else m.group(0)
        t2=re.sub(r"\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(\s+redactions?\b)",rep,t,count=1,flags=re.I)
    if t2!=t:
        if not dry: open(p,"w").write(t2)
        n+=1; print(p.split("/promotions/")[1],"declared",declared,"→",mk)
print("pages fixed:",n,"| dry:",dry)
