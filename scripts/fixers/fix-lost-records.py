#!/usr/bin/env python3
"""Standing preflight guard (2026-09-13, after four DECW characters vanished from their shard between chain 139 and
preflight 140b with no fixer claiming the deletion): any characters/units/titles/reigns/shows/rps/awards record whose id
is present in HEAD's shard but missing from the working shard is restored from HEAD — unless the id is listed in
the workshop's retired-ids.tsv (one id per line, with a reason: deliberate retirements such as one-record merges).
Prints what it restored; exits 0 always.

(2026-10-03, coordinator, cycle 248's red retries) A record MOVED between shards (fix-shard-assignment, a host-fed re-home)
is not lost: an id live in ANOTHER shard of the same kind is never restored. And a stale copy this guard restored on an
earlier retry (byte-identical to HEAD's copy in this shard, while the same id is live in another shard that HEAD did not
have it in) is removed again: preflight 248-r1 restored jesse-jamester, ickwa-hamunya-wmw and dread-pirate-roberts-rpw into
ptc after preflight 248 had moved them to gw/wmw/rpw, and registry-validate failed on the duplicates."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,subprocess,glob,os
M=f'{_ROOT}'; R=f'{_WORKSHOP}/desk/retired-ids.tsv'
retired=set()
if os.path.exists(R):
    for l in open(R,encoding='utf-8'):
        if l.strip() and not l.startswith('#'): retired.add(l.split('\t')[0].strip())
# (2026-09-24) merge-character.py records a merge's retired id in data/aliases.json, not in retired-ids.tsv; without this
# every merge of an already-committed record was undone here (138 restored at preflight 173, 44 at 174).
try:
    retired |= {a['from'] for a in json.load(open(f'{M}/data/aliases.json',encoding='utf-8')).get('aliases',[]) if isinstance(a,dict) and a.get('from')}
except Exception as _e: print('fix-lost-records: aliases.json unread:', _e)
restored=[]; unrestored=[]
def _rows(o,kind): return o if isinstance(o,list) else o.get(kind,[])
for kind in ('characters','units','titles','reigns','shows','rps','awards'):
    _files=glob.glob(f'{M}/data/shards/*/{kind}.json')
    _where={}   # id -> set of shard files (working tree) holding it
    for _f in _files:
        try:
            for _x in _rows(json.load(open(_f,encoding='utf-8')),kind):
                if isinstance(_x,dict) and _x.get('id'): _where.setdefault(_x['id'],set()).add(_f)
        except Exception: pass
    for f in _files:
        rel=os.path.relpath(f,M)
        r=subprocess.run(['git','-C',M,'show','HEAD:'+rel],capture_output=True,text=True)
        if r.returncode!=0: continue
        try: h=json.loads(r.stdout); cur=json.load(open(f,encoding='utf-8'))
        except Exception: continue
        hr=h if isinstance(h,list) else h.get(kind,[]); cr=cur if isinstance(cur,list) else cur.get(kind,[])
        cid={x.get('id') for x in cr if isinstance(x,dict)}
        miss=[x for x in hr if isinstance(x,dict) and x.get('id') and x['id'] not in cid and x['id'] not in retired
              and not (_where.get(x['id'],set())-{f})]          # moved to another shard: not lost
        # undo an earlier wrong restore: same id live in another shard that HEAD did not hold it in, and this shard's copy
        # is byte-identical to HEAD's copy here (so it is the stale restored one, not a live edit)
        _hd={x['id']:x for x in hr if isinstance(x,dict) and x.get('id')}
        stale=[]
        for x in cr:
            if not (isinstance(x,dict) and x.get('id') in _hd): continue
            others=_where.get(x['id'],set())-{f}
            if not others or x!=_hd[x['id']]: continue
            def _in_head(of):
                rr=subprocess.run(['git','-C',M,'show','HEAD:'+os.path.relpath(of,M)],capture_output=True,text=True)
                if rr.returncode!=0: return False
                try: return any(isinstance(y,dict) and y.get('id')==x['id'] for y in _rows(json.loads(rr.stdout),kind))
                except Exception: return True
            if not any(_in_head(of) for of in others): stale.append(x['id'])
        if stale:
            cr=[x for x in cr if not (isinstance(x,dict) and x.get('id') in stale)]
            unrestored+=[f"{rel.split('/')[2]}/{kind}:{i}" for i in stale]
        if miss or stale:
            cr.extend(miss)
            out=cr if isinstance(cur,list) else {**cur,kind:cr}
            # (2026-09-28) keep the file's OWN indent (rps shards are 1, 2 or 4 across wings; a fixed guess rewrote pcw's and
            # prime-2003's whole rps.json at the wrong indent during preflight 206)
            _dflt=(2 if kind in('characters','titles','reigns','awards') else 1)
            try:
                with open(f,encoding='utf-8') as _fh: _fh.readline(); _l=_fh.readline()
                _ind=(len(_l)-len(_l.lstrip(' '))) or _dflt
            except Exception: _ind=_dflt
            json.dump(out,open(f,'w',encoding='utf-8'),ensure_ascii=False,indent=_ind); open(f,'a').write('\n')
            restored+= [f"{rel.split('/')[2]}/{kind}:{x['id']}" for x in miss]
print('fix-lost-records: restored',len(restored),('| '+', '.join(restored[:10])) if restored else '', ('| stale restored copies removed: '+', '.join(unrestored[:10])) if unrestored else '')
