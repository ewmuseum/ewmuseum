#!/usr/bin/env python3
"""The chain retires frontier rows that became wings but never APPENDS a wave's new frontier candidates
(delta/data/frontier-rows.json). Append every row from APPLIED waves (and from named workshop-only waves) whose name is not
already on the frontier; keep only keys the live rows use plus language/country; stamp last_checked. Usage: [--dry] [extra wave dirs…].
Idempotent; refuses while a gate runs."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,glob,os,sys,subprocess,datetime
if _live_running("scripts/gate[.]sh", _ROOT): sys.exit("REFUSED: a gate is running")
dry='--dry' in sys.argv; extra=[a for a in sys.argv[1:] if not a.startswith('--')]
A=f'{_WORKSHOP}'; M=f'{_ROOT}'; p=f'{M}/data/frontier.json'
F=json.load(open(p,encoding='utf-8')); live={r.get('name','').strip().lower() for r in F['rows']}
LEGACY={'usenet':'newsgroup','website-efed':'website','forum-efed':'forum','web-forum':'forum','bbs-efed':'bbs','fidonet-echo':'fidonet','wiki-efed':'wiki','email-list':'email','play-by-email':'email','play-by-mail':'mail','discord-efed':'chat','reddit-efed':'social-media','facebook-group-efed':'social-media','game-efed':'game','tabletop-rpg':'in-person','figure-fed':'video','blog':'website','web':'website','forum':'forum'}
import re as _re
_vm=_re.search(r'const MEDIUM_VALUES = new Set\(\[(.*?)\]\)',open(f'{_ROOT}/scripts/registry-validate.mjs',encoding='utf-8').read(),_re.S)
MEDIA_FALLBACK={q.get('medium') for q in json.load(open(f'{M}/data/promotions.json',encoding='utf-8'))['promotions'] if q.get('medium')}
MEDIA=set(_re.findall(r'"([a-z-]+)"',_vm.group(1))) if _vm else MEDIA_FALLBACK
def nu(u): return (u or '').strip().lower().rstrip('/').replace('https://','http://').replace('http://www.','http://')
liveurl={nu(r.get('url')) for r in F['rows'] if r.get('url')}
keys=set(k for r in F['rows'] for k in r)|{'language','country','kind'}
waves=[w for w in glob.glob(f'{A}/usenet-retro/scratch-*/wave-*/')+glob.glob(f'{A}/fwrestling-census/waves/wave-*/')+glob.glob(f'{A}/desk/argyle/waves/wave-*/') if os.path.exists(w+'APPLIED') and os.path.exists(w+'delta/data/frontier-rows.json')]+[e.rstrip('/')+'/' for e in extra]
added=[]; today=datetime.date.today().isoformat()
for w in waves:
    f=w+'delta/data/frontier-rows.json'
    if not os.path.exists(f): f=w+'frontier-rows.json'  # workshop-only waves keep it at the root
    if not os.path.exists(f): continue
    data=json.load(open(f,encoding='utf-8'))
    if isinstance(data,dict): data=data.get('rows') or data.get('frontier_rows') or data.get('candidates') or []
    for r in data:
        if not isinstance(r,dict): continue
        n=(r.get('name') or '').strip()
        if not n or n.lower() in live or (r.get('url') and nu(r['url']) in liveurl): continue
        r=dict(r)
        if 'notes' not in r:  # Arquivo-era rows carry provenance_notes + arquivo_* fields — fold them into the live shape
            claims=[c.get('claim','') for c in r.get('provenance_notes',[]) if isinstance(c,dict)]
            arq=f" Arquivo.pt: {r.get('arquivo_captures','?')} captures of {r.get('arquivo_domain','')} ({r.get('arquivo_range','')})." if r.get('arquivo_domain') else ''
            r['notes']=(' '.join(claims)+arq).strip() or r.get('kind','')
            r.setdefault('medium',r.get('format')); r.setdefault('evidence_count',max(1,len(claims))); r.setdefault('first_seen_in','Arquivo.pt captures read by the Portuguese-scene lanes (2026-09)')
            if r.get('founded_year') is None and r.get('earliest_activity'): r['founded_year']=int(str(r['earliest_activity'])[:4])
        if r.get('kind')=='promotion': r.pop('kind')  # promotions carry no kind; only hubs do
        if r.get('medium') and r['medium'] not in MEDIA:
            # the Janitor's gavel 2026-09-10: medium is platform-only once the museum enum carries 'newsgroup'
            if 'newsgroup' in MEDIA: r['medium']=LEGACY.get(r['medium']) or ('forum' if 'forum' in str(r['medium']).lower() else 'website')
            else: r['medium']='forum-efed' if 'forum' in str(r['medium']).lower() else 'website-efed'  # blogs and self-hosted sites are website-efed
        row={k:v for k,v in r.items() if k in keys and v is not None}; row.setdefault('status','unverified'); row.setdefault('memorial_linked',False); row['last_checked']=today
        F['rows'].append(row); live.add(n.lower()); liveurl.add(nu(r.get('url'))); added.append((os.path.basename(w.rstrip('/')),n[:60]))
if added and not dry: json.dump(F,open(p,'w',encoding='utf-8'),ensure_ascii=False,indent=1); open(p,'a').write('\n')
print(('DRY ' if dry else '')+'frontier rows added:',len(added)); [print('  ',w,'::',n) for w,n in added[:12]]
