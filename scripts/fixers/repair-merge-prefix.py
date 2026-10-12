#!/usr/bin/env python3
"""Repair for MERGE-01 batch 1 (2026-09-10): merge-character.py repointed retired→survivor with \\bR\\b, and a hyphen counts as a
word boundary, so wherever the retired id was a PREFIX of the survivor (angelo-deville → angelo-deville-nfw) the survivor's own id
was rewritten to survivor+tail (angelo-deville-nfw-nfw). Maps every such corrupted token back to the survivor, tree-wide, and
canonicalises alias targets through the alias chain. Idempotent; refuses while a gate runs."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,re,glob,subprocess,sys,os
if _live_running("scripts/gate[.]sh", _ROOT): sys.exit("REFUSED: a gate is running")
M=f'{_ROOT}'; S=os.path.dirname(os.path.abspath(__file__))
pairs=[]
for f in glob.glob(f'{S}/merge-batch-*.log'):
    for l in open(f,encoding='utf-8'):
        p=l.rstrip('\n').split('\t')
        if len(p)>=4 and p[3].startswith('merged '): pairs.append((p[1],p[2]))
fix={}
for surv,ret in pairs:
    if surv.startswith(ret+'-'):
        tail=surv[len(ret):]; fix[surv+tail]=surv
print('corrupted tokens:',fix)
if fix:
    pat=re.compile(r'(?<![\w-])('+'|'.join(re.escape(k) for k in sorted(fix,key=len,reverse=True))+r')(?![\w-])')
    files=glob.glob(f'{M}/data/**/*.json',recursive=True)+glob.glob(f'{M}/**/*.html',recursive=True)
    n=0
    for f in files:
        try: s=open(f,encoding='utf-8').read()
        except Exception: continue
        s2=pat.sub(lambda m: fix[m.group(1)],s)
        if s2!=s: open(f,'w',encoding='utf-8').write(s2); n+=1
    print('files repaired:',n)
# alias targets: canonicalise through the chain
ap=f'{M}/data/aliases.json'; A=json.load(open(ap,encoding='utf-8')); AL={a['from']:a['to'] for a in A['aliases']}
def canon(c,seen=()):
    return canon(AL[c],seen+(c,)) if c in AL and c not in seen else c
ch=0
for a in A['aliases']:
    c=canon(a['to'])
    if c!=a['to']: a['to']=c; ch+=1
json.dump(A,open(ap,'w',encoding='utf-8'),ensure_ascii=False,indent=1); open(ap,'a').write('\n'); print('alias targets canonicalised:',ch)
