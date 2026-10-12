#!/usr/bin/env python3
"""Standing window step (the Janitor 2026-09-12: outbound links on held pages must be noted for collection automatically).
Harvests outbound URLs from (a) every served page under museum/promotions/*/ (hrefs AND bare URLs in the text — many period
documents are served as text with their anchors lost) and (b) every RAW capture the collection holds (the URL walk's raw and
direct-collected captures, the census's raw captures, the GeoCities torrent), where the original anchors survive. Wayback and Arquivo
wrappers are unwrapped to the original URL. URLs already known to any plan, queue, manifest, the frontier or the registry are
skipped; the rest are filed ONCE in the URL walk's served-links.tsv and routed: dead-era hosts -> timemap-queue-served-links.tsv
(priority 0; GeoCities only after the local torrent check), other hosts -> direct-collect-queue.tsv, big commercial/social hosts -> noted only.
No museum writes."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import re,glob,os,subprocess,urllib.parse,datetime,sys
M=f'{_ROOT}'; A=f'{_WORKSHOP}'; U=f'{A}/url-walk'; T=f'{A}/tools/coordinator-2026-09-03'
today=datetime.date.today().isoformat(); dry='--dry' in sys.argv
DEAD=('geocities.com','geocities.ws','oocities','tripod.com','angelfire.com','insidetheweb.com','xoom.com','fortunecity.com','homestead.com','freeservers.com','hypermart.net','theglobe.com','talkcity.com','cjb.net','virtualave.net','50megs.com','crosswinds.net','dencity.com','webjump.com','tsx.org','freewebs.com','webs.com','bravenet.com','ezboard.com','invisionfree.com','proboards','members.aol.com','hometown.aol.com','compuserve.com','prodigy.net','pages.prodigy','simplenet.com','netfirms.com','iwarp.com','8m.com','8k.com','bizland.com','tripod.co.uk','angelcities.com','envy.nu','topcities.com','cwd.net','netcolony.com','delphi.com','egroups.com','onelist.com','listbot.com','yahoogroups','groups.yahoo.com','fwlnet.com','wrassle.net','ewrestling.com','e-wrestling.org')
NOTE_ONLY=('youtube.com','youtu.be','facebook.com','twitter.com','x.com/','instagram.com','amazon.','ebay.','google.','microsoft.com','apple.com','adobe.com','yahoo.com/','msn.com','netscape.com','wikipedia.org','fandom.com','imdb.com','discord','reddit.com','paypal','tinyurl','bit.ly','wwe.com','wcw.com','ecwwrestling','doubleclick','adsdaq','linkexchange','bannerswap','w3.org','geocities.yahoo.com/join','counter','statcounter','extreme-dm','sitemeter','webring','ringsurf','bravenet.com/counter','guestbook','archive.org','ewmuseum.org','claude.ai','groups.google.com','arquivo.pt')
PLATFORM=('geocities','oocities','tripod','angelfire','members.aol','hometown.aol','freewebs','xoom','fortunecity','homestead','freeservers','hypermart','simplenet','8m.com','8k.com','cjb.net','virtualave','50megs','crosswinds','netfirms','iwarp','bizland','theglobe','talkcity','dencity','webjump','tsx.org','envy.nu','topcities','netcolony','insidetheweb','ezboard','invisionfree','proboards','bravenet','webs.com')
def unwrap(u):
    u=u.strip().replace('&amp;','&')
    for pat in (r'https?://web\.archive\.org/web/\d+(?:id_|im_|js_|cs_|if_)?/(.+)', r'https?://arquivo\.pt/(?:wayback|noFrame/replay)/\d+(?:id_|im_)?/(.+)'):
        m=re.match(pat,u)
        if m: u=m.group(1); u=u if re.match(r'https?://',u) else 'http://'+u
    u=re.sub(r':80/','/',u); u=re.sub(r'(&gt;|&lt;|&quot;|[\.,;:)\]\'"]+)$','',u); u=u.rstrip('/')
    return u
def host(u):
    try: return urllib.parse.urlsplit(u).netloc.lower()
    except Exception: return ''
known=set()
def learn(text):
    for m in re.finditer(r'https?://[^\s"\'<>)\]]+',text): known.add(unwrap(m.group(0)).lower())
for f in [f'{U}/fetch-plan.tsv',f'{U}/direct-collect-queue.tsv',f'{U}/timemap-resolved.tsv',f'{U}/served-links.tsv']+glob.glob(f'{U}/timemap-queue-*.tsv')+glob.glob(f'{U}/manifest*.tsv')+glob.glob(f'{U}/direct-collected/*/manifest.tsv')+glob.glob(f'{A}/fwrestling-census/manifest*.tsv')+glob.glob(f'{A}/fwrestling-census/fetch-plan*.tsv'):
    if os.path.exists(f): learn(open(f,encoding='utf-8',errors='replace').read())
for f in [f'{M}/data/frontier.json',f'{M}/data/promotions.json']: learn(open(f,encoding='utf-8').read())
COVERED=set()
for f in glob.glob(f'{A}/fwrestling-census/manifest*.tsv')+glob.glob(f'{U}/manifest*.tsv'):
    for m in re.finditer(r'https?://([^/\s"]+)',open(f,encoding='utf-8',errors='replace').read()): COVERED.add(m.group(1).lower())
COVERED={h for h in COVERED if h and not any(x in h for x in DEAD)}  # mass hosting platforms are never 'covered' by one site's crawl
SPAM=re.compile(r'dress|replica|watch(es)?(copy|outlet|\.top|\.cn)|outlet|cheap|jersey|nike|ugg|louis|vuitton|handbag|casino|poker|viagra|cialis|pill|loan|payday|porn|sex|escort|\.top$|\.cn$|\.xyz$|\.pw$|seo|backlink',re.I)
def spammy(u,h): return bool(SPAM.search(h) or SPAM.search(u))
# every raw capture's own URL is "known" by its filename family: treat each host+path we hold as known via manifests above
URLRE=re.compile(r'''(?:href=["'])?(https?://[^\s"'<>)\]]+)''')
ARE=re.compile(r"""<a[^>]*href=["'](https?://[^"']+)["'][^>]*>(.*?)</a>""",re.S|re.I)
IMGRE=re.compile(r"""<img[^>]*src=["'](https?://[^"']+)["']""",re.I)
BADTEXT=re.compile(r'^(click here|here|home|back|links?|link|www|http|next|previous|more|email|e-mail|sign|view|enter|go|main|index|page \d+|\d+|message board|guestbook|forum|results?|roster|news|the capture on .*|wayback.*|arquivo.*|archived copy|source)$',re.I)
anchor={}
new={}
def scan(f,kind):
    try: s=open(f,encoding='utf-8',errors='replace').read()
    except Exception: return
    src=kind+':'+f.replace(A+'/','').replace(M+'/','museum/')
    for m in ARE.finditer(s):
        t=re.sub(r'<[^>]+>','',m.group(2)); t=re.sub(r'\s+',' ',t).strip()
        u=unwrap(m.group(1)).lower()
        if t and 3<=len(t)<=60 and re.search(r'[A-Za-z]{2}',t) and not re.match(r'(?i)^(http|www\.|url|pic|image|banner|logo|photo)',t) and not BADTEXT.match(t) and u not in anchor: anchor[u]=t
    for m in list(URLRE.finditer(s))+list(IMGRE.finditer(s)):
        u=unwrap(m.group(1)); ul=u.lower()
        if not host(u) or ul in known or len(u)>300: continue
        if ul not in new: new[ul]=(u,src)
for f in glob.glob(f'{M}/promotions/*/archive/*.html')+glob.glob(f'{M}/promotions/*/rp/*.html')+glob.glob(f'{M}/promotions/*/index.html'): scan(f,'served')
for pat in (f'{U}/raw/*/*.html',f'{U}/raw/*.html',f'{U}/direct-collected/*/*.html',f'{A}/fwrestling-census/raw/**/*.htm*',f'{A}/geocities-torrent/**/*.htm*'):
    for f in glob.glob(pat,recursive=True): scan(f,'raw')
dead=[];live=[];note=[]
for ul,(u,src) in new.items():
    h=host(u)
    if h in COVERED or any(h.endswith('.'+c) for c in COVERED if c.count('.')>=1 and h!=c): continue  # a host we crawl is not a lead
    if any(x in ul for x in NOTE_ONLY) or spammy(ul,h): note.append((u,h,src))
    elif any(x in h for x in DEAD): dead.append((u,h,src))
    else: live.append((u,h,src))
# GeoCities: local torrent first
geo=[x for x in dead if 'geocities' in x[1]]; other=[x for x in dead if 'geocities' not in x[1]]; local_hits=set()
if geo and not dry:
    tmp=f'{U}/served-links-geocities-{today}.tsv'; open(tmp,'w',encoding='utf-8').write('url\n'+'\n'.join(x[0] for x in geo)+'\n')
    outd=f'{U}/served-links-geocities-local'; os.makedirs(outd,exist_ok=True)
    subprocess.run(['python3',f'{T}/geocities-local-check.py','--out',outd,tmp],capture_output=True,text=True)
    hp=f'{outd}/hits.tsv'
    if os.path.exists(hp):
        for line in open(hp,encoding='utf-8',errors='replace').read().splitlines()[1:]:
            if line.strip(): local_hits.add(unwrap(line.split('\t')[0]).lower())
other+=[x for x in geo if x[0].lower() not in local_hits]
if not dry:
    ledger=f'{U}/served-links.tsv'; first=not os.path.exists(ledger)
    with open(ledger,'a',encoding='utf-8') as L:
        if first: L.write('url\thost\tfirst_seen_page\tfirst_seen_date\tdisposition\n')
        for u,h,src in other: L.write(f'{u}\t{h}\t{src}\t{today}\tWAYBACK\n')
        for u,h,src in live: L.write(f'{u}\t{h}\t{src}\t{today}\tDIRECT\n')
        for u,h,src in note: L.write(f'{u}\t{h}\t{src}\t{today}\tNOTE\n')
        for x in geo:
            if x[0].lower() in local_hits: L.write(f'{x[0]}\t{x[1]}\t{x[2]}\t{today}\tGEOCITIES-LOCAL\n')
    q=f'{U}/timemap-candidates-served-links.tsv'  # CANDIDATES: a triage lane promotes vetted rows into timemap-queue-served-links.tsv; the resolver never reads this file
    if not os.path.exists(q): open(q,'w',encoding='utf-8').write('priority\trow_name\toriginal_url\twhy\n')
    import collections
    byhost=collections.defaultdict(list)
    for u,h,src in other: byhost[h].append((u,src))
    PLATFORM=('geocities','oocities','tripod','angelfire','members.aol','hometown.aol','freewebs','xoom','fortunecity','homestead','freeservers','hypermart','simplenet','8m.com','8k.com','cjb.net','virtualave','50megs','crosswinds','netfirms','iwarp','bizland','theglobe','talkcity','dencity','webjump','tsx.org','envy.nu','topcities','netcolony','insidetheweb','ezboard','invisionfree','proboards','bravenet','webs.com')
    nrows=0
    with open(q,'a',encoding='utf-8') as Q:
        for h,items in byhost.items():
            if any(x in h for x in PLATFORM):
                for u,src in items:
                    Q.write(f'1\t{h} page (linked from {src.split(":")[0]})\t{u}\tserved-links harvest {today}: {src}\n'); nrows+=1
            else:
                root=('http://'+h+'/') if len(items)>1 else items[0][0]
                Q.write(f'1\t{h} ({len(items)} linked page(s); first from {items[0][1].split(":")[0]})\t{root}\tserved-links harvest {today}; per-URL list in served-links.tsv\n'); nrows+=1
    print(f'  wayback queue rows written: {nrows} (priority 1)')
    lh=collections.defaultdict(list)
    for u,h,src in live: lh[h].append((u,src))
    ranked=sorted(lh.items(),key=lambda kv:-len(kv[1]))[:300]
    with open(f'{U}/direct-candidates-served-links.tsv','a',encoding='utf-8') as D:  # CANDIDATES, never the live queue
        for h,items in ranked:
            root=('http://'+h+'/') if len(items)>1 else items[0][0]
            D.write(f'unknown\t{h} ({len(items)} linked page(s); served-links harvest)\t{root}\t{today}\n')
    print(f'  queue rows: wayback hosts {len(byhost)} | direct hosts {len(ranked)} of {len(lh)}')
if not dry:
    # frontier candidates: one row per linked site (host + first path segment on platforms, host otherwise), named from the anchor text
    import json
    fj=json.load(open(f'{M}/data/frontier.json',encoding='utf-8')); frows=fj if isinstance(fj,list) else fj.get('rows') or next(v for v in fj.values() if isinstance(v,list))
    fnames={(r.get('name') or '').lower() for r in frows if isinstance(r,dict)}
    sites={}
    pool=list(other)+list(live)
    lp=f'{U}/served-links.tsv'
    seen={x[0].lower() for x in pool}
    if os.path.exists(lp):
        for line in open(lp,encoding='utf-8',errors='replace').read().splitlines()[1:]:
            f_=line.split('\t')
            if len(f_)>=5 and f_[4] in ('WAYBACK','DIRECT') and f_[0].lower() not in seen: pool.append((f_[0],f_[1],f_[2])); seen.add(f_[0].lower())
    fr_urls={unwrap(m.group(0)).lower() for m in re.finditer(r'https?://[^"\s]+',open(f'{M}/data/frontier.json',encoding='utf-8').read())}
    ASSET=re.compile(r'\.(gif|jpe?g|png|bmp|ico|css|js|swf|mid|midi|wav|mp3|zip|exe|pdf|txt)(\?.*)?$',re.I)
    JUNKHOST=re.compile(r'hostingsupport|postimg|imgur|photobucket|tinypic|imageshack|counter|stats?\.|tracker|webring|ringsurf|banner(swap|exchange)|linkexchange|doubleclick|geocities\.com/(cgi-bin|join|homestead|yahoo)|angelfire\.com/(cgi-bin|doc)|tripod\.com/(cgi-bin|adm)|\.lycos\.|\.yahoo\.|freewebs\.com/(cgi|adm)|paypal|amazon|ebay|cafepress',re.I)
    def wing_of(srcp):
        kind,path=srcp.split(':',1)
        if kind=='served':
            m=re.match(r'museum/promotions/([^/]+)/',path); return (m.group(1) if m else None, path)
        m=re.match(r'(?:url-walk[/]raw|url-walk[/]direct-collected|fwrestling-census[/]raw|geocities-torrent)/([^/]+)/',path)
        return (None, 'the captured '+(m.group(1) if m else 'site')+' pages')
    SPAMTXT=re.compile(r'watch|replica|klockor|rel[oó]gio|montblanc|moncler|outlet|jersey|handbag|penne|desconto|schweiz|swiss|rolex|omega|cheap|sale|nike|ugg|louboutin|vuitton|pandora|tiffany',re.I)
    for u,h,srcp in pool:
        ul=u.lower()
        if not srcp.startswith('served:'): continue   # frontier candidates only from a held wing's own served pages; hub/raw-derived links wait for a triage lane
        if ul in fr_urls or ASSET.search(ul) or JUNKHOST.search(ul) or JUNKHOST.search(h) or SPAMTXT.search(h): continue
        pth=urllib.parse.urlsplit(u).path.strip('/').split('/')
        plat=any(x in h for x in PLATFORM); pathplat=any(x in h for x in ('geocities','oocities','members.tripod','members.aol','hometown.aol','angelfire','xoom','fortunecity','insidetheweb','homestead.com/~','members.'))
        key=h+('/'+'/'.join(pth[:2]) if pathplat and pth and pth[0] else '')
        t=anchor.get(ul)
        isroot=(not pathplat and len([x for x in pth if x])<=1) or (pathplat and len(pth)<=2)
        if key not in sites: sites[key]={'url':u,'name':None,'src':srcp,'n':0,'root':isroot}
        sites[key]['n']+=1
        if t and not SPAMTXT.search(t) and not sites[key]['name']: sites[key]['name']=t
        if isroot: sites[key]['root']=True
    cands=[]
    own=[]
    for key,v in list(sites.items()):
        wing,_=wing_of(v['src'])
        if wing:
            tok=re.sub(r'-(\d{4}|[a-z]+-\d{4}|entity-[a-z])$','',wing).split('-')[0]
            if len(tok)>=3 and tok in key.replace('-','').replace('.',' ').lower().replace(' ','') and v['n']>=3:
                own.append((wing,key,v['n'])); sites.pop(key)
    if own:
        with open(f'{U}/own-site-candidates-{today}.tsv','w',encoding='utf-8') as O:
            O.write('wing\tsite\tlinks\n'); [O.write(f'{w}\t{k}\t{n}\n') for w,k,n in own]
        print(f'  own-site candidates (a held wing linking its own host, url missing on its row): {len(own)} -> own-site-candidates-{today}.tsv')
    for key,v in sites.items():
        if not v['name'] and not v['root']: continue          # a deep unnamed page is not a site lead
        if v['n']>3 and v['name']: v['name']=None                  # a site linked many times is named by its address, not by one link's text
        name=v['name'] or key
        if name.lower() in fnames: continue
        wing,where=wing_of(v['src'])
        seen_in=f"the pages of {wing} ({where})" if wing else where
        note=(f"Linked from the pages of {wing}" if wing else f"Linked from {where}")+f" ({v['n']} link{'s' if v['n']>1 else ''}); "+(f"the link text names it \"{v['name']}\"." if v['name'] else "no name in the link text; held by address.")
        cands.append({'name':name,'url':v['url'] if v['n']==1 else ('http://'+key+'/'),'status':'unverified','first_seen_in':seen_in,'observed_year':None,'evidence_count':v['n'],'memorial_linked':False,'last_checked':today,'notes':note[:300],'_named':bool(v['name'])})
    cands.sort(key=lambda c:(not c['_named'],-c['evidence_count']))
    for c in cands: c.pop('_named',None)
    # LINKMAP rolling file (2026-10-09, the Janitor/coordinator audit: a new wave-LINKMAP-<date> folder every day held ~the same 500 rows;
    # none ever landed). ONE rolling file now: the workshop's LINKMAP-rolling.tsv (first_seen/last_seen per row, rows never dropped);
    # the workshop's changes-<date>.tsv is written ONLY on a day when rows were added, changed or fell out of the candidate set.
    # A triage lane vets rows from the rolling file; nothing here is a wave and nothing here lands by itself.
    cands=cands[:500]
    lm=f'{U}/linkmap'; os.makedirs(lm,exist_ok=True); rp=f'{lm}/LINKMAP-rolling.tsv'
    RC=['url','name','status','first_seen_in','evidence_count','observed_year','memorial_linked','notes','first_seen','last_seen']
    def _c(v): return re.sub(r'\s+',' ',str(v if v is not None else '')).strip()
    rolling={}
    if os.path.exists(rp):
        for line in open(rp,encoding='utf-8').read().split('\n')[1:]:
            f_=line.split('\t')
            if len(f_)==len(RC) and f_[0]: rolling[f_[0].lower()]=dict(zip(RC,f_))
    prev_date=max([r['last_seen'] for r in rolling.values()],default='')
    changes=[]; todayset=set()
    for c in cands:
        new_row={'url':_c(c['url']),'name':_c(c['name']),'status':_c(c['status']),'first_seen_in':_c(c['first_seen_in']),'evidence_count':_c(c['evidence_count']),'observed_year':_c(c['observed_year']),'memorial_linked':_c(c['memorial_linked']),'notes':_c(c['notes'])}
        k=new_row['url'].lower(); todayset.add(k); old=rolling.get(k)
        if old is None:
            rolling[k]=dict(new_row,first_seen=today,last_seen=today); changes.append(('added',new_row['url'],'',new_row['name']))
        else:
            diff=[f for f in ('name','status','first_seen_in','evidence_count','memorial_linked') if old[f]!=new_row[f]]
            if diff: changes.append(('changed',new_row['url'],','.join(diff),'; '.join(f"{f}: {old[f]} -> {new_row[f]}" for f in diff)))
            old.update(new_row); old['last_seen']=today
    if prev_date and prev_date!=today:
        for k,r in rolling.items():
            if r['last_seen']==prev_date and k not in todayset: changes.append(('dropped',r['url'],'','not in today\'s candidate set (row kept, last_seen stays '+prev_date+')'))
    if cands or rolling:
        tmp=rp+'.tmp'
        with open(tmp,'w',encoding='utf-8') as R:
            R.write('\t'.join(RC)+'\n')
            for r in sorted(rolling.values(),key=lambda r:(r['first_seen'],r['url'])): R.write('\t'.join(r[f] for f in RC)+'\n')
        os.replace(tmp,rp)
    if changes:
        with open(f'{lm}/changes-{today}.tsv','a',encoding='utf-8') as C:
            if C.tell()==0: C.write('change\turl\tfields\tdetail\n')
            for ch in changes: C.write('\t'.join(_c(x) for x in ch)+'\n')
    print(f'  linkmap rolling: {len(rolling)} rows ({sum(1 for c in changes if c[0]=="added")} added, {sum(1 for c in changes if c[0]=="changed")} changed, {sum(1 for c in changes if c[0]=="dropped")} dropped today) -> {rp}'+(f' | changes-{today}.tsv' if changes else ' | no changes today, no change log'))
    print(f'  linkmap frontier candidates: {len(cands)} (sites {len(sites)})')

print(f'harvest-served-links: new {len(new)} | wayback {len(other)} | geocities-local {len(local_hits)} | direct {len(live)} | note-only {len(note)} | known {len(known)}'+(' (dry)' if dry else ''))
import collections
print('  top dead hosts:',collections.Counter(h for _,h,_ in other).most_common(8))
print('  top live hosts:',collections.Counter(h for _,h,_ in live).most_common(8))
