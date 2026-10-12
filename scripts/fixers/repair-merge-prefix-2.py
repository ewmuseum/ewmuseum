#!/usr/bin/env python3
"""Second repair for MERGE-01 batch 1: the \\b repoint also renamed OTHER records whose ids began with the retired id
([retired id]-nfw → deimos-low-nfw when [retired id] retired into deimos-low). Uses the last committed state (git HEAD) to list
the ids that existed before the batch, maps every corrupted token back, and removes orphan pages named for corrupted tokens."""
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
head=set(re.findall(r'"id": "([^"]+)"',subprocess.run(['git','-C',M,'grep','-h','-o','"id": "[^"]*"','HEAD','--','data/shards/*/characters.json','data/shards/*/units.json'],capture_output=True,text=True).stdout))
print('HEAD ids',len(head))
pairs=[]
for f in glob.glob(f'{S}/merge-batch-*.log'):
    for l in open(f,encoding='utf-8'):
        p=l.rstrip('\n').split('\t')
        if len(p)>=4 and p[3].startswith('merged '): pairs.append((p[1],p[2]))
fix={}
for surv,ret in pairs:
    for x in head:
        if x.startswith(ret+'-'):
            bad=surv+x[len(ret):]
            if bad!=x and bad not in head: fix[bad]=x
print('corrupted tokens:',fix)
if fix:
    pat=re.compile(r'(?<![\w-])('+'|'.join(re.escape(k) for k in sorted(fix,key=len,reverse=True))+r')(?![\w-])')
    n=0
    for f in glob.glob(f'{M}/data/**/*.json',recursive=True)+glob.glob(f'{M}/**/*.html',recursive=True):
        try: s=open(f,encoding='utf-8').read()
        except Exception: continue
        s2=pat.sub(lambda m: fix[m.group(1)],s)
        if s2!=s: open(f,'w',encoding='utf-8').write(s2); n+=1
    print('files repaired:',n)
    for bad in fix:
        p=f'{M}/characters/{bad}.html'
        if os.path.exists(p): os.remove(p); print('orphan page removed',bad)
# orphan pages for ids retired by the batch (their aliases carry the id forward)
ids=set()
for f in glob.glob(f'{M}/data/shards/*/characters.json')+glob.glob(f'{M}/data/shards/*/units.json'):
    for r in json.load(open(f,encoding='utf-8')):
        if isinstance(r,dict): ids.add(r['id'])
AL={a['from'] for a in json.load(open(f'{M}/data/aliases.json',encoding='utf-8'))['aliases']}
for surv,ret in pairs:
    p=f'{M}/characters/{ret}.html'
    if ret not in ids and os.path.exists(p): os.remove(p); print('retired page removed',ret, '(alias)' if ret in AL else '(NO ALIAS!)')
    for bad in [k for k in fix]: pass
print('survivors missing:',[s for s,_ in pairs if s not in ids])
