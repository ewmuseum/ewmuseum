#!/usr/bin/env python3
"""Third repair for MERGE-01 batch 1: the \\b repoint also rewrote page SLUGS that contained the retired id as a hyphen-bounded
segment (week-8-christian-sands-vs-castor-strife.html → week-8-christian-sands-gxw-2001-vs-…), leaving links and rps.json
citations pointing at pages that do not exist. For every path-like token containing a survivor id whose file is missing, if
swapping the survivor back to the retired id names an existing file, the reference is restored. Idempotent; refuses while a gate runs."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import re,glob,os,subprocess,sys
if _live_running("scripts/gate[.]sh", _ROOT): sys.exit("REFUSED: a gate is running")
M=f'{_ROOT}'; S=os.path.dirname(os.path.abspath(__file__))
pairs=[]
for f in glob.glob(f'{S}/merge-batch-*.log'):
    for l in open(f,encoding='utf-8'):
        p=l.rstrip('\n').split('\t')
        if len(p)>=4 and p[3].startswith('merged '): pairs.append((p[1],p[2]))
n=0; fixed=set()
survs={surv:ret for surv,ret in pairs}
pat=re.compile(r'[\w./-]*\b('+'|'.join(re.escape(x) for x in sorted(survs,key=len,reverse=True))+r')\b[\w.-]*\.html')  # hyphen IS a boundary here on purpose: the corruption sits inside slugs
for f in glob.glob(f'{M}/**/*.html',recursive=True)+glob.glob(f'{M}/data/**/*.json',recursive=True):
    try: s=open(f,encoding='utf-8').read()
    except Exception: continue
    if not any(x in s for x in survs): continue
    def sub(m):
        tok=m.group(0); surv=m.group(1); base=M if tok.startswith('/') else os.path.dirname(f)
        if os.path.exists(os.path.join(base,tok.lstrip('/'))): return tok
        cand=tok.replace(surv,survs[surv])
        if os.path.exists(os.path.join(base,cand.lstrip('/'))): fixed.add(tok); return cand
        return tok
    s2=pat.sub(sub,s)
    if s2!=s: open(f,'w',encoding='utf-8').write(s2); n+=1
print('files repaired:',n); print('slugs restored:',sorted(fixed)[:20])
