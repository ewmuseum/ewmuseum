#!/usr/bin/env python3
"""Cross-reference a term against everything the museum and workshop already hold, BEFORE escalating, joining,
minting, or ruling (the Janitor 2026-09-13: "we should cross reference against what we already hold for almost anything").
Usage: xref.py "<term>" ["<term>" …]   (case-insensitive; names, acronyms, handles, URLs, character names)
Surfaces: museum data (promotions, characters/units index, frontier, memorials, affiliations, collections, documents),
the memorial clacks header, the privacy ledger + pending fragments, workshop registers (fed-register, lead ledgers,
frontier candidates), digests, and the Janitor's pile. Prints hits per surface with a short context line each."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import sys,re,glob,json,os
M=f'{_ROOT}'; A=f'{_WORKSHOP}'
terms=[t for t in sys.argv[1:] if t.strip()]
if not terms: print(__doc__); sys.exit(1)
pats=[re.compile(re.escape(t),re.I) for t in terms]
surfaces=[('promotions',[M+'/data/promotions.json']),('characters-index',[M+'/data/characters-index.json']),('units',[M+'/data/units.json']),
 ('frontier',[M+'/data/frontier.json']),('memorials',[M+'/data/memorials.json',M+'/_headers']),('affiliations',[M+'/data/affiliations.json']),
 ('collections',[M+'/data/collections.json']),('documents',[M+'/data/documents.json']),('external-figures',[M+'/data/external-figures.json']),
 ('privacy ledger',[A+'/privacy/redaction-ledger.tsv']+glob.glob(A+'/privacy/ledger-pending/*.tsv')),
 ('fed registers',glob.glob(A+'/gg-rspw*-index/fed-register.tsv')+glob.glob(A+'/usenet-retro/scratch-*/fed-directory-*.tsv')),
 ('lead ledgers',glob.glob(A+'/usenet-retro/scratch-*/cross-lane-leads-*.tsv')),
 ('link/frontier candidates',glob.glob(A+'/url-walk/*candidates*.tsv')+glob.glob(A+'/url-walk/timemap-queue-*.tsv')),
 ('digests',glob.glob(A+'/digests/*.md')),("the Janitor's pile",glob.glob(A+'/desk/\x66ounder-pile-*.md')),('journal',[A+'/desk/coordinator-journal.md'])]
total=0
for name,files in surfaces:
    hits=[]
    for f in files:
        if not os.path.exists(f): continue
        try: txt=open(f,encoding='utf-8',errors='replace').read()
        except Exception: continue
        for p in pats:
            for m in p.finditer(txt):
                if len(hits)>=8: break
                a=max(0,m.start()-70); b=min(len(txt),m.end()+70)
                ctx=re.sub(r'\s+',' ',txt[a:b])
                hits.append(f"{os.path.basename(f)}: …{ctx}…")
            if len(hits)>=8: break
    n=sum(len(p.findall(open(f,encoding='utf-8',errors='replace').read())) for f in files if os.path.exists(f) for p in pats)
    total+=n
    if n: print(f"== {name}: {n} hit(s)"); [print('   '+h[:230]) for h in hits[:5]]
print(f"== total hits: {total}" if total else "== no hits anywhere for: "+', '.join(terms))
