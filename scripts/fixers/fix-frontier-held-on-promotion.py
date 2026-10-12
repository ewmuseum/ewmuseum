#!/usr/bin/env python3
"""2026-09-13 (C97-JOINS-02 flag): a held wing whose provenance_notes claim it fulfills/promotes/consolidates a named
frontier row leaves that row at its old status. v102 convention: a promoted frontier row is status "held".
Sets status=held on frontier rows named verbatim in such claims. --dry lists only.
2026-09-22: also on the row a wing's own `frontier_row` pointer names (the take-over lanes' shape since the 2002 walk — 98
such rows had stayed unverified/verified-dead because only prose claims were read). And the Janitor 2026-09-22: "Frontier
promotions should be retired as we hold them (although I'd still want us to be sure we track … an unmined URL for it; that
unmined URL should still be on our list, wherever it's held)" — a retired row's url that no url-walk manifest, plan or queue
carries is queued for the timemap resolver in the URL walk's timemap-queue-held-frontier.tsv (a collection-priority target), never
dropped with the row."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,re,sys,glob,datetime
M=f'{_ROOT}/data/'; dry='--dry' in sys.argv; TODAY=datetime.date.today().isoformat()
P=json.load(open(M+'promotions.json')); ps=P if isinstance(P,list) else P.get('promotions')
F=json.load(open(M+'frontier.json')); fr=F if isinstance(F,list) else F.get('rows') or F.get('frontier')
byname={r.get('name'):r for r in fr if isinstance(r,dict)}
pat=re.compile(r'(?:[Ff]ulfills|[Pp]romotes|CONSOLIDATES|[Cc]onsolidates|[Ss]upersedes) (?:the |three |two )?(?:standing |existing )?frontier rows? ["“\']([^"”\']+)["”\']')
hits=[]
for p in ps:
    if not isinstance(p,dict): continue
    for c in p.get('provenance_notes') or []:
        txt=c.get('claim','') if isinstance(c,dict) else str(c)
        for m in pat.finditer(txt):
            name=m.group(1).strip(); r=byname.get(name)
            if r and r.get('status')!='held': hits.append((p.get('id'),name,r.get('status')))
    # 2026-09-29 (FRONTIER-RECONCILE): a wing that fulfills several rows lists the rest in `frontier_rows` (exact names),
    # read alongside the one-string `frontier_row` (acwa-atlantic-1999: its two Atlantic Coast Wrestling Alliance rows).
    for fr_name in [p.get('frontier_row')]+list(p.get('frontier_rows') or []):
        r=byname.get(fr_name or '')
        if r and r.get('status')!='held': hits.append((p.get('id'),fr_name,r.get('status')))

def norm(u):
    u=(u or '').strip().lower(); u=re.sub(r'^https?://','',u); u=re.sub(r'^www\.','',u); return u.replace(':80/','/').rstrip('/')
UW=f'{_WORKSHOP}/url-walk'; Q=f'{UW}/timemap-queue-held-frontier.tsv'; known=set()
for f in [f'{UW}/manifest.tsv',f'{UW}/fetch-plan.tsv',f'{UW}/direct-collect-queue.tsv']+glob.glob(f'{UW}/timemap-queue-*.tsv')+glob.glob(f'{UW}/cdx*queue*.tsv'):
    try:
        for line in open(f,encoding='utf-8',errors='ignore'):
            for u in re.findall(r'https?://\S+',line): known.add(norm(re.sub(r'^https://web\.archive\.org/web/\d+(id_)?/','',u)))
    except OSError: pass

seen=set(); n=0; carry=[]
for pid,name,st in hits:
    if name in seen: continue
    seen.add(name); n+=1; print(f'{"would set" if dry else "set"} held: {name!r} ({st}) <- wing {pid}')
    u=byname[name].get('url')
    if u and norm(u) not in known: known.add(norm(u)); carry.append((name,u,pid))
    if not dry:
        wing=[x.get("name") for x in ps if isinstance(x,dict) and x.get("id")==pid][0]
        byname[name]['status']='held'
        byname[name]['notes']=(byname[name].get('notes') or '').rstrip()+f' Held as {wing} ({TODAY}).'
for name,u,pid in carry: print(f'{"would queue" if dry else "queued"} unmined url: {u} ({name} -> {pid})')
if not dry and carry:
    new=not _os.path.exists(Q)
    with open(Q,'a',encoding='utf-8') as fh:
        if new: fh.write('priority\trow_name\toriginal_url\twhy\n')
        for name,u,pid in carry: fh.write(f'3\t{name}\t{u}\tfrontier row retired on promotion to {pid} ({TODAY}); its url not yet mined\n')
if not dry and n: json.dump(F,open(M+'frontier.json','w',encoding='utf-8'),indent=1,ensure_ascii=False); open(M+'frontier.json','a').write('\n')
print('frontier rows retired on promotion:',n,'| unmined urls carried to the timemap queue:',len(carry))
