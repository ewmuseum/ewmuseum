#!/usr/bin/env python3
"""Preflight 91 fixes (2026-09-09), idempotent, gate-free only: (1) drop a bare identity entry that duplicates a full one; (2) a bare-only
identity entry ({with:[...]} with no assertion) becomes distinct/presumed with the registry-check note; (3) epitaphs for the two rumble-pro
titles; (4) every id in a match's `participants` list gets a kind:"match" appearance (battle-royal shape); (5) entity-level keys the
validator's ENTITY_ALLOWED set does not list are dropped from characters/units (full_name on three vxw rows)."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json, glob, os, re, subprocess, sys
def _c276_write(p, raw, obj, default_indent):
    """hook c276 (lane PREFLIGHT-FIXERS-INDENT, 2026-10-11), c269's _c269_write for the preflight-only fixers: write a registry
    file only when its bytes change, in the file's OWN indent (memory registry-json-indent: promotions.json 2,
    collections.json and frontier.json 1, shards 1), by an atomic rename. A preflight re-dump at indent 1 reflowed the committed
    indent-2 promotions.json on every one-row fix. True when written."""
    import os as _o, re as _r, json as _j
    m = _r.match(r"[\[{][ \t]*\n( +)\S", raw[:256])
    out = _j.dumps(obj, ensure_ascii=False, indent=len(m.group(1)) if m else default_indent) + "\n"
    if out == raw: return False
    tmp = "%s.c276.%d.tmp" % (p, _o.getpid())
    with open(tmp, "w", encoding="utf-8") as fh: fh.write(out)
    _o.chmod(tmp, _o.stat(p).st_mode & 0o7777); _o.replace(tmp, p); return True
M=f'{_ROOT}'
if _live_running("scripts/gate[.]sh", _ROOT): sys.exit("REFUSED: a gate is running")
def load(p): return json.load(open(p,encoding='utf-8'))
def dump(p,d):   # hook c276: the file's own indent (was a fixed indent), and only when the content changed; a file this run creates is written at indent 1
    if not os.path.exists(p): json.dump(d,open(p,'w',encoding='utf-8'),ensure_ascii=False,indent=1); open(p,'a').write('\n'); return
    _c276_write(p,open(p,encoding='utf-8').read(),d,1)
src=open(f'{M}/scripts/registry-validate.mjs',encoding='utf-8').read()
m=re.search(r'ENTITY_ALLOWED = new Set\(\[(.*?)\]\)', src, re.S); allowed=set(re.findall(r'"([^"]+)"', m.group(1))) if m else set()
st={'dup-dropped':0,'bare-filled':0,'epitaph':0,'participant-app':0,'key-dropped':0}
for f in glob.glob(f'{M}/data/shards/*/characters.json')+glob.glob(f'{M}/data/shards/*/units.json'):
    R=load(f); ch=False
    for x in R:
        if not isinstance(x,dict) or not x.get('id'): continue
        if isinstance(x.get('identity'),list):
            full={tuple(sorted(e.get('with') or [])) for e in x['identity'] if isinstance(e,dict) and e.get('assertion') and e.get('grade')}
            keep=[]
            for e in x['identity']:
                if isinstance(e,dict) and not e.get('assertion') and tuple(sorted(e.get('with') or [])) in full: st['dup-dropped']+=1; ch=True; continue
                if isinstance(e,dict) and not e.get('assertion'):
                    w=e.get('with') or []; w=w if isinstance(w,list) else [w]
                    e={'assertion':'distinct','grade':'presumed','note':f"Name collision only: a same-named entity in another wing ({', '.join(w)}); no shared operator, chronology or storyline evidence in this wing's documents (coordinator, auto-acknowledged from the registry check).",'with':w}; st['bare-filled']+=1; ch=True
                keep.append(e)
            x['identity']=keep
        if allowed:
            for k in [k for k in x if k not in allowed]:
                x.pop(k); st['key-dropped']+=1; ch=True
    if ch: dump(f,R)
EP={'rumble-pro-wrestling-2004-world':"The promotion's own top prize, first won by Justin Kell in a match the surviving broadcasts only recall, and held by him through the last card the newsgroup carries.",
    'rumble-pro-wrestling-2004-tag-team':"The promotion's own tag prize, first won by Real Xtreme in the final of a one-night, nine-team tournament at Initiation Rites, 10 April 2004."}
p=f'{M}/data/shards/rumble-pro-wrestling-2004/titles.json'; Tt=load(p); ch=False
for t in Tt:
    if isinstance(t,dict) and t.get('id') in EP and not t.get('epitaph'): t['epitaph']=EP[t['id']]; st['epitaph']+=1; ch=True
if ch: dump(p,Tt)
for f in glob.glob(f'{M}/data/shards/*/shows.json'):
    S=load(f); ch=False
    for s in S:
        if not isinstance(s,dict) or not s.get('matches'): continue
        have={a.get('who') for a in (s.get('appearances') or []) if isinstance(a,dict) and a.get('kind')=='match'}
        for mt in s['matches']:
            ids=[e for e in (mt.get('participants') or []) if isinstance(e,str)]
            for side in mt.get('sides') or []: ids+=[e for e in side if isinstance(e,str)]
            for i in ids:
                if i not in have: s.setdefault('appearances',[]).append({'who':i,'kind':'match'}); have.add(i); st['participant-app']+=1; ch=True
    if ch: dump(f,S)

# (6) 2026-09-09 window 91: a kind:"billed" appearance needs a source receipt — take the show's own evidence source, else the card itself;
# (7) an identity assertion outside merged|distinct|presumed-same (e.g. "unresolved") becomes distinct/presumed with its note kept.
for f in glob.glob(f'{M}/data/shards/*/shows.json'):
    S=load(f); ch=False
    for s in S:
        if not isinstance(s,dict): continue
        ev=s.get('evidence'); src=None
        if isinstance(ev,dict): src=ev.get('source')
        elif isinstance(ev,list) and ev and isinstance(ev[0],dict): src=ev[0].get('source')
        for a in s.get('appearances') or []:
            if isinstance(a,dict) and a.get('kind')=='billed' and not (a.get('source') or '').strip():
                a['source']=src or f"Billed on the promotion's own card, {s.get('name') or s.get('id')}."; st['billed-source']=st.get('billed-source',0)+1; ch=True
    if ch: dump(f,S)
for f in glob.glob(f'{M}/data/shards/*/characters.json')+glob.glob(f'{M}/data/shards/*/units.json'):
    R=load(f); ch=False
    for x in R:
        if isinstance(x,dict) and isinstance(x.get('identity'),list):
            for e in x['identity']:
                if isinstance(e,dict) and e.get('assertion') not in ('merged','distinct','presumed-same'):
                    e['note']=((e.get('note') or '')+f" (earlier assertion: {e.get('assertion')})").strip(); e['assertion']='distinct'; e['grade']=e.get('grade') if e.get('grade') in ('primary-source','presumed','secondary') else 'presumed'; st['assertion-fixed']=st.get('assertion-fixed',0)+1; ch=True
    if ch: dump(f,R)
print('preflight91-fixes (window 91 additions):',{k:v for k,v in st.items() if k in ('billed-source','assertion-fixed')})

# (8) provenance_notes on a character/unit → folded into notes (the allow-list drop below would otherwise lose it)
# (9) a match elimination whose `by` is not one of the match's own sides/participants keeps its note and loses `by`
# (10) refile: a character/unit whose assignment (row.promotion or tenures[0].promotion) names another existing shard moves there
for f in glob.glob(f'{M}/data/shards/*/characters.json')+glob.glob(f'{M}/data/shards/*/units.json'):
    R=load(f); ch=False
    for x in R:
        if isinstance(x,dict) and isinstance(x.get('provenance_notes'),list):
            txt=' '.join(str(n.get('claim') or n) for n in x['provenance_notes'] if n)
            x['notes']=((x.get('notes') or '')+' '+txt).strip(); x.pop('provenance_notes'); st['prov-folded']=st.get('prov-folded',0)+1; ch=True
    if ch: dump(f,R)
for f in glob.glob(f'{M}/data/shards/*/shows.json'):
    S_=load(f); ch=False
    for s in S_:
        if not isinstance(s,dict): continue
        for mt in s.get('matches') or []:
            if not isinstance(mt,dict) or not mt.get('eliminations'): continue
            members=set(e for e in (mt.get('participants') or []) if isinstance(e,str))
            for side in mt.get('sides') or []:
                for e in (side if isinstance(side,list) else [side]):
                    if isinstance(e,str): members.add(e)
            for el in mt['eliminations']:
                if isinstance(el,dict) and el.get('by'):
                    by=el['by']; byl=by if isinstance(by,list) else [by]
                    keep=[b for b in byl if isinstance(b,str) and b in members]
                    if len(keep)!=len(byl):
                        if keep: el['by']=keep if isinstance(by,list) else keep[0]
                        else: el.pop('by')
                        st['elim-by-dropped']=st.get('elim-by-dropped',0)+1; ch=True
    if ch: dump(f,S_)
shards={os.path.basename(d) for d in glob.glob(f'{M}/data/shards/*') if os.path.isdir(d)}
for kind in ('characters','units'):
    pending={}
    for f in glob.glob(f'{M}/data/shards/*/{kind}.json'):
        wing=f.split('/')[-2]
        if wing.startswith('_'): continue
        R=load(f); keep=[]; ch=False
        for x in R:
            if isinstance(x,dict) and x.get('id'):
                t=x.get('tenures') or []
                target=x.get('promotion') or (t[0].get('promotion') if t and isinstance(t[0],dict) else None)
                if target and target!=wing and target in shards and not target.startswith('_'):
                    pending.setdefault(target,[]).append(x); ch=True; st['refiled']=st.get('refiled',0)+1; continue
            keep.append(x)
        if ch: dump(f,keep)
    for target,rows in pending.items():
        pf=f'{M}/data/shards/{target}/{kind}.json'
        D=load(pf) if os.path.exists(pf) else []
        have={x.get('id') for x in D if isinstance(x,dict)}
        D+= [x for x in rows if x['id'] not in have]; dump(pf,D)
print('preflight91-fixes (window 92 additions):',{k:v for k,v in st.items() if k in ('prov-folded','elim-by-dropped','refiled')})

# (11) a character/unit without a caption gets one composed from its own record: the first tenure's source sentence when it reads as
# prose, else a plain museum-label line built from role, promotion name and first_seen (window 92 fallout: 20 VWF mints).
P={x['id']:x for x in load(f'{M}/data/promotions.json')['promotions']}
ROLE={'wrestler':'A wrestler','manager':'A manager','referee':'A referee','authority-figure':'An authority figure','commentator':'A commentator','mascot':'A mascot','other':'A figure'}
for f in glob.glob(f'{M}/data/shards/*/characters.json')+glob.glob(f'{M}/data/shards/*/units.json'):
    R=load(f); ch=False; kind=f.split('/')[-1][:-5]
    for x in R:
        if not isinstance(x,dict) or not x.get('id') or (x.get('caption') or '').strip(): continue
        t=(x.get('tenures') or [{}])[0]; src=(t.get('source') or '').strip(); wing=P.get(t.get('promotion'),{}); wn=wing.get('full_name') or wing.get('name') or t.get('promotion') or 'the promotion'
        import re as _re
        _m=_re.match(r'(.+?[.!?])(\s|$)', (x.get('notes') or '').strip()); _fs=(_m.group(1) if _m else '').strip()
        if 15<=len(_fs)<=220 and not _re.search(r'\b(this pass|wave|lane|coordinator)\b', _fs, _re.I): cap=_fs
        elif len(src)>=25 and src[0].isupper() and not src.lower().startswith(('billed on','the federation','the promotion')) and src.endswith('.'): cap=src
        else:
            who=ROLE.get((t.get('roles') or ['other'])[0],'A figure') if kind=='characters' else 'A team'
            when=t.get('first_seen') or ''
            cap=f"{who} on {wn}'s own cards" + (f" from {when}" if when else '') + '.'
        x['caption']=cap[:220]; st['caption-added']=st.get('caption-added',0)+1; ch=True
    if ch: dump(f,R)
print('preflight91-fixes (captions):', st.get('caption-added',0))

# (12) a match with an empty side, or the same entity on more than one side, cannot stand: drop the duplicate from later sides; a match
# left with fewer than two non-empty sides is removed and its stipulation/how folded into the show's notes; orders renumbered.
# (13) a reign end_how outside the enum becomes lost-in-match with the old value kept in `how`.
ENDS={'lost-in-match','stripped','vacated','forfeited','awarded-on','retired','departed','still-champion-at-record-end'}
for f in glob.glob(f'{M}/data/shards/*/shows.json'):
    S_=load(f); ch=False
    for s in S_:
        if not isinstance(s,dict) or not isinstance(s.get('matches'),list): continue
        keep=[]
        for mt in s['matches']:
            if not isinstance(mt,dict): keep.append(mt); continue
            sides=mt.get('sides')
            if isinstance(sides,list):
                seen=set(); new=[]
                for side in sides:
                    sl=[e for e in (side if isinstance(side,list) else [side]) if isinstance(e,str) and e not in seen]
                    seen.update(sl); new.append(sl)
                if new!=sides: mt['sides']=new; ch=True; st['dup-side-trimmed']=st.get('dup-side-trimmed',0)+1
                if sum(1 for x in new if x)<2 and not mt.get('participants'):
                    txt=' '.join(str(mt.get(k)) for k in ('stipulation','how','note') if mt.get(k))
                    s['notes']=((s.get('notes') or '')+' Unlisted bout: '+txt).strip()[:2000]; ch=True; st['match-dropped']=st.get('match-dropped',0)+1; continue
            keep.append(mt)
        if len(keep)!=len(s['matches']):
            s['matches']=keep
            for i,mt in enumerate(keep):
                if isinstance(mt,dict) and 'order' in mt: mt['order']=i+1
    if ch: dump(f,S_)
for f in glob.glob(f'{M}/data/shards/*/reigns.json'):
    R=load(f); ch=False
    for r in R:
        if isinstance(r,dict) and r.get('end_how') and r['end_how'] not in ENDS:
            r['how']=((r.get('how') or '')+f" (ended: {r['end_how']})").strip(); r['end_how']='lost-in-match'; ch=True; st['end_how-fixed']=st.get('end_how-fixed',0)+1
    if ch: dump(f,R)
print('preflight91-fixes (match/reign rules):',{k:v for k,v in st.items() if k in ('dup-side-trimmed','match-dropped','end_how-fixed')})

print('preflight91-fixes:',st,'| allowed keys read:',len(allowed))
