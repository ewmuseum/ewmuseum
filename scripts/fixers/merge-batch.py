#!/usr/bin/env python3
"""MERGE-01 (the Janitor 2026-09-10: author-owned originals merge across promotions; the oldest record survives).
Usage: merge-batch.py [--dry] [--limit N]. Pairs: (1) records asserting 'merged' with a still-live target; (2) presumed-same pairs
where neither wing has roster_policy 'real' and that are not two promotions' portrayals (v78(c), hook c124). Survivor = earliest attested tenure first_seen (then more tenures, then the shorter id).
Each merge calls merge-character.py SURVIVOR RETIRED. Logs to the scratchpad. Refuses while a gate runs.
Hook c59 (2026-10-09): a UNIT pass follows, by the same pair, grade and survivor rules (see c59 UNIT MERGES below; a unit
never merges with a character). --no-units skips that pass; --only ID[,ID] limits both passes to pairs naming a listed id."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,glob,subprocess,sys,os,datetime,re
import merge_hygiene as _mh   # hook c281 (lane MERGE-HYGIENE, 2026-10-11): the unit repoint tidies the self-edges and doubled ids it makes
_C281_U=[[],0]   # hook c281: the unit repoint's self-edges removed, doubled ids removed
if _live_running("scripts/gate[.]sh", _ROOT): sys.exit("REFUSED: a gate is running")
dry='--dry' in sys.argv; lim=int(sys.argv[sys.argv.index('--limit')+1]) if '--limit' in sys.argv else 60
# hook c59: --no-units skips the unit pass; --only ID[,ID] limits both passes to pairs naming a listed id (absent: no effect)
nounits='--no-units' in sys.argv; only=set(sys.argv[sys.argv.index('--only')+1].split(',')) if '--only' in sys.argv else None
S=os.path.dirname(os.path.abspath(__file__)); M=f'{_ROOT}'
P={p['id']:p for p in json.load(open(f'{M}/data/promotions.json',encoding='utf-8'))['promotions']}
AL={a['from']:a['to'] for a in json.load(open(f'{M}/data/aliases.json',encoding='utf-8'))['aliases']}
def canon(c):
    seen=set()
    while c in AL and c not in seen: seen.add(c); c=AL[c]
    return c
rec={}
for f in glob.glob(f'{M}/data/shards/*/characters.json'):
    for r in json.load(open(f,encoding='utf-8')):
        if isinstance(r,dict): rec[r['id']]=(f.split('/')[-2],r)
# 2026-10-08 (coordinator, IDENTITY-LEADS-1008): first_seen is read for its first date, so 'by 2000-05' compares as 2000-05 (it
# used to sort after every plain date, 'b' > '9') and a missing or dateless value sorts last ('9999'), never first.
import re as _re_fs
def _fs(v):
    m=_re_fs.search(r'(1[89]|20)\d\d(-\d\d)?(-\d\d)?', str(v or ''))
    return m.group(0) if m else '9999'
def first(cid):
    ds=[_fs(t.get('first_seen')) for t in (rec[cid][1].get('tenures') or [])]; return min(ds) if ds else '9999'   # hook c283: a null tenures reads as empty
def real(cid): return P.get(rec[cid][0],{}).get('roster_policy')=='real'
# hook c124 (2026-10-07, window 322 folded mark-jindrak-tna-total-nonstop-action-2008 into mark-jindrak-wcw-nitro-2001 and
# preflight 323 failed): CURATION v78(c), one fed's portrayal of a real wrestler and another fed's are two records, even with
# one handler. A pair where either row carries portrayal_of and the two rows' promotions differ is never merged here; it goes
# to the merge-review file for a person. The promotion is registry-validate's portrayalPromoOf (the first tenure promotion
# whose id suffixes the row id), else its suffix fallback (the longest promotion id that suffixes the id); a row whose
# promotion cannot be read that way counts as differing (the guard skips rather than guesses).
def promo_of(cid):
    for t in rec[cid][1].get('tenures') or []:
        p=t.get('promotion') if isinstance(t,dict) else None
        if p and cid.endswith('-'+p): return p
    s=[p for p in P if cid.endswith('-'+p)]
    return max(s,key=len) if s else None
def cross_portrayal(a,b):
    if not (rec[a][1].get('portrayal_of') or rec[b][1].get('portrayal_of')): return None
    pa,pb=promo_of(a),promo_of(b)
    return None if (pa and pb and pa==pb) else f"portrayal v78(c): {pa or '?'} / {pb or '?'}"
# 2026-09-24 (the Janitor): survivor exceptions to oldest-first — a memorial subject's character always survives; SURVIVOR_OVERRIDES
# carries the Janitor's per-pair rulings (v66(c): a disguise collapses under the revealed identity).
SURVIVOR_OVERRIDES={frozenset(('jared-sykes-prime','king-blueberry-prime')):'jared-sykes-prime',
                    frozenset(('setzer-van-strife-legends-1998','setzer-van-strife-iewc-1998')):'setzer-van-strife-iewc-1998',   # 2026-10-11 SIGS-MERGES-1011 (hook c283): the IeWC record (seven tenures, the 2 Smooth billing) survives the LEGENDS one-card copy; the default would keep LEGENDS (1998-03-10 sorts first)
                    frozenset(('casey-blackheart-james-iiwf','casey-blackheart-james-mlwo-1998')):'casey-blackheart-james-iiwf',   # 2026-10-10 VERIFY-MLWO-P2 (hook c252): the live IIWF record (its World title reign r05) survives the MLWO 1997 card copy
                    frozenset(('leon-hayze-ewa','leon-hayze-giwf')):'leon-hayze-giwf',   # 2026-10-10 IDENTITY-AUDIT-1010 (hook c239): the Janitor's GIWF record survives; the EWA 1998 tenure appends (care)
                    frozenset(('ian-walsh-aicw','ian-walsh-naw-1998')):'ian-walsh-naw-1998',   # 2026-10-09 IDENTITY-MERGES-2-1009 (hook c213): the record of N.A.W.'s founding owner (1998-02-13, three tenures, the two live aliases) survives the Human Torture Rack fold; the AICW record's bare '1998' sorted first
                    frozenset(('dwo-1996-samantha-bevins','sensuous-samantha-aicw')):'dwo-1996-samantha-bevins',   # 2026-10-09 IDENTITY-MERGES-2-1009 (hook c213): the DWO record keeps its own full billing (a scoped-allow persona); the AICW, GLOW and NJPW Sensuous Samantha records fold into it
                    frozenset(('dwo-1996-samantha-bevins','sensuous-samantha-glow-1999')):'dwo-1996-samantha-bevins',   # 2026-10-09 IDENTITY-MERGES-2-1009 (hook c213): as above
                    frozenset(('dwo-1996-samantha-bevins','sensuous-samantha-neojapan-puroresu-1999')):'dwo-1996-samantha-bevins',   # 2026-10-09 IDENTITY-MERGES-2-1009 (hook c213): as above (the default agrees: 1999-11 against 1999-12-29)
                    frozenset(('chris-mcmillan','mr-dread')):'chris-mcmillan',   # 2026-10-08 IDENTITY-LEADS-1008: tie on first_seen; the main and later billing survives
                    frozenset(('jared-wells-cswa','rage-o-fire-cswa')):'jared-wells-cswa',   # 2026-10-08 VERIFY-WFW-S02: the CSWA card says 'Rage O Fire' returned as Jared Wells: the Jared Wells billing survives
                    frozenset(('jared-wells-wfw-worlds-finest-2003','rage-o-fire-cswa')):'jared-wells-wfw-worlds-finest-2003',   # 2026-10-08 VERIFY-WFW-S02: the CSWA card says 'Rage O Fire' returned as Jared Wells: the Jared Wells billing survives
                    frozenset(('larry-tact-glcw-2002','larry-tact-ne')):'larry-tact-ne',   # 2026-10-08 VERIFY-WFW-S03: New ERA's first World champion (seven tenures 2004-2015) survives the GLCW/WFW jobber copies
                    frozenset(('larry-tact-wfw-worlds-finest-2003','larry-tact-ne')):'larry-tact-ne',   # 2026-10-08 VERIFY-WFW-S03: New ERA's first World champion (seven tenures 2004-2015) survives the GLCW/WFW jobber copies
                    frozenset(('larry-tact-wfw-worlds-finest-2003','larry-tact-glcw-2002')):'larry-tact-ne',   # 2026-10-08 VERIFY-WFW-S03: New ERA's first World champion (seven tenures 2004-2015) survives the GLCW/WFW jobber copies
                    frozenset(('krist-blue-wfw-worlds-finest-2003','krist-blue-byw')):'krist-blue-ne',   # 2026-10-08 VERIFY-WFW-S03: the New ERA record carries her name and billing; the WFW copy is one run-in
                    frozenset(('krist-blue-wfw-worlds-finest-2003','krist-blue-ne')):'krist-blue-ne',   # 2026-10-08 VERIFY-WFW-S03: the New ERA record carries her name and billing; the WFW copy is one run-in
                    frozenset(('krist-blue-byw','krist-blue-ne')):'krist-blue-ne',   # 2026-10-08 VERIFY-WFW-S03: the New ERA record carries her name and billing; the WFW copy is one run-in
                    frozenset(('toxick-white-wfw-worlds-finest-2003','toxick-byw')):'toxick-byw',   # 2026-10-08 VERIFY-WFW-S03: 'Toxick' is the main billing on both wings
                    frozenset(('azrael-ravenell-jolt-2001','shadow-fire-e-pro-2001')):'azrael-ravenell-jolt-2001',   # 2026-10-08 VERIFY-JOLT-OURSIDE-1: the established record and main billing survive
                    frozenset(('dave-old-school-gibson-jolt-2001','old-school-dave-gibson')):'old-school-dave-gibson',   # 2026-10-08 VERIFY-JOLT-OURSIDE-1: the established record and main billing survive
                    frozenset(('david-dew-jolt-2001','david-dew-action-2002')):'david-dew-action-2002',   # 2026-10-08 VERIFY-JOLT-OURSIDE-1: the established record and main billing survive
                    frozenset(('derecho-jolt-2001','derecho-team')):'derecho-team',   # 2026-10-08 VERIFY-JOLT-OURSIDE-1: the established record and main billing survive
                    frozenset(('sepiroth-du-luc-jolt-2001','sepiroth-du-luc')):'sepiroth-du-luc',   # 2026-10-08 VERIFY-JOLT-OURSIDE-1: the established record and main billing survive
                    frozenset(('graphic-violence-jolt-2001','graphic-violence-osw')):'graphic-violence-osw',   # 2026-10-08 VERIFY-JOLT-OURSIDE-1: the established record and main billing survive
                    frozenset(('high-flyer-jolt-2001','jack-harmen')):'jack-harmen',   # 2026-10-08 VERIFY-JOLT-OURSIDE-1: the established record and main billing survive
                    frozenset(('jack-breaker-jolt-2001','jack-breaker-action-2002')):'jack-breaker-action-2002',   # 2026-10-08 VERIFY-JOLT-OURSIDE-1: the established record and main billing survive
                    frozenset(('jake-walker-jolt-2001','jake-walker-action-2002')):'jake-walker-action-2002',   # 2026-10-08 VERIFY-JOLT-OURSIDE-1: the established record and main billing survive
                    frozenset(('j-con-jolt-2001','jonathan-conspiracy-pwc-wrestleonline-2003')):'jonathan-conspiracy-pwc-wrestleonline-2003',   # 2026-10-08 VERIFY-JOLT-OURSIDE-1: the established record and main billing survive
                    frozenset(('joey-malone-jolt-2001','joey-malone-action-2002')):'joey-malone-action-2002',   # 2026-10-08 VERIFY-JOLT-OURSIDE-1: the established record and main billing survive
                    frozenset(('john-mammoth-jolt-2001','john-mammoth')):'john-mammoth',   # 2026-10-08 VERIFY-JOLT-OURSIDE-1: the established record and main billing survive
                    frozenset(('keri-lindum-jolt-2001','keri-lindum-action-2002')):'keri-lindum-action-2002',   # 2026-10-08 VERIFY-JOLT-OURSIDE-1: the established record and main billing survive
                    frozenset(('krow-jolt-2001','krow-action-2002')):'krow-action-2002',   # 2026-10-08 VERIFY-JOLT-OURSIDE-1: the established record and main billing survive
                    frozenset(('kodiak-vic-creed-jolt-2001','kodiak-vic-creed-action-2002')):'kodiak-vic-creed-action-2002',   # 2026-10-08 VERIFY-JOLT-OURSIDE-1: the established record and main billing survive
                    frozenset(('lance-knight-jolt-2001','lance-knight')):'lance-knight',   # 2026-10-08 VERIFY-JOLT-OURSIDE-1: the established record and main billing survive
                    frozenset(('lawrence-clamentia-jolt-2001','lawrence-clamentia-threat')):'lawrence-clamentia-threat',   # 2026-10-08 VERIFY-JOLT-OURSIDE-1: the established record and main billing survive
                    frozenset(('lee-lightning-jolt-2001','lee-lightning-action-2002')):'lee-lightning-action-2002',   # 2026-10-08 VERIFY-JOLT-OURSIDE-1: the established record and main billing survive
                    frozenset(('llb-jolt-2001','llb-acw')):'llb-acw',   # 2026-10-08 VERIFY-JOLT-OURSIDE-1: the established record and main billing survive
                    frozenset(('mike-extreme-jolt-2001','mike-extreme')):'mike-extreme',   # 2026-10-08 VERIFY-JOLT-OURSIDE-1: the established record and main billing survive
                    frozenset(('reno-davis-jolt-2001','reno-davis')):'reno-davis',   # 2026-10-08 VERIFY-JOLT-OURSIDE-1: the established record and main billing survive
                    frozenset(('steven-denton-jolt-2001','steven-denton-action-2002')):'steven-denton-action-2002',   # 2026-10-08 VERIFY-JOLT-OURSIDE-1: the established record and main billing survive
                    frozenset(('tony-davis-jolt-2001','tony-davis-prime')):'tony-davis-prime',   # 2026-10-08 VERIFY-JOLT-OURSIDE-1: the established record and main billing survive
                    frozenset(('trey-vincent-jolt-2001','trey-vincent-action-2002')):'trey-vincent-action-2002',   # 2026-10-08 VERIFY-JOLT-OURSIDE-1: the established record and main billing survive
                    frozenset(('team-viagra-jolt-2001','team-v-i-a-g-r-a-prime')):'team-v-i-a-g-r-a-prime',   # 2026-10-08 VERIFY-JOLT-OURSIDE-1: the established record and main billing survive
                    frozenset(('deadly-sins-jolt-2001','deadly-sins-action-2002')):'deadly-sins-action-2002',   # 2026-10-08 VERIFY-JOLT-OURSIDE-1: the established record and main billing survive
                    frozenset(('the-elements-jolt-2001','the-elements-action-2002')):'the-elements-action-2002',   # 2026-10-08 VERIFY-JOLT-OURSIDE-1: the established record and main billing survive
                    frozenset(('mike-extreme','mike-extreme-pcw')):'mike-extreme',   # 2026-10-08 IDENTITY-LEADS-1008B: the established record (OSW/jOlt card, DWF legend) survives
                    frozenset(('john-doe-epw','john-doe-ne')):'john-doe-ne',   # 2026-10-08 IDENTITY-LEADS-1008B: New ERA's 2004-2015 record survives (larry-tact-ne precedent)
                    frozenset(('john-doe-ne','john-doe-nwl')):'john-doe-ne',   # 2026-10-08 IDENTITY-LEADS-1008B: New ERA's 2004-2015 record survives
                    frozenset(('john-doe-ne','john-doe-wfw-worlds-finest-2003')):'john-doe-ne',   # 2026-10-08 IDENTITY-LEADS-1008B: New ERA's 2004-2015 record survives
                    frozenset(('john-doe-epw','john-doe-wfw-worlds-finest-2003')):'john-doe-ne',   # 2026-10-08 IDENTITY-LEADS-1008B: New ERA's 2004-2015 record survives
                    frozenset(('john-doe-nwl','john-doe-wfw-worlds-finest-2003')):'john-doe-ne',   # 2026-10-08 IDENTITY-LEADS-1008B: New ERA's 2004-2015 record survives
                    frozenset(('aran-thompson-igc','aran-thompson-jolt-2001')):'aran-thompson-igc',   # 2026-10-08 VERIFY-JOLT-FORUM-S02: the established live IGC record survives the new jOlt mint
                    frozenset(('steve-johnson-ne','steve-johnson-wfw-worlds-finest-2003')):'steve-johnson-ne',   # 2026-10-08 VERIFY-WFW-S07: the established live record survives the new WFW mint
                    frozenset(('frankie-fargo','frankie-fargo-wfw-worlds-finest-2003')):'frankie-fargo',   # 2026-10-08 VERIFY-WFW-S07: the established live record survives the new WFW mint
                    frozenset(('shane-southern','shane-southern-gxw-2001')):'shane-southern-cswa',   # 2026-10-08 IDENTITY-LEADS-1008C: the CSWA record (1997-2005, Greensboro, United States and World titles) survives the NFW, GXW and WFW copies
                    frozenset(('shane-southern','shane-southern-wfw-worlds-finest-2003')):'shane-southern-cswa',   # 2026-10-08 IDENTITY-LEADS-1008C: the CSWA record (1997-2005, Greensboro, United States and World titles) survives the NFW, GXW and WFW copies
                    frozenset(('shane-southern-gxw-2001','shane-southern-wfw-worlds-finest-2003')):'shane-southern-cswa',   # 2026-10-08 IDENTITY-LEADS-1008C: the CSWA record (1997-2005, Greensboro, United States and World titles) survives the NFW, GXW and WFW copies
                    frozenset(('steve-johnson-team','steve-johnson-wfw-worlds-finest-2003')):'steve-johnson-ne',   # 2026-10-08 IDENTITY-LEADS-1008C: New ERA's live record (New ERA and NGEN stints) survives the TEAM copy and the WFW mint, as VERIFY-WFW-S07's line already rules for the mint
                    frozenset(('steve-johnson-ne','steve-johnson-team')):'steve-johnson-ne',   # 2026-10-08 IDENTITY-LEADS-1008C: New ERA's live record (New ERA and NGEN stints) survives the TEAM copy and the WFW mint, as VERIFY-WFW-S07's line already rules for the mint
                    frozenset(('jean-rabesque-cswa','jean-rabesque-glcw-2002')):'jean-rabesque-glcw-2002',   # 2026-10-08 IDENTITY-LEADS-1008C: the GLCW record (GLCW, NFW, WFW and New ERA World champion) survives the CSWA and GXW copies
                    frozenset(('jean-rabesque-cswa','jean-rabesque-gxw-2001')):'jean-rabesque-glcw-2002',   # 2026-10-08 IDENTITY-LEADS-1008C: the GLCW record (GLCW, NFW, WFW and New ERA World champion) survives the CSWA and GXW copies
                    frozenset(('derecho-efg','derecho-nbw-no-brand-2013')):'derecho-team',   # 2026-10-08 IDENTITY-LEADS-1008C: the established jOlt/LoC/fWo/TEAM record survives the EFG and NBW copies
                    frozenset(('shawn-hart-wfw-worlds-finest-2003','shawn-hart')):'shawn-hart',   # 2026-10-08 VERIFY-WFW-S01: the established record and main billing survive the 2003 WFW copy
                    frozenset(('great-dragon-osw','great-dragon-pure')):'great-dragon-rspwf',   # 2026-10-08 IDENTITY-READS-1008: the fWo record survives the Great Dragon fold (Horito Yakama; primary-source)
                    frozenset(('great-dragon-acw','great-dragon-osw')):'great-dragon-rspwf',   # 2026-10-08 IDENTITY-READS-1008: the fWo record survives the Great Dragon fold (Horito Yakama; primary-source)
                    frozenset(('great-dragon-acw','great-dragon-pure')):'great-dragon-rspwf',   # 2026-10-08 IDENTITY-READS-1008: the fWo record survives the Great Dragon fold (Horito Yakama; primary-source)
                    frozenset(('jj-deville','jj-deville-cswa')):'jj-deville',   # 2026-10-08 IDENTITY-READS-1008: the established record (NFW + CSWA tenures) survives
                    frozenset(('felix-red-wfw-worlds-finest-2003','felix-red')):'felix-red',   # 2026-10-08 VERIFY-WFW-S01: the established record and main billing survive the 2003 WFW copy
                    frozenset(('beau-michaels-wfw-worlds-finest-2003','beau-michaels')):'beau-michaels',   # 2026-10-08 VERIFY-WFW-S01: the established record and main billing survive the 2003 WFW copy
                    frozenset(('mike-mcgee-wfw-worlds-finest-2003','mike-mcgee')):'mike-mcgee',   # 2026-10-08 VERIFY-WFW-S01: the established record and main billing survive the 2003 WFW copy
                    frozenset(('tiny-wfw-worlds-finest-2003','tiny-nfw')):'tiny-nfw',   # 2026-10-08 VERIFY-WFW-S01: the established record and main billing survive the 2003 WFW copy
                    frozenset(('green-machine-wfw-worlds-finest-2003','green-machine')):'green-machine',   # 2026-10-08 VERIFY-WFW-S01: the established record and main billing survive the 2003 WFW copy
                    frozenset(('kazuo-shizaki-wfw-worlds-finest-2003','kazuo-shizaki')):'kazuo-shizaki',   # 2026-10-08 VERIFY-WFW-S01: the established record and main billing survive the 2003 WFW copy
                    frozenset(('kazuo-shizaki','kuro-hibatchi')):'kazuo-shizaki',   # 2026-10-08 VERIFY-WFW-S01: the established record and main billing survive the 2003 WFW copy
                    frozenset(('kazuo-shizaki-wfw-worlds-finest-2003','kuro-hibatchi')):'kazuo-shizaki-wfw-worlds-finest-2003',   # 2026-10-08 VERIFY-WFW-S01: the established record and main billing survive the 2003 WFW copy
                    frozenset(('joshua-curtis','joshua-curtis-gcw-gcwonline-2001')):'joshua-curtis',   # 2026-10-01 (D175): first_seen '?' sorted last
                    frozenset(('kyle-lamen-prime','kyle-velocity-pcw')):'kyle-lamen-prime',
                    frozenset(('matt-hunt-pcw','matthias-kuntz-hunt-pcw')):'matthias-kuntz-hunt-pcw',
                    frozenset(('cassius-deamont-chz','cassius-deamont-pcw')):'cassius-deamont-pcw',
                    frozenset(('chris-bagwell','chris-bagwell-team')):'chris-bagwell',
                    frozenset(('danny-ferguson-prime','el-spiffy-pcw')):'danny-ferguson-prime',
                    frozenset(('hbk-2000-cswa','hbk2000-cswa')):'hbk-2000-cswa',
                    frozenset(('rich-sherwin-pcw','rick-sherwin-pcw')):'rich-sherwin-pcw'}  # COORD-GW-PROBABLES, 2026-09-26: same-promotion pair; the default would keep an empty card and drop the full tenure  # FW-MIRROR-E2-CSWA, 2026-09-25  # COORD-PCW-FAMILY-PROBABLES, 2026-09-25  # v66(c) reveal, COORD-SCCW-PROBABLES 2026-09-24  # 'Agreed on Sykes', 2026-09-24
try:
    _MJ=json.load(open(f'{M}/data/memorials.json',encoding='utf-8')); _MJ=_MJ['memorials'] if isinstance(_MJ,dict) else _MJ
    MEMORIAL_CHARS={c for m in _MJ if isinstance(m,dict) for c in (m.get('characters') or []) if isinstance(c,str)}
except Exception: MEMORIAL_CHARS=set()
pairs=[]; seen=set(); review=[]
for cid,(w,r) in rec.items():
    for i in r.get('identity',[]) or []:
        if i.get('assertion') in ('merged','presumed-same'):
            for t in (i.get('with') or []):   # hook c283: a null with reads as empty
                k=tuple(sorted((cid,t)))
                if t in rec and k not in seen:
                    seen.add(k)
                    # the Janitor 2026-09-10: presumed-same merges only at primary-source / user-attested grade; grade 'presumed' → review lane
                    # the Janitor 2026-09-22 ("in general I'm good with merging probables"): grade 'presumed' merges too; only an
                    # ungraded or weaker assertion still goes to the review list
                    if i['assertion']=='presumed-same' and i.get('grade') not in ('primary-source','user-attested','presumed'): review.append(k); continue
                    pairs.append((0 if i['assertion']=='merged' else 1,k))
pairs.sort()
log=open(f"{_SCRATCH}/merge-batch-{datetime.date.today()}.log",'a')  # 2026-09-22: workshop scratch, never the published tree
done=0; skipped=0; skipped_v78=0
for kind,(a,b) in pairs:
    if done>=lim: break
    if only is not None and not ({a,b}&only): continue  # hook c59 --only
    a,b=canon(a),canon(b)
    if a==b or a not in rec or b not in rec: log.write(f"skip resolved {a} {b}\n"); continue
    if real(a) or real(b): skipped+=1; log.write(f"skip portrayal {a} {b}\n"); continue
    _v78=cross_portrayal(a,b)
    if _v78: skipped_v78+=1; review.append((a,b,_v78)); log.write(f"skip portrayal (v78(c)) {a} {b}\t{_v78}\n"); continue   # hook c124
    order=sorted([a,b],key=lambda c:(first(c),-len(rec[c][1].get('tenures') or []),len(c)))   # hook c283: a null tenures reads as empty
    surv,ret=order[0],order[1]
    if frozenset((a,b)) in SURVIVOR_OVERRIDES: surv=SURVIVOR_OVERRIDES[frozenset((a,b))]; ret=b if surv==a else a
    elif (a in MEMORIAL_CHARS)!=(b in MEMORIAL_CHARS): surv=a if a in MEMORIAL_CHARS else b; ret=b if surv==a else a
    cmd=['python3','-I',f'{S}/merge-character.py',surv,ret]+(['--dry'] if dry else [])
    out=subprocess.run(cmd,capture_output=True,text=True).stdout.strip().split('\n')[-1]
    log.write(f"{'merged' if kind==0 else 'presumed'}\t{surv}\t{ret}\t{out}\n"); done+=1
# ---------------------------------------------------------------------------------------------------------------------
# c59 UNIT MERGES (hook c59, re-cut 2026-10-09 by lane C59-MERGE-UNITS; first cut lane UNIT-MERGER 2026-10-05; D308; the Janitor
# 2026-09-22: "in general I'm good with merging probables"). A filed 'merged' / graded 'presumed-same' identity row between two
# UNITS folds as one between two characters does: the same pair and grade rule (ungraded presumed-same -> the review list), the
# same roster_policy 'real' skip and v78(c) portrayal guard, the same survivor rule (SURVIVOR_OVERRIDES, then a memorial subject,
# then the earliest tenure first_seen read by _fs(), more tenures, the shorter id) and merge-character.py's own fold: every
# distinct stint kept (hook c129), name + aka into aka, the pair's evidence filed on the survivor's wing first (hook c141,
# merge_evidence; "Same unit as"), only the folded id leaving an identity entry (hook c143). PLUS MEMBERS: union by character_id
# (a string member is its id; a dict member's key is character_id, else id, else unit_id); a retired id-bearing member whose
# character's name or aka matches a survivor NAME-ONLY member fills that member's character_id instead of doubling it; a name-only
# member already present by name is not added; membership_unknown goes once members exist. Then the aliases.json row and ONE
# reference-only repoint over every retired id at the end of the pass (merge-character step 3's own patterns and files).
# NEVER MERGED HERE (logged, and listed in the merge-review file with the reason): a unit `with` naming a CHARACTER; a pair either
# record also files `distinct`; a CARE pair (a unit on, or with a member from, the Janitor's own UWF-lineage wings iwf / giwf /
# uwf, or a memorial subject as the unit or a member) until the coordinator lists the pair in UNIT_CARE_CLEARED; UNIT_HOLD.
UNIT_CARE_CLEARED=set()|{frozenset(('justice-inc-pcw','justice-inc-pure'))}   # V-U11/V-P9 (wave-COORD-PARITY-PROBABLES-1005 RULINGS.tsv): one team on two-way primary-source merged rows; its uwf tenure is carried onto the survivor (GAVELS 2026-09-22: care means completeness); cleared by the coordinator 2026-10-10 on VERIFY-C59-RECUT
UNIT_HOLD={frozenset(('fight-against-prejudice-fob','fight-against-prejudice-pwe-inc')):'hold c59 verify: its own note rules no merge (v96 real-wrestler portrayal members; no document links the two)', frozenset(('the-insiders-bcw-newa','the-insiders-lcw-1997')):'hold c59 verify: generic name, no members either side, filed "not a merge"; folding would move four LCW reigns', frozenset(('the-saikyo-system','unknown-soldiers-pure')):'hold c59: the PURE trio is managed THROUGH the Saikyo System stable (its card names Raizo Tenzan and Yuka Hamada as fellow members); the LOW Saikyo System is the Tenzan/Lotus tag team; one stable and a sub-team, not one unit'}
_UNITS_SUMMARY=''
if not nounits:
    import merge_evidence as _me
    _UOWN={'iwf','giwf','uwf'}   # the Janitor's own UWF (iwf 1998-99, giwf 1999-2001, uwf 2001-07); other uwf-* wings are other feds
    AL={x['from']:x['to'] for x in json.load(open(f'{M}/data/aliases.json',encoding='utf-8'))['aliases']}  # fresh: the character pass appended
    CREC={}
    for f in glob.glob(f'{M}/data/shards/*/characters.json'):
        _d=json.load(open(f,encoding='utf-8'))
        for r in (_d if isinstance(_d,list) else []):
            if isinstance(r,dict) and r.get('id'): CREC[r['id']]=(f.split('/')[-2],r)
    urec={}
    for f in glob.glob(f'{M}/data/shards/*/units.json'):
        _d=json.load(open(f,encoding='utf-8'))
        for r in (_d if isinstance(_d,list) else []):
            if isinstance(r,dict) and r.get('id'): urec[r['id']]=(f.split('/')[-2],r)
    upairs=[]; useen=set(); ukind=set()
    for uid,(w,r) in urec.items():
        for i in r.get('identity') or []:
            if isinstance(i,dict) and i.get('assertion') in ('merged','presumed-same'):
                for t in i.get('with') or []:
                    k=tuple(sorted((uid,t)))
                    if t not in urec and t in CREC: ukind.add(k); continue
                    if t in urec and k not in useen:
                        useen.add(k)
                        if i['assertion']=='presumed-same' and i.get('grade') not in ('primary-source','user-attested','presumed'): review.append(k); continue
                        upairs.append((0 if i['assertion']=='merged' else 1,k))
    upairs.sort()
    for k in sorted(ukind): log.write(f"skip unit-character {k[0]} {k[1]}\n")
    def _ufirst(r):
        ds=[_fs(t.get('first_seen')) for t in (r.get('tenures') or []) if isinstance(t,dict)]; return min(ds) if ds else '9999'
    def _uload(p): return json.load(open(p,encoding='utf-8'))
    def _udump(p,d):
        if dry: return
        _m=re.match(r'[\[{][ \t]*\n( +)\S',open(p,encoding='utf-8').read(256)); _i=len(_m.group(1)) if _m else 1   # the file's OWN indent (c26)
        json.dump(d,open(p,'w',encoding='utf-8'),ensure_ascii=False,indent=_i); open(p,'a').write('\n')
    def _ufind(uid):
        w=urec.get(uid,(None,))[0]
        for p in ([f'{M}/data/shards/{w}/units.json'] if w else [])+glob.glob(f'{M}/data/shards/*/units.json'):
            try: d=_uload(p)
            except Exception: continue
            for r in (d if isinstance(d,list) else []):
                if isinstance(r,dict) and r.get('id')==uid: return p,r
        return None,None
    def _mkey(m):
        if isinstance(m,str): return m
        if isinstance(m,dict): return m.get('character_id') or m.get('id') or m.get('unit_id')
        return None
    def _cnames(cid):
        r=(CREC.get(cid) or CREC.get(canon(cid)) or (None,{}))[1]
        return {x.casefold().strip() for x in [r.get('name')]+list(r.get('aka') or []) if isinstance(x,str) and x.strip()}
    def _mnames(m):
        k=_mkey(m); s=_cnames(k) if k else set()
        if isinstance(m,dict) and isinstance(m.get('name'),str) and m['name'].strip(): s.add(m['name'].casefold().strip())
        return s
    def _ucare(x):
        w,r=urec[x]; why=[]
        if w in _UOWN or any(isinstance(t,dict) and t.get('promotion') in _UOWN for t in (r.get('tenures') or [])): why.append(f'{x} on an own wing')
        for m in (r.get('members') or []):
            k=_mkey(m)
            if k and CREC.get(k,(None,))[0] in _UOWN: why.append(f'{x} member {k} on an own wing')
            if k and k in MEMORIAL_CHARS: why.append(f'{x} member {k} is a memorial subject')
        if x in MEMORIAL_CHARS: why.append(f'{x} is a memorial subject')
        return why
    def _udistinct(a,b):
        for x,y in ((a,b),(b,a)):
            for i in (urec[x][1].get('identity') or []):
                if isinstance(i,dict) and i.get('assertion')=='distinct' and y in (i.get('with') or []): return True
        return False
    def _upromo(x):
        w,r=urec[x]
        for t in r.get('tenures') or []:
            p=t.get('promotion') if isinstance(t,dict) else None
            if p and x.endswith('-'+p): return p
        return w
    _EMPTY=(None,'','?',[],{})
    def _tv(t,k): v=t.get(k); return '?' if v in _EMPTY else v
    def _troles(t): return frozenset([x for x in (t.get('roles') or []) if isinstance(x,str)]+([t['role']] if isinstance(t.get('role'),str) and t['role'] else []))
    def _tdup(x,y): return (x.get('promotion')==y.get('promotion') and _tv(x,'first_seen')==_tv(y,'first_seen') and _tv(x,'last_seen')==_tv(y,'last_seen')
                            and (_troles(x)==_troles(y) or not _troles(x) or not _troles(y)))
    def _c143_drop(i,x):
        w=[y for y in (i.get('with') or []) if y!=x]
        if not w: return None
        j=dict(i); j['with']=w; return j
    URET={}
    def merge_unit(A,B):
        fa,a=_ufind(A); fb,b=_ufind(B)
        if not a or not b: return f'both must be live units: {A} {bool(a)}, {B} {bool(b)}'
        # hook c141 for units: the pair's own evidence is filed on the survivor's wing before anything is written
        try:
            _rows=_me.fold_rows(a.get('identity'),b.get('identity'),A,B); ev='none'
            if _rows:
                # hook c257: the folded unit is named by its name and its fed's name (label_for), never by its id
                _lab=_me.label_for(M,a,b,os.path.basename(os.path.dirname(fb)),'unit',_WORKSHOP)
                _row=_me.best_row(_rows); _rec=_me.build_record(A,[B],_row,datetime.date.today().isoformat(),M,_WORKSHOP,noun='unit',labels=[_lab])
                _wa=os.path.basename(os.path.dirname(fa)); ev=_me.file_records(M,[(_wa,_rec)],dry=dry)[0]
                if ev in ('filed','present'): ev+='; '+_me.narrative(_WORKSHOP,_wa,_rec,[B],_row.get('assertion'),re.sub(r'\s+',' ',str(_row.get('note') or _row.get('notes') or '')).strip(),dry=dry)
        except Exception as _e: return f'REFUSED: the pair evidence could not be filed ({_e}); nothing merged'
        for t in b.get('tenures') or []:   # hook c129: every distinct stint kept; a true duplicate gains only fields it lacks
            hit=next((u for u in (a.get('tenures') or []) if isinstance(u,dict) and _tdup(u,t)),None) if isinstance(t,dict) else None
            if hit is None:
                if t not in (a.get('tenures') or []): a['tenures']=list(a.get('tenures') or [])+[t]
                continue
            for k,v in t.items():
                if v not in _EMPTY and hit.get(k) in _EMPTY: hit[k]=v
        for nm in [b.get('name')]+list(b.get('aka') or []):
            if nm and nm!=a.get('name') and nm not in (a.get('aka') or []): a['aka']=list(a.get('aka') or [])+[nm]
        ida=[i for i in (a.get('identity') or []) if B not in (i.get('with') or [])]   # hook c143: only the folded id goes
        for i in a.get('identity') or []:
            if B not in (i.get('with') or []): continue
            j=_c143_drop(i,B)
            if j is not None and not any(set(j['with'])==set(k.get('with') or []) for k in ida): ida.append(j)
        for i in b.get('identity') or []:
            j=_c143_drop(i,A) if A in (i.get('with') or []) else i
            if j is not None and not any(set(j.get('with') or [])==set(k.get('with') or []) for k in ida): ida.append(j)
        if ida: a['identity']=ida
        elif 'identity' in a: del a['identity']
        am=[m for m in (a.get('members') or []) if _mkey(m) not in (A,B)]
        keys={_mkey(m) for m in am if _mkey(m)}
        for m in (b.get('members') or []):
            k=_mkey(m)
            if k in (A,B): continue
            if k:
                if k in keys: continue
                cn=_cnames(k)
                hit=next((x for x in am if isinstance(x,dict) and not _mkey(x) and isinstance(x.get('name'),str) and x['name'].casefold().strip() in cn), None)
                if hit is not None: hit['character_id']=k; keys.add(k); continue
                am.append(m); keys.add(k); continue
            nm=m.get('name').casefold().strip() if isinstance(m,dict) and isinstance(m.get('name'),str) else None
            if nm and any(nm in _mnames(x) for x in am): continue
            am.append(m)
        if am:
            a['members']=am; a.pop('membership_unknown',None)
        elif b.get('membership_unknown') is True and 'membership_unknown' not in a: a['membership_unknown']=True
        if not a.get('unit_kind') and b.get('unit_kind'): a['unit_kind']=b['unit_kind']
        rows=_uload(fa); rows=[a if isinstance(r,dict) and r.get('id')==A else r for r in rows]; _udump(fa,rows)
        rb=_uload(fb); rb=[r for r in rb if not (isinstance(r,dict) and r.get('id')==B)]; _udump(fb,rb)
        ap=f'{M}/data/aliases.json'; Al=_uload(ap)
        if not any(x.get('from')==B for x in Al['aliases']): Al['aliases'].append({'from':B,'to':A,'note':f'merged: one author-owned unit held across promotions ({datetime.date.today().isoformat()}, hook c59)'}); _udump(ap,Al)
        URET[B]=A
        return ('DRY ' if dry else '')+f'merged {B} -> {A}: tenures {len(a.get("tenures") or [])}, members {len(am)}, aka {a.get("aka")}, evidence {ev}'
    def _urepoint(RM):   # merge-character.py step 3's patterns and files, every retired id at once: references only, never prose
        if not RM: return 0
        n=0; W=f'{_WORKSHOP}'; _E='|'.join(re.escape(x) for x in sorted(RM,key=len,reverse=True))
        REF=[re.compile(r'(/(?:characters|units)/)('+_E+r')(\.html)'), re.compile(r'(data-entity=")('+_E+r')(")'),
             re.compile(r'([?&][a-z_]+=)('+_E+r')((?=["&#\s]))')]
        JSTR=re.compile(r'(")('+_E+r')(")')
        files=[f for f in glob.glob(f'{M}/data/shards/*/*.json')+glob.glob(f'{M}/promotions/**/*.html',recursive=True)+glob.glob(f'{M}/data/*.json') if not f.endswith('aliases.json')]
        for w in glob.glob(f'{W}/usenet-retro/scratch-*/wave-*/')+glob.glob(f'{W}/pt-scene/wave-*/')+glob.glob(f'{W}/fwrestling-census/waves/wave-*/')+glob.glob(f'{W}/desk/argyle/waves/wave-*/'):
            if os.path.exists(w+'READY') and not os.path.exists(w+'APPLIED'): files+=glob.glob(w+'delta/**/*.json',recursive=True)+glob.glob(w+'delta/**/*.html',recursive=True)
        for f in files:
            try: s=open(f,encoding='utf-8').read()
            except Exception: continue
            kk=0; _s0=s
            for rx in (REF+[JSTR] if f.endswith('.json') else REF):
                s,c=rx.subn(lambda m: m.group(1)+RM[m.group(2)]+m.group(3),s); kk+=c
            if kk:
                if f.endswith('.json'): s,_e,_d=_mh.tidy(_s0,s); _C281_U[0]+=_e; _C281_U[1]+=_d   # hook c281 (merge_hygiene.py)
                if not dry: open(f,'w',encoding='utf-8').write(s)
                n+=1
        return n
    udone=0; uskipped=0; uheld=0
    for kind,(a,b) in upairs:
        if udone>=lim: break
        if only is not None and not ({a,b}&only): continue
        a,b=canon(a),canon(b)
        if a==b or a not in urec or b not in urec: log.write(f"skip resolved unit {a} {b}\n"); continue
        _why=None
        if frozenset((a,b)) in UNIT_HOLD: _why=UNIT_HOLD[frozenset((a,b))]
        elif _udistinct(a,b): _why='hold c59: a record files this pair distinct as well'
        elif frozenset((a,b)) not in UNIT_CARE_CLEARED and (_ucare(a) or _ucare(b)): _why='care c59 (list for the coordinator): '+'; '.join(_ucare(a)+_ucare(b))
        if _why: uheld+=1; review.append((a,b,_why)); log.write(f"skip unit {a} {b}\t{_why}\n"); continue
        if P.get(urec[a][0],{}).get('roster_policy')=='real' or P.get(urec[b][0],{}).get('roster_policy')=='real': uskipped+=1; log.write(f"skip portrayal unit {a} {b}\n"); continue
        if (urec[a][1].get('portrayal_of') or urec[b][1].get('portrayal_of')) and _upromo(a)!=_upromo(b):
            uskipped+=1; review.append((a,b,f'portrayal v78(c): {_upromo(a)} / {_upromo(b)}')); log.write(f"skip portrayal (v78(c)) unit {a} {b}\n"); continue
        order=sorted([a,b],key=lambda c:(_ufirst(urec[c][1]),-len(urec[c][1].get('tenures') or []),len(c)))
        surv,ret=order[0],order[1]
        if frozenset((a,b)) in SURVIVOR_OVERRIDES: surv=SURVIVOR_OVERRIDES[frozenset((a,b))]; ret=b if surv==a else a
        elif (a in MEMORIAL_CHARS)!=(b in MEMORIAL_CHARS): surv=a if a in MEMORIAL_CHARS else b; ret=b if surv==a else a
        out=merge_unit(surv,ret)
        log.write(f"unit-{'merged' if kind==0 else 'presumed'}\t{surv}\t{ret}\t{out}\n")
        if out.startswith(('merged ','DRY merged ')): udone+=1
        if not dry and out.startswith('merged '):
            AL[ret]=surv; urec.pop(ret,None)
            for _k,_v in list(URET.items()):
                if _v==ret: URET[_k]=surv
            _sf,_sr=_ufind(surv)
            if _sr: urec[surv]=(_sf.split('/')[-2],_sr)
    urep=_urepoint(URET)
    log.write(f"unit repoint: {len(URET)} retired ids, files repointed {urep}\n")
    log.write(f"unit repoint hygiene (hook c281): {_mh.summary(*_C281_U)}\n")
    _UNITS_SUMMARY=f' | unit merges {udone} | unit pairs held for review {uheld} | unit portrayals skipped {uskipped} | unit pairs total {len(upairs)} | unit-character pairs refused {len(ukind)} | unit files repointed {urep}'
open(f"{_SCRATCH}/merge-review-{datetime.date.today()}.tsv",'w').write('\n'.join('\t'.join(k) for k in sorted(set(review)))+'\n'); print('review-lane pairs (grade presumed, or v78(c) portrayals):',len(set(review))); log.close(); print(('DRY ' if dry else '')+f'merges {done} | portrayals skipped {skipped} | cross-promotion portrayals skipped (v78(c)) {skipped_v78} | pairs total {len(pairs)}'+_UNITS_SUMMARY)
