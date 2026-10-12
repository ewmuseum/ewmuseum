#!/usr/bin/env python3
"""fix-script-anchors (2026-09-12): an entity-linking pass once rewrote names INSIDE search.html's inline <script> data
(commit 08fa3398a7, 2026-08-25), leaving unescaped quotes in a JS object literal — a SyntaxError that killed the whole search
page for 18 days. Strip any <a …class="entity-link"…>text</a> (and promo/title link anchors) found inside a <script> block of any
top-level page, then assert each inline script still parses (node). Idempotent; refuses while a gate runs."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import glob, re, os, sys, subprocess
M=f'{_ROOT}'
if _live_running('scripts/gate[.]sh|[n]pm run gate', _ROOT): print('fix-script-anchors: a gate is running — skipped'); sys.exit(0)
pages=glob.glob(f'{M}/*.html')+glob.glob(f'{M}/*/index.html')
fixed=0; broken=[]
A=re.compile(r'<a href="[^"]*" class="[^"]*"(?: data-[a-z-]+="[^"]*")*>([^<]*)</a>')
for p in pages:
    s=open(p,encoding='utf-8',errors='surrogateescape').read()
    def repl(m):
        global fixed
        inner=m.group(1); new=A.sub(r'\1',inner)
        if new!=inner: fixed+=1
        return '<script>'+new+'</script>'
    s2=re.sub(r'<script>(.*?)</script>',repl,s,flags=re.S)
    if s2!=s: open(p,'w',encoding='utf-8',errors='surrogateescape').write(s2)
    # syntax-check every inline script that carries a var/function (skip tiny loaders)
    for m in re.finditer(r'<script>(.*?)</script>',s2,flags=re.S):
        js=m.group(1)
        if len(js)<400: continue
        r=subprocess.run(['node','-e','const s=require("fs").readFileSync(0,"utf8");try{new Function(s);}catch(e){console.log(e.message);process.exit(1)}'],input=js,capture_output=True,text=True,env=dict(os.environ,PATH=f'{_NODEBIN}:'+os.environ.get('PATH','')))
        if r.returncode!=0: broken.append((os.path.relpath(p,M),r.stdout.strip()[:80]))
print(f'fix-script-anchors: script blocks repaired {fixed} | inline scripts that do not parse: {len(broken)} {broken[:3]}')
sys.exit(1 if broken else 0)
